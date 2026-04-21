import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import type { KbSearchService } from './kb-search.js';
import { BriefResultSchema, type BriefResult } from './brief-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { query } from './database.js';

export class BriefEngine {
  constructor(
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private kbSearch: KbSearchService,
    private jiraProject: string = 'NT',
  ) {}

  async generateBrief(ticketKey: string): Promise<BriefResult | null> {
    const issue = await this.jiraClient.getIssue(ticketKey, [
      'summary', 'description', 'issuetype', 'priority', 'status',
      'reporter', 'labels', 'comment', 'created',
      'customfield_10002',
    ]);

    if (!issue) return null;

    const fields = issue.fields as any;
    const summary = fields.summary ?? '';
    const description = this.extractText(fields.description);
    const reporter = fields.reporter;
    const org = fields.customfield_10002?.name ?? 'Unknown';

    const comments = fields.comment?.comments ?? [];
    const thread = comments.slice(-10).map((c: any) => {
      const body = this.extractText(c.body);
      return `[${c.author?.displayName}]: ${body.slice(0, 500)}`;
    }).join('\n\n');

    const kbMatches = await this.kbSearch.search(summary + ' ' + description.slice(0, 200));
    const kbFormatted = kbMatches.length > 0
      ? kbMatches.map((m: any) => `- ${m.title} (relevance: ${m.relevance})`).join('\n')
      : 'No KB matches found';

    const customerContext = await this.buildCustomerContext(reporter, org);
    const similarTickets = await this.findSimilarResolved(summary, description);

    const previousDecisions = await query<any>(`
      SELECT TOP 3 action, confidence, reasoning, created_at
      FROM agent_decisions
      WHERE ticket_id = ?
      ORDER BY created_at DESC
    `, [ticketKey]);

    const decisionsText = previousDecisions.length > 0
      ? previousDecisions.map((d: any) => `${d.action} (confidence: ${d.confidence}) — ${d.reasoning?.slice(0, 200)}`).join('\n')
      : 'No previous AI decisions';

    const prompt = loadPrompt('brief', {
      ticket_key: ticketKey,
      summary,
      description: description.slice(0, 3000),
      priority: fields.priority?.name ?? 'Unknown',
      request_type: fields.issuetype?.name ?? 'Unknown',
      status: fields.status?.name ?? 'Unknown',
      reporter_name: reporter?.displayName ?? 'Unknown',
      reporter_email: reporter?.emailAddress ?? 'Unknown',
      organisation: org,
      created: fields.created ?? 'Unknown',
      labels: (fields.labels ?? []).join(', ') || 'None',
      conversation_thread: thread || 'No comments yet',
      customer_context: customerContext,
      kb_matches: kbFormatted,
      similar_tickets: similarTickets,
      previous_decisions: decisionsText,
    });

    const result = await this.llmService.call<BriefResult>(
      prompt,
      `Generate a pre-assignment brief for ${ticketKey}: ${summary}`,
      BriefResultSchema,
      { tier: 'reasoning', temperature: 0.2, ticketId: ticketKey, callType: 'brief' },
    );

    return result.data;
  }

  async postBriefToJira(ticketKey: string, brief: BriefResult): Promise<void> {
    const sections: string[] = [
      '🤖 AI Pre-Assignment Brief',
      '',
      `*Estimated Complexity:* ${brief.estimated_complexity}`,
      '',
      '*Customer Summary*',
      brief.customer_summary,
      '',
      '*Ticket Analysis*',
      brief.ticket_analysis,
      '',
      '*Recommended Approach*',
      brief.recommended_approach,
    ];

    if (brief.kb_references.length > 0) {
      sections.push('', '*KB References*');
      brief.kb_references.forEach(ref => sections.push(`• ${ref}`));
    }

    if (brief.similar_tickets.length > 0) {
      sections.push('', '*Similar Resolved Tickets*');
      brief.similar_tickets.forEach(t => sections.push(`• ${t.key}: ${t.summary} → ${t.resolution}`));
    }

    if (brief.key_risks.length > 0) {
      sections.push('', '*Key Risks*');
      brief.key_risks.forEach(r => sections.push(`• ${r}`));
    }

    if (brief.suggested_skills.length > 0) {
      sections.push('', `*Suggested Skills:* ${brief.suggested_skills.join(', ')}`);
    }

    await this.jiraClient.addComment(ticketKey, sections.join('\n'), { internal: true });
  }

  private async buildCustomerContext(reporter: any, org: string): Promise<string> {
    if (!reporter) return 'Unknown reporter';

    const parts: string[] = [];
    parts.push(`Reporter: ${reporter.displayName} (${reporter.emailAddress ?? 'no email'})`);
    parts.push(`Organisation: ${org}`);

    const recentResult = await this.jiraClient.searchJql(
      `reporter = "${reporter.accountId}" AND project = ${this.jiraProject} ORDER BY created DESC`,
      ['summary', 'status', 'resolution', 'priority'],
      5,
    );

    if (recentResult?.issues?.length) {
      parts.push(`Recent tickets (${recentResult.issues.length}):`);
      for (const t of recentResult.issues) {
        const tf = t.fields as any;
        parts.push(`  - ${t.key}: ${tf.summary} [${tf.status?.name}]`);
      }
    }

    const memory = await query<any>(
      `SELECT patterns FROM agent_customer_memory WHERE account_id = ?`,
      [reporter.accountId ?? reporter.emailAddress ?? ''],
    );
    if (memory.length > 0 && memory[0].patterns) {
      parts.push(`Customer patterns: ${memory[0].patterns}`);
    }

    return parts.join('\n');
  }

  private async findSimilarResolved(summary: string, description: string): Promise<string> {
    const keywords = summary.split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(' ');
    if (!keywords) return 'No similar tickets found';

    try {
      const result = await this.jiraClient.searchJql(
        `project = ${this.jiraProject} AND resolution IS NOT EMPTY AND text ~ "${keywords.replace(/"/g, '\\"')}" ORDER BY resolved DESC`,
        ['summary', 'resolution', 'status'],
        5,
      );
      if (!result?.issues?.length) return 'No similar tickets found';

      return result.issues.map((t: any) =>
        `${t.key}: ${t.fields.summary} → ${t.fields.resolution?.name ?? 'Resolved'}`
      ).join('\n');
    } catch {
      return 'Similar ticket search failed';
    }
  }

  private extractText(adf: any): string {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;
    if (adf.content) {
      return adf.content.map((block: any) =>
        block.content?.map((node: any) => node.text ?? '').join('') ?? ''
      ).join('\n');
    }
    return '';
  }
}
