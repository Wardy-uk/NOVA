import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, executeAndGetId } from './database.js';

export interface OpsPack {
  id: number;
  generated_by: number | null;
  period_start: string | null;
  period_end: string | null;
  content: OpsPackContent;
  generated_at: string;
}

export interface OpsPackContent {
  headline: string;
  queue_health: {
    total_volume: number;
    resolved: number;
    resolution_rate: number;
    avg_handle_hours: number | null;
    queue_depth: number;
    trend_vs_last_week: string;
  };
  sla_compliance: {
    frt_rate: number | null;
    resolution_rate: number | null;
    next_update_rate: number | null;
  };
  shift_left: {
    cc_resolved_pct: number;
    trend: string;
  };
  ai_impact: {
    autonomous_rate: number | null;
    queue_hours_saved: number | null;
    decisions_count: number;
  };
  decisions_needed: Array<{
    title: string;
    context: string;
    recommendation: string;
    ticket_keys: string[];
  }>;
  team_performance: Array<{
    agent_name: string;
    volume: number;
    qa_avg: number | null;
    status: 'ahead' | 'on_track' | 'needs_support';
  }>;
  incidents_this_week: Array<{
    summary: string;
    ticket_count: number;
    status: string;
  }>;
  next_week_outlook: string;
}

const OpsHeadlineSchema = z.object({
  headline: z.string(),
  decisions_needed: z.array(z.object({
    title: z.string(),
    context: z.string(),
    recommendation: z.string(),
  })).max(3),
  next_week_outlook: z.string(),
});

export class OpsPackService {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  async generate(userId: number | null = null): Promise<OpsPack> {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const periodStartStr = weekStart.toISOString().split('T')[0];
    const periodEndStr = now.toISOString().split('T')[0];

    const project = this.settings.get('agent_jira_project') ?? 'NT';

    const [queueHealth, sla, shiftLeft, aiImpact, teamPerf, incidents] = await Promise.all([
      this.getQueueHealth(project, weekStart),
      this.getSlaCompliance(project, weekStart),
      this.getShiftLeft(project, weekStart),
      this.getAiImpact(weekStart),
      this.getTeamPerformance(project, weekStart),
      this.getIncidents(weekStart),
    ]);

    // Get flagged tickets needing decisions
    const flagged = await query<{ ticket_key: string; summary: string; risk_score: number }>(
      `SELECT TOP 5 ticket_key, summary, risk_score
       FROM agent_flagged_tickets
       WHERE status = 'pending'
       ORDER BY risk_score DESC`,
    );

    // LLM generates headline, decisions, outlook
    const llmResult = await this.llm.call(
      `You are an operations analyst. Generate a concise weekly ops pack headline, top decisions needed, and next-week outlook.`,
      `Week: ${periodStartStr} to ${periodEndStr}
Queue: ${queueHealth.total_volume} tickets, ${queueHealth.resolved} resolved (${(queueHealth.resolution_rate * 100).toFixed(0)}%), ${queueHealth.queue_depth} still open
SLA: FRT ${sla.frt_rate !== null ? (sla.frt_rate * 100).toFixed(0) + '%' : 'N/A'}, Resolution ${sla.resolution_rate !== null ? (sla.resolution_rate * 100).toFixed(0) + '%' : 'N/A'}
Shift-left: ${(shiftLeft.cc_resolved_pct * 100).toFixed(0)}% resolved at CC
AI: ${aiImpact.decisions_count} decisions, ${aiImpact.autonomous_rate !== null ? (aiImpact.autonomous_rate * 100).toFixed(0) + '% autonomous' : 'N/A'}
Incidents: ${incidents.length} this week
Flagged for attention: ${flagged.map(f => `${f.ticket_key}: ${f.summary} (score: ${f.risk_score})`).join('; ') || 'None'}
Team: ${teamPerf.map(a => `${a.agent_name}: ${a.volume} tickets, QA ${a.qa_avg?.toFixed(0) ?? 'N/A'}`).join('; ')}

Generate a brief headline, up to 3 key decisions needing attention (with context and recommendation), and a next-week outlook paragraph.`,
      OpsHeadlineSchema,
      { callType: 'ops_pack', tier: 'cheap', temperature: 0.3 },
    );

    const content: OpsPackContent = {
      headline: llmResult.data.headline,
      queue_health: queueHealth,
      sla_compliance: sla,
      shift_left: shiftLeft,
      ai_impact: aiImpact,
      decisions_needed: llmResult.data.decisions_needed.map(d => ({
        title: d.title,
        context: d.context,
        recommendation: d.recommendation,
        ticket_keys: flagged.filter(f => d.context.includes(f.ticket_key)).map(f => f.ticket_key),
      })),
      team_performance: teamPerf,
      incidents_this_week: incidents,
      next_week_outlook: llmResult.data.next_week_outlook,
    };

    const id = await executeAndGetId(
      `INSERT INTO ops_meeting_packs (generated_by, period_start, period_end, content_json)
       VALUES (?, ?, ?, ?)`,
      [userId, periodStartStr, periodEndStr, JSON.stringify(content)],
    );

    return {
      id, generated_by: userId, period_start: periodStartStr, period_end: periodEndStr,
      content, generated_at: now.toISOString(),
    };
  }

