import sql from 'mssql';

import { query } from './database.js';
import { getKpiPool } from './kpi-pipeline.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

/**
 * The signals a 1-2-1 prep needs beyond raw KPI averages — escalations, AI-agent
 * interaction, outstanding coaching signals, named QA tickets, and movement against the
 * previous period.
 *
 * WHERE THIS CAME FROM. NOVA had two 1-2-1 prep generators. `generatePrepForAgent` is the
 * one wired into the loop — the 07:00 job calls it, its output is emailed and read at
 * stage 2 of the click-through. `Briefing121Service` was a second, richer one behind an
 * AI Agent → 1-2-1 Prep tab, with its own table and routes.
 *
 * It had never run. `agent_121_briefings` held ZERO rows on 2026-08-27, and it would
 * have been largely empty if it had: the view passed the agent's DISPLAY NAME as
 * `agentId` ([App.tsx](../../client/App.tsx) `<Briefing121View agentId={selectedAgentName}>`),
 * while the queries match `jira_issue_cache.assignee_account_id` and
 * `agent_training_signals.agent_id`, both of which hold a Jira ACCOUNT ID. Ticket
 * performance, escalations, coaching signals, autonomy interaction and the trends
 * derived from them all silently returned nothing. Only the QA half worked, because it
 * happened to key on the name.
 *
 * So the ideas were sound and the wiring never was. This is that content, keyed properly
 * and folded into the prep that actually runs.
 *
 * ⚠ EVERY GATHERER FAILS SOFT. A 1-2-1 prep that refuses to generate because the agent
 * has no Jira account id, or because the KPI pool is briefly down, is worse than one
 * missing a section — the day-before job is the only thing that sends it, and a throw
 * there means the agent gets no prep email at all. Each block returns null and says so.
 */

export interface EscalationSignal {
  count: number;
  /** Share of the agent's escalations the predictor later judged correct. Null when
   *  nothing has been scored — NOT zero, which would read as "all of them wrong". */
  appropriateRate: number | null;
}

export interface AutonomySignal {
  approvals: number;
  rejections: number;
}

export interface CoachingSignal {
  signalType: string;
  detail: string;
  requestType: string | null;
}

export interface QaTicket {
  ticketKey: string;
  score: number;
  grade: string | null;
}

export interface PeriodTrend {
  metric: string;
  direction: 'improving' | 'declining' | 'stable';
  detail: string;
}

export interface PrepSignals {
  /** Null when the agent's Jira account id could not be resolved — which disables
   *  everything keyed on it, and is worth saying rather than showing as zeros. */
  accountId: string | null;
  escalations: EscalationSignal | null;
  autonomy: AutonomySignal | null;
  coaching: CoachingSignal[];
  qaBest: QaTicket[];
  qaWorst: QaTicket[];
  trends: PeriodTrend[];
  /** Anything that could not be gathered, named. An empty section and a failed query
   *  look identical on a page otherwise. */
  unavailable: string[];
}

/** Movement below this is noise, not a trend worth raising in a 1-2-1. */
const TREND_NOISE_PCT = 10;

/**
 * Resolve a display name to a Jira account id via `dbo.Agent` — the same table the
 * round-robin and standup roster treat as authoritative.
 *
 * This is the lookup whose absence made the old briefing service a no-op.
 */
export async function resolveAccountId(settings: FileSettingsQueries, agentName: string): Promise<string | null> {
  try {
    const pool = await getKpiPool(settings);
    const r = await pool.request()
      .input('name', sql.NVarChar, agentName)
      .query<{ AccountId: string | null }>(`
        SELECT TOP 1 AccountId FROM dbo.Agent
        WHERE IsActive = 1
          AND LTRIM(RTRIM(ISNULL(AgentName,'') + ' ' + ISNULL(AgentSurname,''))) = @name
      `);
    const raw = r.recordset[0]?.AccountId?.trim();
    if (!raw) return null;
    // dbo.Agent stores it URL-encoded; standup-roster decodes the same way.
    try { return decodeURIComponent(raw); } catch { return raw; }
  } catch {
    return null;
  }
}

/** Escalations the agent raised, and how many the predictor later judged correct. */
async function getEscalations(accountId: string, since: string): Promise<EscalationSignal | null> {
  try {
    const counted = await query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM agent_decisions
      WHERE action LIKE 'escalate%' AND created_at >= ?
        AND ticket_id IN (SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?)
    `, [since, accountId]);

    const scored = await query<{ total: number; correct: number | null }>(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct
      FROM agent_escalation_predictions
      WHERE predicted_at >= ? AND actual_outcome IS NOT NULL
        AND ticket_key IN (SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?)
    `, [since, accountId]);

    const total = scored[0]?.total ?? 0;
    return {
      count: counted[0]?.cnt ?? 0,
      appropriateRate: total > 0 ? (scored[0].correct ?? 0) / total : null,
    };
  } catch {
    return null;
  }
}

