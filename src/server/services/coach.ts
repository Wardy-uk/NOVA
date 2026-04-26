import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import { CoachingAssessmentSchema, type CoachingAssessment, type GoldenRulesScore } from './coaching-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { query, queryOne, executeAndGetId } from './database.js';

export type CoachingVisibility = 'off' | 'agent' | 'manager';
export type NudgeType = 'missing_next_update' | 'weak_reply' | 'no_troubleshooting' | 'unaddressed_question' | 'idle_ticket' | 'golden_rules' | 'escalation_without_docs';

interface CoachingEntry {
  id: number;
  ticket_id: string;
  agent_user_id: number;
  nudge_type: string | null;
  golden_rule_scores: GoldenRulesScore | null;
  message: string | null;
  delivered: boolean;
  delivery_method: string | null;
  created_at: Date;
}

export class CoachingEngine {
  private visibility: CoachingVisibility = 'manager';

  constructor(
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private jiraProject: string = 'NT',
  ) {}

  setVisibility(v: CoachingVisibility): void { this.visibility = v; }
  getVisibility(): CoachingVisibility { return this.visibility; }

  async assessResponse(ticketKey: string, agentAccountId: string, responseText: string): Promise<CoachingAssessment | null> {
    const issue = await this.jiraClient.getIssue(ticketKey, [
      'summary', 'description', 'priority', 'status', 'reporter', 'comment',
    ]);
    if (!issue) return null;

    const fields = issue.fields as any;
    const description = this.extractText(fields.description);
    const comments = fields.comment?.comments ?? [];
    const lastCustomerComment = [...comments].reverse().find((c: any) =>
      c.author?.accountId !== agentAccountId && !this.isInternal(c)
    );

    const customerMessage = lastCustomerComment
      ? this.extractText(lastCustomerComment.body).slice(0, 2000)
      : 'No recent customer message';

    const prompt = loadPrompt('coaching', {
      ticket_key: ticketKey,
      summary: fields.summary ?? '',
      description: description.slice(0, 2000),
      priority: fields.priority?.name ?? 'Unknown',
      customer_message: customerMessage,
      agent_response: responseText.slice(0, 3000),
      reporter_name: fields.reporter?.displayName ?? 'Unknown',
    });

    const result = await this.llmService.call<CoachingAssessment>(
      prompt,
      `Assess this agent response for Golden Rules compliance.\n\nAgent's response:\n${responseText.slice(0, 1000)}`,
      CoachingAssessmentSchema,
      { temperature: 0.1, ticketId: ticketKey, callType: 'coaching' },
    );

    if (result.data) {
      const agentUserId = await this.resolveAgentUserId(agentAccountId);
      await this.saveCoachingEntry(ticketKey, agentUserId, result.data);

      if (this.visibility !== 'off' && result.data.nudges.length > 0) {
        await this.deliverNudges(ticketKey, result.data);
      }
    }

    return result.data;
  }

  async checkTicketHealth(ticketKey: string, assigneeAccountId: string): Promise<NudgeType[]> {
    const nudges: NudgeType[] = [];
    const issue = await this.jiraClient.getIssue(ticketKey, [
      'summary', 'status', 'assignee', 'updated', 'comment',
      'customfield_10010',
    ]);
    if (!issue) return nudges;

    const fields = issue.fields as any;
    const updated = fields.updated ? new Date(fields.updated) : null;
    const now = new Date();

    if (updated && this.isBusinessHours(now)) {
      const hoursSinceUpdate = (now.getTime() - updated.getTime()) / 3600000;
      if (hoursSinceUpdate > 2 && fields.status?.name !== 'Waiting On Requestor') {
        nudges.push('idle_ticket');
      }
    }

    const comments = fields.comment?.comments ?? [];
    const lastCustomerComment = [...comments].reverse().find((c: any) =>
      c.author?.accountId !== assigneeAccountId && !this.isInternal(c)
    );

    if (lastCustomerComment) {
      const agentReplied = comments.some((c: any) =>
        c.author?.accountId === assigneeAccountId &&
        new Date(c.created) > new Date(lastCustomerComment.created) &&
        !this.isInternal(c)
      );
      if (!agentReplied) {
        nudges.push('unaddressed_question');
      }
    }

    return nudges;
  }