  private async getQueueHealth(project: string, since: Date): Promise<OpsPackContent['queue_health']> {
    const [total, resolved, open, prevTotal] = await Promise.all([
      query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ? AND jira_created >= ?`, [project, since]),
      query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ? AND status_category = 'Done' AND jira_updated >= ?`, [project, since]),
      query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ? AND status_category != 'Done'`, [project]),
      query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ? AND jira_created >= DATEADD(day, -14, GETUTCDATE()) AND jira_created < ?`, [project, since]),
    ]);

    const vol = total[0]?.cnt ?? 0;
    const res = resolved[0]?.cnt ?? 0;
    const prevVol = prevTotal[0]?.cnt ?? 0;

    const avgHandle = await query<{ avg_hours: number | null }>(
      `SELECT AVG(DATEDIFF(HOUR, jira_created, COALESCE(jira_updated, GETUTCDATE()))) AS avg_hours
       FROM jira_issue_cache WHERE project_key = ? AND status_category = 'Done' AND jira_updated >= ?`,
      [project, since],
    );

    return {
      total_volume: vol,
      resolved: res,
      resolution_rate: vol > 0 ? res / vol : 0,
      avg_handle_hours: avgHandle[0]?.avg_hours ?? null,
      queue_depth: open[0]?.cnt ?? 0,
      trend_vs_last_week: prevVol > 0 ? `${((vol - prevVol) / prevVol * 100).toFixed(0)}% vs last week` : 'no prior data',
    };
  }

  private async getSlaCompliance(project: string, since: Date): Promise<OpsPackContent['sla_compliance']> {
    const breached = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND sla_breached = 1 AND jira_updated >= ?`,
      [project, since],
    );
    const total = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND jira_updated >= ?`,
      [project, since],
    );
    const totalCnt = total[0]?.cnt ?? 0;
    const breachedCnt = breached[0]?.cnt ?? 0;

    return {
      frt_rate: totalCnt > 0 ? (totalCnt - breachedCnt) / totalCnt : null,
      resolution_rate: totalCnt > 0 ? (totalCnt - breachedCnt) / totalCnt : null,
      next_update_rate: null,
    };
  }

  private async getShiftLeft(project: string, since: Date): Promise<OpsPackContent['shift_left']> {
    const ccResolved = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_category = 'Done' AND jira_updated >= ?
         AND (current_tier IS NULL OR current_tier = 'CC' OR current_tier = '1')`,
      [project, since],
    );
    const totalResolved = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_category = 'Done' AND jira_updated >= ?`,
      [project, since],
    );
    const cc = ccResolved[0]?.cnt ?? 0;
    const total = totalResolved[0]?.cnt ?? 0;

    return {
      cc_resolved_pct: total > 0 ? cc / total : 0,
      trend: 'stable',
    };
  }

  private async getAiImpact(since: Date): Promise<OpsPackContent['ai_impact']> {
    const decisions = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions WHERE created_at >= ?`, [since],
    );
    const autonomous = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE created_at >= ? AND outcome = 'executed'`, [since],
    );
    const total = decisions[0]?.cnt ?? 0;
    const auto = autonomous[0]?.cnt ?? 0;

    return {
      autonomous_rate: total > 0 ? auto / total : null,
      queue_hours_saved: null,
      decisions_count: total,
    };
  }

  private async getTeamPerformance(project: string, since: Date): Promise<OpsPackContent['team_performance']> {
    const agents = await query<{
      agent_name: string; volume: number; qa_avg: number | null;
    }>(
      `SELECT
         jic.assignee_display AS agent_name,
         COUNT(*) AS volume,
         AVG(CAST(JSON_VALUE(ac.golden_rule_scores, '$.overall') AS FLOAT)) AS qa_avg
       FROM jira_issue_cache jic
       LEFT JOIN agent_coaching ac ON ac.ticket_id = jic.issue_key AND ac.golden_rule_scores IS NOT NULL
       WHERE jic.project_key = ? AND jic.jira_updated >= ?
         AND jic.assignee_display IS NOT NULL
       GROUP BY jic.assignee_display
       ORDER BY volume DESC`,
      [project, since],
    );

    const avgVolume = agents.length > 0 ? agents.reduce((s, a) => s + a.volume, 0) / agents.length : 0;

    return agents.map(a => ({
      agent_name: a.agent_name,
      volume: a.volume,
      qa_avg: a.qa_avg,
      status: (a.volume < avgVolume * 0.7 ? 'needs_support' : a.volume > avgVolume * 1.3 ? 'ahead' : 'on_track') as 'ahead' | 'on_track' | 'needs_support',
    }));
  }

  private async getIncidents(since: Date): Promise<OpsPackContent['incidents_this_week']> {
    return query<{ summary: string; ticket_count: number; status: string }>(
      `SELECT summary, ticket_count, status
       FROM agent_incidents WHERE detected_at >= ?
       ORDER BY detected_at DESC`,
      [since],
    );
  }

  async getLatest(): Promise<OpsPack | null> {
    const rows = await query<{
      id: number; generated_by: number | null; period_start: string | null;
      period_end: string | null; content_json: string; generated_at: string;
    }>(`SELECT TOP 1 * FROM ops_meeting_packs ORDER BY generated_at DESC`);
    if (rows.length === 0) return null;
    const r = rows[0];
    return { ...r, content: JSON.parse(r.content_json) };
  }

  async getHistory(limit: number = 10): Promise<Array<{
    id: number; period_start: string | null; period_end: string | null; generated_at: string;
  }>> {
    return query(
      `SELECT TOP (?) id, period_start, period_end, generated_at
       FROM ops_meeting_packs ORDER BY generated_at DESC`,
      [limit],
    );
  }

  async getById(id: number): Promise<OpsPack | null> {
    const rows = await query<{
      id: number; generated_by: number | null; period_start: string | null;
      period_end: string | null; content_json: string; generated_at: string;
    }>(`SELECT * FROM ops_meeting_packs WHERE id = ?`, [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return { ...r, content: JSON.parse(r.content_json) };
  }
}