/** How the agent has been treating the AI agent's suggestions on their own tickets. */
async function getAutonomy(accountId: string, since: string): Promise<AutonomySignal | null> {
  try {
    const rows = await query<{ outcome: string; cnt: number }>(`
      SELECT outcome, COUNT(*) AS cnt FROM agent_decisions
      WHERE outcome IN ('approved','rejected') AND created_at >= ?
        AND ticket_id IN (SELECT issue_key FROM jira_issue_cache WHERE assignee_account_id = ?)
      GROUP BY outcome
    `, [since, accountId]);
    if (rows.length === 0) return null;
    return {
      approvals: rows.find((r) => r.outcome === 'approved')?.cnt ?? 0,
      rejections: rows.find((r) => r.outcome === 'rejected')?.cnt ?? 0,
    };
  } catch {
    return null;
  }
}

/** Training signals raised about this agent and not yet actioned. */
async function getCoaching(accountId: string): Promise<CoachingSignal[]> {
  try {
    const rows = await query<{ signal_type: string; recommendation: string | null; request_type: string | null }>(`
      SELECT signal_type, recommendation, request_type
      FROM agent_training_signals
      WHERE agent_id = ? AND actioned = 0
      ORDER BY generated_at DESC
    `, [accountId]);
    return rows.map((r) => ({
      signalType: r.signal_type,
      detail: r.recommendation ?? '',
      requestType: r.request_type,
    }));
  } catch {
    return [];
  }
}

/**
 * Ticket volume and MTTR against the equivalent window before it.
 *
 * A falling MTTR is an improvement and a rising one is not, which is the opposite of
 * volume — hence the per-metric direction rather than a shared comparison.
 */
async function getTrends(accountId: string, since: string): Promise<PeriodTrend[]> {
  try {
    const days = Math.max(1, Math.round((Date.now() - new Date(`${since}T00:00:00Z`).getTime()) / 86_400_000));
    const priorStart = new Date(Date.now() - days * 2 * 86_400_000).toISOString().slice(0, 10);

    const rows = await query<{ period: string; volume: number; mttr: number | null }>(`
      SELECT 'current' AS period,
             COUNT(*) AS volume,
             AVG(CAST(DATEDIFF(HOUR, jira_created, resolved_date) AS FLOAT)) AS mttr
      FROM jira_issue_cache
      WHERE assignee_account_id = ? AND resolved_date >= ?
      UNION ALL
      SELECT 'prior',
             COUNT(*),
             AVG(CAST(DATEDIFF(HOUR, jira_created, resolved_date) AS FLOAT))
      FROM jira_issue_cache
      WHERE assignee_account_id = ? AND resolved_date >= ? AND resolved_date < ?
    `, [accountId, since, accountId, priorStart, since]);

    const cur = rows.find((r) => r.period === 'current');
    const prev = rows.find((r) => r.period === 'prior');
    if (!cur || !prev) return [];

    const trends: PeriodTrend[] = [];
    const pct = (now: number, before: number) => ((now - before) / before) * 100;

    if (prev.volume > 0) {
      const change = pct(cur.volume, prev.volume);
      trends.push({
        metric: 'Resolved volume',
        direction: Math.abs(change) < TREND_NOISE_PCT ? 'stable' : change > 0 ? 'improving' : 'declining',
        detail: `${cur.volume} resolved (${change > 0 ? '+' : ''}${change.toFixed(0)}% vs the previous ${days} days)`,
      });
    }
    if (cur.mttr != null && prev.mttr != null && prev.mttr > 0) {
      const change = pct(cur.mttr, prev.mttr);
      trends.push({
        metric: 'Time to resolve',
        // Faster is better — inverted against volume on purpose.
        direction: Math.abs(change) < TREND_NOISE_PCT ? 'stable' : change < 0 ? 'improving' : 'declining',
        detail: `${cur.mttr.toFixed(1)}h average (${change > 0 ? '+' : ''}${change.toFixed(0)}% vs the previous ${days} days)`,
      });
    }
    return trends;
  } catch {
    return [];
  }
}

