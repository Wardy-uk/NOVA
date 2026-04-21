import type { JiraRestClient, JiraIssue } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { AgentDecision, CommentSnapshot } from './agent-types.js';
import { ResolutionReviewSchema, type ResolutionReview } from './resolution-review-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { query } from './database.js';

const DEFAULT_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'resolution',
  'customfield_10020', 'customfield_14494', // request type, resolution type
];

const REVIEW_WINDOW_HOURS = 1;

export class ResolutionReviewer {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;
  private llmService: LlmService;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries, llmService: LlmService) {
    this.jiraClient = jiraClient;
    this.settings = settings;
    this.llmService = llmService;
  }

  async reviewRecentResolutions(): Promise<AgentDecision[]> {
    const project = this.settings.get('agent_jira_project') ?? 'NT';
    const now = new Date();
    const since = new Date(now.getTime() - REVIEW_WINDOW_HOURS * 60 * 60 * 1000);

    const result = await this.jiraClient.searchJqlAll(
      `project = ${project} AND status changed to "Resolved" AFTER "${formatJqlDate(since)}" ORDER BY updated DESC`,
      DEFAULT_FIELDS,
      30,
    );

    const decisions: AgentDecision[] = [];

    for (const issue of result.issues) {
      if (await this.alreadyReviewed(issue.key)) continue;

      try {
        const decision = await this.reviewTicket(issue);
        if (decision) decisions.push(decision);
      } catch (err) {
        console.warn(`[resolution-reviewer] Failed to review ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[resolution-reviewer] Reviewed ${decisions.length} of ${result.issues.length} recently resolved tickets`);
    return decisions;
  }

  private async reviewTicket(issue: JiraIssue): Promise<AgentDecision | null> {
    const f = issue.fields;
    const comments = await this.jiraClient.getComments(issue.key, 10);
    const conversationThread = comments
      .map(c => {
        const isPublic = c.jsdPublic !== false;
        return `[${c.created}] ${c.author?.displayName ?? 'Unknown'}${isPublic ? '' : ' (internal)'}:\n${extractText(c.body)}`;
      })
      .join('\n\n---\n\n');

    const resolutionType = (f.customfield_14494 as any)?.value ?? (f.resolution as any)?.name ?? 'Unknown';

    const systemPrompt = loadPrompt('resolution-review', {
      ticket_key: issue.key,
      summary: (f.summary as string) ?? '',
      description: extractText(f.description),
      status: (f.status as any)?.name ?? 'Unknown',
      resolution_type: resolutionType,
      priority: (f.priority as any)?.name ?? 'Medium',
      assignee: (f.assignee as any)?.displayName ?? 'Unassigned',
      reporter: (f.reporter as any)?.displayName ?? 'Unknown',
      organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? 'Unknown',
      created: (f.created as string) ?? '',
      resolved: (f.updated as string) ?? '',
      conversation_thread: conversationThread || '(no comments)',
    });

    const result = await this.llmService.call<ResolutionReview>(
      systemPrompt,
      'Review this resolved ticket against the quality checks and produce the structured JSON assessment.',
      ResolutionReviewSchema,
      {
        tier: 'reasoning',
        ticketId: issue.key,
        callType: 'resolution_review',
        temperature: 0.2,
      },
    );

    const review = result.data;

    if (review.overall_pass) {
      return {
        ticketId: issue.id,
        ticketKey: issue.key,
        eventType: 'resolution_review',
        action: 'no_action',
        confidence: 1.0,
        reasoning: review.reasoning_trace,
        approvalRequired: false,
        shadowMode: false,
        inputs: {
          summary: (f.summary as string) ?? '',
          status: (f.status as any)?.name ?? 'Unknown',
          resolution_type: resolutionType,
          assignee: (f.assignee as any)?.displayName ?? null,
          clarity: review.clarity,
          customer_communication: review.customer_communication,
          completeness: review.completeness,
          resolution_type_match: review.resolution_type_match,
        },
        output: {
          overall_pass: true,
          internal_note: `🤖 Resolution Review — All checks passed.\n\n✅ Clarity: ${review.clarity.detail}\n✅ Customer communication: ${review.customer_communication.detail}\n✅ Completeness: ${review.completeness.detail}\n✅ Resolution type: ${review.resolution_type_match.detail}`,
        },
        provider: result.provider,
        model: result.model,
      };
    }

    const checks = [
      { name: 'Clarity', ...review.clarity },
      { name: 'Customer communication', ...review.customer_communication },
      { name: 'Completeness', ...review.completeness },
      { name: 'Resolution type', ...review.resolution_type_match },
    ];
    const failedChecks = checks.filter(c => !c.passed);
    const assignee = (f.assignee as any)?.displayName ?? 'the assigned agent';

    const internalNote = review.internal_note ??
      `🤖 Resolution Review — ${failedChecks.length} check(s) failed\n\n` +
      checks.map(c => `${c.passed ? '✅' : '❌'} ${c.name}: ${c.detail}`).join('\n') +
      `\n\n@${assignee} — please review and update the resolution notes on this ticket.`;

    return {
      ticketId: issue.id,
      ticketKey: issue.key,
      eventType: 'resolution_review',
      action: 'comment',
      confidence: 1.0,
      reasoning: review.reasoning_trace,
      approvalRequired: false,
      shadowMode: false,
      inputs: {
        summary: (f.summary as string) ?? '',
        status: (f.status as any)?.name ?? 'Unknown',
        resolution_type: resolutionType,
        assignee: (f.assignee as any)?.displayName ?? null,
        clarity: review.clarity,
        customer_communication: review.customer_communication,
        completeness: review.completeness,
        resolution_type_match: review.resolution_type_match,
      },
      output: {
        overall_pass: false,
        failed_checks: failedChecks.map(c => c.name),
        internal_note: internalNote,
        suggested_resolution_type: review.resolution_type_match.suggested_type,
      },
      provider: result.provider,
      model: result.model,
    };
  }

  private async alreadyReviewed(ticketKey: string): Promise<boolean> {
    const rows = await query(
      `SELECT TOP(1) id FROM agent_decisions WHERE ticket_id = ? AND event_type = 'resolution_review'`,
      [ticketKey],
    );
    return rows.length > 0;
  }
}

function extractText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  if (typeof adf === 'string') return adf;
  try {
    const content = (adf as any).content;
    if (!Array.isArray(content)) return JSON.stringify(adf).slice(0, 500);
    return content
      .flatMap((node: any) => {
        if (node.type === 'paragraph' && Array.isArray(node.content)) {
          return node.content.map((c: any) => c.text ?? '').join('');
        }
        return node.text ?? '';
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function formatJqlDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
