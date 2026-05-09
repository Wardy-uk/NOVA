import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';

export interface OneToOneBrief {
  id: number;
  manager_user_id: number;
  agent_id: string;
  agent_name: string | null;
  period_start: string | null;
  period_end: string | null;
  content: BriefContent;
  generated_at: string;
}

export interface BriefContent {
  headline: string;
  ticket_performance: {
    volume: number;
    mttr_hours: number | null;
    first_response_hours: number | null;
    qa_average: number | null;
  };
  trends: Array<{ metric: string; direction: 'improving' | 'declining' | 'stable'; detail: string }>;
  escalation_analysis: {
    count: number;
    appropriate_rate: number | null;
    detail: string;
  };
  coaching_signals: Array<{ signal_type: string; detail: string; request_type: string | null }>;
  qa_highlights: {
    best: Array<{ ticket_key: string; score: number; summary: string }>;
    worst: Array<{ ticket_key: string; score: number; summary: string }>;
  };
  autonomy_interaction: {
    approvals: number;
    rejections: number;
    detail: string;
  } | null;
  talking_points: string[];
}

const BriefLlmSchema = z.object({
  headline: z.string(),
  talking_points: z.array(z.string()).min(2).max(5),
  overall_assessment: z.string(),
});

export class Briefing121Service {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  async generate(managerUserId: number, agentId: string, agentName: string, periodDays: number = 14): Promise<OneToOneBrief> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const periodStartStr = periodStart.toISOString().split('T')[0];
    const periodEndStr = now.toISOString().split('T')[0];

    // Gather all data points
    const [ticketPerf, escalations, qaData, coachingSignals, autonomyData] = await Promise.all([
      this.getTicketPerformance(agentId, periodStart),
      this.getEscalationAnalysis(agentId, periodStart),
      this.getQaData(agentId, periodStart),
      this.getCoachingSignals(agentId),
      this.getAutonomyInteraction(agentId, periodStart),
    ]);

    // Previous period for trend comparison
    const prevStart = new Date(periodStart.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const prevPerf = await this.getTicketPerformance(agentId, prevStart, periodStart);

    const trends = this.computeTrends(ticketPerf, prevPerf);

    // Use LLM to generate headline and talking points
    const llmResult = await this.llm.call(
      `You are a support team manager's assistant. Generate a concise 1-2-1 meeting brief headline and talking points.`,
      `Agent: ${agentName}
Period: ${periodStartStr} to ${periodEndStr}

Performance:
- Tickets handled: ${ticketPerf.volume}
- QA average: ${qaData.average?.toFixed(1) ?? 'N/A'}
- Escalations: ${escalations.count} (${escalations.appropriate_rate !== null ? (escalations.appropriate_rate * 100).toFixed(0) + '% appropriate' : 'accuracy unknown'})

Trends: ${trends.map(t => `${t.metric}: ${t.direction} — ${t.detail}`).join('; ')}

Coaching signals: ${coachingSignals.length > 0 ? coachingSignals.map(s => `${s.signal_type}: ${s.detail}`).join('; ') : 'None identified'}

Best QA tickets: ${qaData.best.map(t => `${t.ticket_key} (${t.score})`).join(', ') || 'N/A'}
Worst QA tickets: ${qaData.worst.map(t => `${t.ticket_key} (${t.score})`).join(', ') || 'N/A'}

Generate: a brief headline summarising performance, and 2-3 specific evidence-backed talking points for the 1-2-1.`,
      BriefLlmSchema,
      { callType: '121_briefing', tier: 'cheap', temperature: 0.3 },
    );

    const content: BriefContent = {
      headline: llmResult.data.headline,
      ticket_performance: ticketPerf,
      trends,
      escalation_analysis: escalations,
      coaching_signals: coachingSignals,
      qa_highlights: qaData,
      autonomy_interaction: autonomyData,
      talking_points: llmResult.data.talking_points,
    };

    const id = await executeAndGetId(
      `INSERT INTO agent_121_briefings (manager_user_id, agent_id, agent_name, period_start, period_end, content_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [managerUserId, agentId, agentName, periodStartStr, periodEndStr, JSON.stringify(content)],
    );

    return {
      id, manager_user_id: managerUserId, agent_id: agentId, agent_name: agentName,
      period_start: periodStartStr, period_end: periodEndStr, content, generated_at: now.toISOString(),
    };
  }

  private async getTicketPerformance(agentId: string, since: Date, until?: Date): Promise<{
    volume: number; mttr_hours: number | null; first_response_hours: number | null; qa_average: number | null;
  }> {
    const untilClause = until ? ` AND jira_updated < ?` : '';
    const params: unknown[] = [agentId, since];
    if (until) params.push(until);

    const volume = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE assignee_account_id = ? AND jira_updated >= ?${untilClause}`,
      params,
    );

    const mttr = await query<{ avg_hours: number | null }>(
      `SELECT AVG(DATEDIFF(HOUR, jira_created, COALESCE(resolved_date, GETUTCDATE()))) AS avg_hours
       FROM jira_issue_cache
       WHERE assignee_account_id = ? AND status_category = 'Done'
         AND jira_updated >= ?${untilClause}`,
      params,
    );

    return {
      volume: volume[0]?.cnt ?? 0,
      mttr_hours: mttr[0]?.avg_hours ?? null,
      first_response_hours: null,
      qa_average: null,
    };
  }