/**
 * Best and worst QA tickets BY NAME, from rows the caller already fetched.
 *
 * No extra query: `generatePrepForAgent` already pulls the agent's recent
 * `dbo.jira_qa_results`, and the old briefing service ran three more round-trips against
 * a different QA table to get the same three facts. Named tickets are the point — "your
 * QA average is 7.2" is not a conversation, "NT-28061 scored 4.5" is.
 */
export function pickQaExtremes(
  qaRows: Array<{ issueKey: string; overallScore: number | null; grade: string | null }>,
  take = 3,
): { best: QaTicket[]; worst: QaTicket[] } {
  const scored = qaRows
    .filter((r) => r.issueKey && r.overallScore != null && !isNaN(Number(r.overallScore)))
    .map((r) => ({ ticketKey: r.issueKey, score: Number(r.overallScore), grade: r.grade ?? null }));
  if (scored.length === 0) return { best: [], worst: [] };

  const ascending = [...scored].sort((a, b) => a.score - b.score);
  // With few results the same ticket would head both lists, which reads as a
  // contradiction. Below the threshold, report the weakest only — that is the half a
  // 1-2-1 is for.
  if (scored.length < take * 2) return { best: [], worst: ascending.slice(0, take) };
  return { best: [...ascending].reverse().slice(0, take), worst: ascending.slice(0, take) };
}

/** Gather everything. Never throws — see the note at the top of the file. */
export async function gatherPrepSignals(
  settings: FileSettingsQueries,
  agentName: string,
  sinceDate: string,
  qaRows: Array<{ issueKey: string; overallScore: number | null; grade: string | null }>,
): Promise<PrepSignals> {
  const { best, worst } = pickQaExtremes(qaRows);
  const unavailable: string[] = [];

  const accountId = await resolveAccountId(settings, agentName);
  if (!accountId) {
    // Say it once, plainly. Five sections silently reading zero is exactly the failure
    // that made the old briefing tab look like a working screen.
    unavailable.push('Jira account id could not be resolved — escalations, AI-agent interaction, coaching signals and trends are unavailable for this agent');
    return { accountId: null, escalations: null, autonomy: null, coaching: [], qaBest: best, qaWorst: worst, trends: [], unavailable };
  }

  const [escalations, autonomy, coaching, trends] = await Promise.all([
    getEscalations(accountId, sinceDate),
    getAutonomy(accountId, sinceDate),
    getCoaching(accountId),
    getTrends(accountId, sinceDate),
  ]);

  if (escalations === null) unavailable.push('escalation analysis');

  return { accountId, escalations, autonomy, coaching, qaBest: best, qaWorst: worst, trends, unavailable };
}

/** Render the signals as the prompt block the LLM reasons over. */
export function signalsToPrompt(s: PrepSignals): string {
  const lines: string[] = [];

  lines.push('## Escalations');
  if (s.escalations) {
    lines.push(`- ${s.escalations.count} escalation(s) in the period` +
      (s.escalations.appropriateRate !== null
        ? `, ${(s.escalations.appropriateRate * 100).toFixed(0)}% judged appropriate afterwards`
        : ', appropriateness not scored'));
  } else {
    lines.push('- Not available');
  }

  lines.push('', '## AI agent interaction');
  lines.push(s.autonomy
    ? `- Approved ${s.autonomy.approvals}, rejected ${s.autonomy.rejections} of the AI agent's suggestions on their tickets`
    : '- No AI-agent decisions on their tickets in the period');

  lines.push('', '## Outstanding coaching signals');
  lines.push(s.coaching.length
    ? s.coaching.map((c) => `- ${c.signalType}${c.requestType ? ` (${c.requestType})` : ''}: ${c.detail}`).join('\n')
    : '- None outstanding');

  lines.push('', '## QA — named tickets');
  lines.push(s.qaWorst.length
    ? `Weakest: ${s.qaWorst.map((t) => `${t.ticketKey} (${t.score}${t.grade ? `, ${t.grade}` : ''})`).join(', ')}`
    : 'Weakest: none scored');
  if (s.qaBest.length) {
    lines.push(`Strongest: ${s.qaBest.map((t) => `${t.ticketKey} (${t.score})`).join(', ')}`);
  }

  lines.push('', '## Movement vs the previous period');
  lines.push(s.trends.length
    ? s.trends.map((t) => `- ${t.metric}: ${t.direction} — ${t.detail}`).join('\n')
    : '- Not enough history to compare');

  if (s.unavailable.length) {
    // In the prompt too, so the model cannot present a gap as a finding.
    lines.push('', `## Could not be gathered (do NOT treat as zero)`, ...s.unavailable.map((u) => `- ${u}`));
  }

  return lines.join('\n');
}