  async getAgentScores(agentUserId: number, days: number = 30): Promise<{
    averages: GoldenRulesScore | null;
    trend: any[];
    totalAssessments: number;
    nudgeBreakdown: Record<string, number>;
  }> {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const entries = await query<any>(`
      SELECT golden_rule_scores, nudge_type, created_at
      FROM agent_coaching
      WHERE agent_user_id = ? AND created_at >= ?
      ORDER BY created_at DESC
    `, [agentUserId, since]);

    const scored = entries.filter((e: any) => e.golden_rule_scores);
    const nudgeBreakdown: Record<string, number> = {};
    entries.forEach((e: any) => {
      if (e.nudge_type) nudgeBreakdown[e.nudge_type] = (nudgeBreakdown[e.nudge_type] ?? 0) + 1;
    });

    let averages: GoldenRulesScore | null = null;
    if (scored.length > 0) {
      const scores = scored.map((e: any) => JSON.parse(e.golden_rule_scores) as GoldenRulesScore);
      averages = {
        ownership: Math.round(scores.reduce((s, sc) => s + (sc.ownership ?? 0), 0) / scores.length * 10) / 10,
        nextAction: Math.round(scores.reduce((s, sc) => s + (sc.nextAction ?? 0), 0) / scores.length * 10) / 10,
        timeframe: Math.round(scores.reduce((s, sc) => s + (sc.timeframe ?? 0), 0) / scores.length * 10) / 10,
        overall: Math.round(scores.reduce((s, sc) => s + sc.overall, 0) / scores.length * 10) / 10,
        feedback: '',
        strengths: [],
        improvements: [],
      };
    }

    const trend = await query<any>(`
      SELECT CAST(created_at AS DATE) as day,
             AVG(CAST(JSON_VALUE(golden_rule_scores, '$.overall') AS FLOAT)) as avg_score,
             COUNT(*) as count
      FROM agent_coaching
      WHERE agent_user_id = ? AND created_at >= ? AND golden_rule_scores IS NOT NULL
      GROUP BY CAST(created_at AS DATE)
      ORDER BY day
    `, [agentUserId, since]);

    return { averages, trend, totalAssessments: scored.length, nudgeBreakdown };
  }

  async getTeamScores(days: number = 30): Promise<any[]> {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    return query<any>(`
      SELECT c.agent_user_id,
             COUNT(*) as assessments,
             AVG(CAST(JSON_VALUE(c.golden_rule_scores, '$.ownership') AS FLOAT)) as avg_ownership,
             AVG(CAST(JSON_VALUE(c.golden_rule_scores, '$.nextAction') AS FLOAT)) as avg_nextAction,
             AVG(CAST(JSON_VALUE(c.golden_rule_scores, '$.timeframe') AS FLOAT)) as avg_timeframe,
             AVG(CAST(JSON_VALUE(c.golden_rule_scores, '$.overall') AS FLOAT)) as avg_overall
      FROM agent_coaching c
      WHERE c.created_at >= ? AND c.golden_rule_scores IS NOT NULL
      GROUP BY c.agent_user_id
      ORDER BY avg_overall DESC
    `, [since]);
  }

  async getNudgeHistory(limit: number = 50, agentUserId?: number): Promise<any[]> {
    if (agentUserId) {
      return query(`
        SELECT * FROM agent_coaching
        WHERE agent_user_id = ? AND nudge_type IS NOT NULL
        ORDER BY created_at DESC
        OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
      `, [agentUserId, limit]);
    }
    return query(`
      SELECT * FROM agent_coaching
      WHERE nudge_type IS NOT NULL
      ORDER BY created_at DESC
      OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
    `, [limit]);
  }

  private async saveCoachingEntry(ticketKey: string, agentUserId: number, assessment: CoachingAssessment): Promise<void> {
    if (assessment.golden_rules) {
      await executeAndGetId(`
        INSERT INTO agent_coaching (ticket_id, agent_user_id, nudge_type, golden_rule_scores, message, delivered, delivery_method)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        ticketKey,
        agentUserId,
        assessment.nudges.length > 0 ? assessment.nudges[0].type : null,
        JSON.stringify(assessment.golden_rules),
        assessment.nudges.map(n => n.message).join('; ') || null,
        0,
        null,
      ]);
    }

    for (const nudge of assessment.nudges.slice(1)) {
      await executeAndGetId(`
        INSERT INTO agent_coaching (ticket_id, agent_user_id, nudge_type, message, delivered, delivery_method)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [ticketKey, agentUserId, nudge.type, nudge.message, 0, null]);
    }
  }

  private async deliverNudges(ticketKey: string, assessment: CoachingAssessment): Promise<void> {
    const criticalNudges = assessment.nudges.filter(n => n.severity === 'critical' || n.severity === 'warning');
    if (criticalNudges.length === 0) return;

    const nudgeText = criticalNudges.map(n => `• ${n.message}`).join('\n');
    const note = `🤖 Coaching Note\n\n${nudgeText}\n\nGolden Rules: Ownership ${assessment.golden_rules.ownership}/3 | Next Action ${assessment.golden_rules.nextAction}/3 | Timeframe ${assessment.golden_rules.timeframe}/3`;

    try {
      await this.jiraClient.addComment(ticketKey, note, { internal: true });
    } catch (err) {
      console.warn(`[Coach] Failed to deliver nudge to ${ticketKey}:`, err instanceof Error ? err.message : err);
    }
  }

  private async resolveAgentUserId(_jiraAccountId: string): Promise<number> {
    // TODO: rewire gamification to use dbo.Agent.AgentId when gamification is active
    return 0;
  }

  private isInternal(comment: any): boolean {
    const props = comment.properties ?? [];
    return props.some((p: any) => p.key === 'sd.public.comment' && p.value?.internal === true);
  }

  private isBusinessHours(date: Date): boolean {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    const hour = date.getHours();
    return hour >= 8 && hour < 18;
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