  private async getEscalationAnalysis(agentId: string, since: Date): Promise<{
    count: number; appropriate_rate: number | null; detail: string;
  }> {
    const escalations = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE action LIKE 'escalate%'
         AND created_at >= ?
         AND ticket_id IN (
           SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?
         )`,
      [since, agentId],
    );

    const predictions = await query<{ total: number; correct: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM agent_escalation_predictions
       WHERE ticket_key IN (
         SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?
       )
       AND predicted_at >= ?
       AND actual_outcome IS NOT NULL`,
      [agentId, since],
    );

    const count = escalations[0]?.cnt ?? 0;
    const appropriate = predictions[0]?.total > 0
      ? (predictions[0].correct ?? 0) / predictions[0].total
      : null;

    return {
      count,
      appropriate_rate: appropriate,
      detail: `${count} escalations in period${appropriate !== null ? `, ${(appropriate * 100).toFixed(0)}% predicted correctly` : ''}`,
    };
  }

  private async getQaData(agentId: string, since: Date): Promise<{
    average: number | null;
    best: Array<{ ticket_key: string; score: number; summary: string }>;
    worst: Array<{ ticket_key: string; score: number; summary: string }>;
  }> {
    const avg = await query<{ avg_score: number | null }>(
      `SELECT AVG(CAST(JSON_VALUE(golden_rule_scores, '$.overall') AS FLOAT)) AS avg_score
       FROM agent_coaching
       WHERE golden_rule_scores IS NOT NULL
         AND created_at >= ?
         AND ticket_id IN (SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?)`,
      [since, agentId],
    );

    const best = await query<{ ticket_key: string; score: number; summary: string }>(
      `SELECT TOP 3 ac.ticket_id AS ticket_key,
         CAST(JSON_VALUE(ac.golden_rule_scores, '$.overall') AS FLOAT) AS score,
         jic.summary
       FROM agent_coaching ac
       JOIN jira_issue_cache jic ON jic.issue_key = ac.ticket_id
       WHERE ac.golden_rule_scores IS NOT NULL AND ac.created_at >= ?
         AND jic.assignee_account_id = ?
       ORDER BY score DESC`,
      [since, agentId],
    );

    const worst = await query<{ ticket_key: string; score: number; summary: string }>(
      `SELECT TOP 3 ac.ticket_id AS ticket_key,
         CAST(JSON_VALUE(ac.golden_rule_scores, '$.overall') AS FLOAT) AS score,
         jic.summary
       FROM agent_coaching ac
       JOIN jira_issue_cache jic ON jic.issue_key = ac.ticket_id
       WHERE ac.golden_rule_scores IS NOT NULL AND ac.created_at >= ?
         AND jic.assignee_account_id = ?
       ORDER BY score ASC`,
      [since, agentId],
    );

    return { average: avg[0]?.avg_score ?? null, best, worst };
  }

  private async getCoachingSignals(agentId: string): Promise<Array<{ signal_type: string; detail: string; request_type: string | null }>> {
    const signals = await query<TrainingSignalRow>(
      `SELECT signal_type, recommendation AS detail, request_type
       FROM agent_training_signals
       WHERE agent_id = ? AND actioned = 0
       ORDER BY generated_at DESC`,
      [agentId],
    );
    return signals.map(s => ({ signal_type: s.signal_type, detail: s.detail ?? '', request_type: s.request_type }));
  }

  private async getAutonomyInteraction(agentId: string, since: Date): Promise<{
    approvals: number; rejections: number; detail: string;
  } | null> {
    const rows = await query<{ outcome: string; cnt: number }>(
      `SELECT outcome, COUNT(*) AS cnt
       FROM agent_decisions
       WHERE outcome IN ('approved', 'rejected')
         AND created_at >= ?
         AND ticket_id IN (SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?)
       GROUP BY outcome`,
      [since, agentId],
    );
    if (rows.length === 0) return null;

    const approvals = rows.find(r => r.outcome === 'approved')?.cnt ?? 0;
    const rejections = rows.find(r => r.outcome === 'rejected')?.cnt ?? 0;
    return {
      approvals, rejections,
      detail: `${approvals} approved, ${rejections} rejected AI suggestions`,
    };
  }

  private computeTrends(current: { volume: number; mttr_hours: number | null }, previous: { volume: number; mttr_hours: number | null }): Array<{ metric: string; direction: 'improving' | 'declining' | 'stable'; detail: string }> {
    const trends: Array<{ metric: string; direction: 'improving' | 'declining' | 'stable'; detail: string }> = [];

    if (previous.volume > 0) {
      const volumeChange = ((current.volume - previous.volume) / previous.volume) * 100;
      trends.push({
        metric: 'Volume',
        direction: Math.abs(volumeChange) < 10 ? 'stable' : volumeChange > 0 ? 'improving' : 'declining',
        detail: `${current.volume} tickets (${volumeChange > 0 ? '+' : ''}${volumeChange.toFixed(0)}% vs prior period)`,
      });
    }

    if (current.mttr_hours !== null && previous.mttr_hours !== null && previous.mttr_hours > 0) {
      const mttrChange = ((current.mttr_hours - previous.mttr_hours) / previous.mttr_hours) * 100;
      trends.push({
        metric: 'MTTR',
        direction: Math.abs(mttrChange) < 10 ? 'stable' : mttrChange < 0 ? 'improving' : 'declining',
        detail: `${current.mttr_hours.toFixed(1)}h (${mttrChange > 0 ? '+' : ''}${mttrChange.toFixed(0)}% vs prior)`,
      });
    }

    return trends;
  }

  async getHistory(agentId: string, limit: number = 10): Promise<Array<{
    id: number; agent_name: string | null; period_start: string | null; period_end: string | null; generated_at: string;
  }>> {
    return query(
      `SELECT TOP (?) id, agent_name, period_start, period_end, generated_at
       FROM agent_121_briefings WHERE agent_id = ? ORDER BY generated_at DESC`,
      [limit, agentId],
    );
  }

  async getById(briefId: number): Promise<OneToOneBrief | null> {
    const rows = await query<{
      id: number; manager_user_id: number; agent_id: string; agent_name: string | null;
      period_start: string | null; period_end: string | null; content_json: string; generated_at: string;
    }>(
      `SELECT * FROM agent_121_briefings WHERE id = ?`, [briefId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return { ...r, content: JSON.parse(r.content_json) };
  }
}

interface TrainingSignalRow {
  signal_type: string;
  detail: string | null;
  request_type: string | null;
}
