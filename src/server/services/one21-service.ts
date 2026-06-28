/**
 * 1-2-1 closed loop — shared business logic for the scheduled day-before prep job
 * (index.ts) and the agent-facing submission form (routes/one21-public.ts).
 *
 * Mirrors the standup loop (services/standup-service.ts): generate prep, email both
 * parties, agent answers come back into NOVA. See agent_work/ba/one-to-one-loop-spec.md.
 */
import { randomBytes } from 'node:crypto';
import { query, queryOne, execute, executeAndGetId } from './database.js';
import { getKpiPool } from './kpi-pipeline.js';
import { generatePrepForAgent } from '../routes/people.js';
import { getPrepQuestions, prepEmailIntro, managerSummaryIntro } from '../config/one21-config.js';
import { one21PrepAgentHtml, one21PrepManagerHtml, one21WeeklyKpiHtml } from './email-templates.js';
import { nickEmail, novaBaseUrl } from '../config/standup-config.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { EmailService } from './email.js';
import type { PlaudService } from './plaud-service.js';

export interface One21Deps {
  settingsQueries: FileSettingsQueries;
  notificationQueries: NotificationQueries;
  emailService: EmailService;
  plaudService: PlaudService;
}

export interface One21Session {
  id: number;
  agent_name: string;
  scheduled_date: string;
  status: string;
  prep_snapshot_id: number | null;
  agent_submission_json: string | null;
  agent_submitted_at: string | null;
  submit_token: string | null;
}

/** YYYY-MM-DD for "tomorrow" in UK time. */
export function ukTomorrow(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/** Human display date, e.g. "Monday 15 June". */
export function displayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}

// ── Email dedup (agent_121_email_log, unique on (kind, dedup_key)) ──

async function emailAlreadySent(kind: string, dedupKey: string): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT TOP 1 id FROM agent_121_email_log WHERE kind = ? AND dedup_key = ?`,
    [kind, dedupKey],
  );
  return !!row;
}

async function logEmailSent(sessionId: number | null, agentName: string, kind: string, dedupKey: string): Promise<void> {
  try {
    await execute(
      `INSERT INTO agent_121_email_log (session_id, agent_name, kind, dedup_key) VALUES (?, ?, ?, ?)`,
      [sessionId, agentName, kind, dedupKey],
    );
  } catch { /* unique-constraint race — already logged, ignore */ }
}

// ── Agent email lookup (dbo.Agent — same source as the standup roster) ──

let emailCache: { at: number; map: Map<string, string> } | null = null;

async function getAgentEmail(settings: FileSettingsQueries, agentName: string): Promise<string | null> {
  if (!emailCache || Date.now() - emailCache.at > 5 * 60 * 1000) {
    const map = new Map<string, string>();
    try {
      const pool = await getKpiPool(settings);
      const result = await pool.request().query<{ AgentName: string | null; AgentSurname: string | null; AgentKey: string | null }>(`
        SELECT AgentName, AgentSurname, AgentKey FROM dbo.Agent WHERE IsActive = 1
      `);
      for (const r of result.recordset) {
        const name = [r.AgentName?.trim(), r.AgentSurname?.trim()].filter(Boolean).join(' ');
        if (name && r.AgentKey?.trim()) map.set(name.toLowerCase(), r.AgentKey.trim());
      }
    } catch { /* KPI pool down — return null below */ }
    emailCache = { at: Date.now(), map };
  }
  return emailCache.map.get(agentName.toLowerCase()) ?? null;
}

// ── Session helpers (used by the public submission form) ──

export async function getSessionByToken(token: string): Promise<One21Session | null> {
  if (!token || token.length < 16) return null;
  return (await queryOne<One21Session>(`
    SELECT TOP 1 id, agent_name, scheduled_date, status, prep_snapshot_id,
           agent_submission_json, agent_submitted_at, submit_token
    FROM agent_121_sessions WHERE submit_token = ?
  `, [token])) ?? null;
}

/** Agent can edit prep answers until the manager opens the session (in_progress). */
export function isSubmissionEditable(status: string): boolean {
  return status === 'awaiting_agent' || status === 'ready';
}

export async function saveAgentSubmission(
  token: string,
  answers: Array<{ question: string; answer: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionByToken(token);
  if (!session) return { ok: false, error: 'This 1-2-1 prep link is not valid.' };
  if (!isSubmissionEditable(session.status)) {
    return { ok: false, error: 'This 1-2-1 is already underway — your answers can no longer be changed.' };
  }
  await execute(`
    UPDATE agent_121_sessions
    SET agent_submission_json = ?, agent_submitted_at = GETUTCDATE(), status = 'ready'
    WHERE id = ?
  `, [JSON.stringify(answers), session.id]);
  return { ok: true };
}

// ── Click-through session (Phase 3) ──

const OPEN_STATUSES = ['scheduled', 'prep_sent', 'awaiting_agent', 'ready', 'in_progress'];
// Actions still owed (shown in stage 1 for review).
const OUTSTANDING_ACTION_STATUSES = ['pending', 'open', 'in_progress', 'carried_over'];

/** Get the agent's open session (or create one for today), and mark it in_progress. */
export async function startSession(settings: FileSettingsQueries, agentName: string): Promise<number> {
  const open = await queryOne<{ id: number }>(`
    SELECT TOP 1 id FROM agent_121_sessions
    WHERE agent_name = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
    ORDER BY scheduled_date ASC
  `, [agentName, ...OPEN_STATUSES]);

  let sessionId: number;
  if (open) {
    sessionId = open.id;
  } else {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    sessionId = await executeAndGetId(`
      INSERT INTO agent_121_sessions (agent_name, scheduled_date, status)
      VALUES (?, ?, 'in_progress')
    `, [agentName, today]);
  }
  await execute(`UPDATE agent_121_sessions SET status = 'in_progress' WHERE id = ?`, [sessionId]);
  return sessionId;
}

async function getAgentKpis(settings: FileSettingsQueries, agentName: string): Promise<{
  summary: Record<string, number | null>;
  trend: Array<Record<string, any>>;
} | null> {
  try {
    const pool = await getKpiPool(settings);
    const r = await pool.request().input('agent', agentName).query(`
      SELECT TOP 30 ReportDate, TierCode, Team, TicketsPerHour, SolvedTickets_Today,
             QAOverallAvg, GoldenRulesAvg, SLABreachedCount, SLACompliancePct,
             CSATAverage, OldestTicketDays
      FROM dbo.jira_agent_kpi_daily
      WHERE AgentName = @agent
      ORDER BY ReportDate DESC
    `);
    const rows = r.recordset as any[];
    if (!rows.length) return { summary: {}, trend: [] };
    const avg = (key: string) => {
      const vals = rows.map((x) => x[key]).filter((v) => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const solvedTotal = rows.reduce((s, x) => s + (x.SolvedTickets_Today ?? 0), 0);
    const breached = rows.reduce((s, x) => s + (x.SLABreachedCount ?? 0), 0);
    return {
      summary: {
        slaCompliancePct: solvedTotal === 0 ? null : ((solvedTotal - breached) / solvedTotal) * 100,
        qaOverallAvg: avg('QAOverallAvg'),
        goldenRulesAvg: avg('GoldenRulesAvg'),
        ticketsPerHourAvg: avg('TicketsPerHour'),
        csatAvg: avg('CSATAverage'),
        oldestTicketDays: avg('OldestTicketDays'),
        solvedTotal,
        periodDays: rows.length,
      },
      trend: rows.slice(0, 10).map((x) => ({
        date: x.ReportDate, resolved: x.SolvedTickets_Today, tph: x.TicketsPerHour,
        qa: x.QAOverallAvg, gr: x.GoldenRulesAvg,
      })),
    };
  } catch {
    return null;
  }
}

export async function getSessionDetail(settings: FileSettingsQueries, sessionId: number): Promise<any | null> {
  const session = await queryOne<One21Session & { notes_text: string | null; completed_at: string | null }>(`
    SELECT id, agent_name, scheduled_date, status, prep_snapshot_id, agent_submission_json,
           agent_submitted_at, submit_token, notes_text, completed_at
    FROM agent_121_sessions WHERE id = ?
  `, [sessionId]);
  if (!session) return null;

  // Prep snapshot (from the day-before generation, or latest for the agent).
  let prep: any = null;
  let metrics: any = null;
  const snapRow = session.prep_snapshot_id
    ? await queryOne<{ prep_json: string | null; metrics_json: string | null }>(
        `SELECT prep_json, metrics_json FROM agent_121_snapshots WHERE id = ?`, [session.prep_snapshot_id])
    : await queryOne<{ prep_json: string | null; metrics_json: string | null }>(
        `SELECT TOP 1 prep_json, metrics_json FROM agent_121_snapshots WHERE agent_name = ? ORDER BY snapshot_date DESC`, [session.agent_name]);
  if (snapRow?.prep_json) { try { prep = JSON.parse(snapRow.prep_json); } catch { /* ignore */ } }
  if (snapRow?.metrics_json) { try { metrics = JSON.parse(snapRow.metrics_json); } catch { /* ignore */ } }

  let prepAnswers: Array<{ question: string; answer: string }> = [];
  if (session.agent_submission_json) { try { prepAnswers = JSON.parse(session.agent_submission_json); } catch { /* ignore */ } }

  // Stage 1 — outstanding actions from prior 1-2-1s.
  const outstandingActions = await query(`
    SELECT id, description, owner, due_date, status, snapshot_id, session_id, created_at
    FROM agent_121_actions
    WHERE agent_name = ? AND status IN (${OUTSTANDING_ACTION_STATUSES.map(() => '?').join(',')})
    ORDER BY created_at ASC
  `, [session.agent_name, ...OUTSTANDING_ACTION_STATUSES]);

  // Stage 5 — actions already created in THIS session.
  const newActions = await query(`
    SELECT id, description, owner, due_date, status, created_at
    FROM agent_121_actions WHERE session_id = ?
    ORDER BY created_at ASC
  `, [sessionId]);

  // Stage 2 — KPIs.
  const kpis = await getAgentKpis(settings, session.agent_name);

  // Last completed 1-2-1 + cadence.
  const last = await queryOne<{ last_date: string }>(
    `SELECT MAX(scheduled_date) AS last_date FROM agent_121_sessions WHERE agent_name = ? AND status = 'complete' AND id <> ?`,
    [session.agent_name, sessionId]);
  const plan = await queryOne<{ one21_cadence_days: number | null }>(
    `SELECT TOP 1 one21_cadence_days FROM agent_development_plans WHERE agent_name = ? AND status IN ('active','deferred')`,
    [session.agent_name]);
  const cadenceDays = plan?.one21_cadence_days ?? 28;

  return {
    session: {
      id: session.id, agent_name: session.agent_name, scheduled_date: session.scheduled_date,
      status: session.status, notes_text: session.notes_text, completed_at: session.completed_at,
      agent_submitted_at: session.agent_submitted_at,
    },
    prep, metrics, prepAnswers, outstandingActions, newActions, kpis,
    lastDate: last?.last_date ?? null, cadenceDays,
  };
}

/** Valid action review statuses for stage 1. */
export const ACTION_REVIEW_STATUSES = new Set(['delivered', 'missed', 'carried_over', 'pending']);

export async function updateActionStatus(actionId: number, status: string): Promise<void> {
  const completedClause = status === 'delivered' ? ', completed_at = GETUTCDATE()' : '';
  await execute(`UPDATE agent_121_actions SET status = ?${completedClause} WHERE id = ?`, [status, actionId]);
}

export async function addSessionAction(
  sessionId: number, agentName: string,
  action: { description: string; owner?: string | null; due_date?: string | null },
): Promise<number> {
  return executeAndGetId(`
    INSERT INTO agent_121_actions (session_id, agent_name, description, owner, due_date, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `, [sessionId, agentName, action.description, action.owner ?? null, action.due_date ?? null]);
}

export async function updateSessionNotes(sessionId: number, notes: string): Promise<void> {
  await execute(`UPDATE agent_121_sessions SET notes_text = ? WHERE id = ?`, [notes, sessionId]);
}

/**
 * Complete the session and schedule the next one. `nextDate` wins; otherwise computed
 * from the agent's cadence. Outstanding actions are left as-is (those marked
 * 'carried_over' surface again in the next session's stage 1).
 */
export async function completeSession(sessionId: number, nextDate?: string): Promise<{ nextSessionId: number | null; nextDate: string | null }> {
  const session = await queryOne<{ agent_name: string }>(`SELECT agent_name FROM agent_121_sessions WHERE id = ?`, [sessionId]);
  if (!session) return { nextSessionId: null, nextDate: null };

  await execute(`UPDATE agent_121_sessions SET status = 'complete', completed_at = GETUTCDATE() WHERE id = ?`, [sessionId]);

  // Determine next date.
  let resolvedNext = nextDate && /^\d{4}-\d{2}-\d{2}$/.test(nextDate) ? nextDate : null;
  if (!resolvedNext) {
    const plan = await queryOne<{ one21_cadence_days: number | null }>(
      `SELECT TOP 1 one21_cadence_days FROM agent_development_plans WHERE agent_name = ? AND status IN ('active','deferred')`,
      [session.agent_name]);
    const cadence = plan?.one21_cadence_days ?? 28;
    const d = new Date(Date.now() + cadence * 86_400_000);
    resolvedNext = d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  }

  // Don't double-book: only create if no open session already exists.
  const existingOpen = await queryOne<{ id: number }>(`
    SELECT TOP 1 id FROM agent_121_sessions
    WHERE agent_name = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `, [session.agent_name, ...OPEN_STATUSES]);
  if (existingOpen) return { nextSessionId: existingOpen.id, nextDate: null };

  const nextSessionId = await executeAndGetId(`
    INSERT INTO agent_121_sessions (agent_name, scheduled_date, status)
    VALUES (?, ?, 'scheduled')
  `, [session.agent_name, resolvedNext]);
  return { nextSessionId, nextDate: resolvedNext };
}

// ── Manager overview ──

export interface One21OverviewAgent {
  agent_name: string;
  nextDate: string | null;
  nextStatus: string | null;
  overdue: boolean;
  dueThisWeek: boolean;
  awaitingPrep: boolean;     // emailed prep questions, agent hasn't submitted yet
  prepSubmitted: boolean;    // agent has submitted for the open session
  lastDate: string | null;
  outstandingActions: number;
  delivered: number;
  missed: number;
  deliveryRate: number | null;
}

export interface One21Overview {
  agents: One21OverviewAgent[];
  summary: {
    total: number; scheduled: number; overdue: number; dueThisWeek: number;
    awaitingPrep: number; neverScheduled: number; deliveryRate: number | null;
  };
}

/** Whole-team 1-2-1 health for the manager overview dashboard. */
export async function getOne21Overview(): Promise<One21Overview> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

  const plans = await query<{ agent_name: string }>(
    `SELECT agent_name FROM agent_development_plans WHERE status IN ('active','deferred') ORDER BY agent_name`);

  const openSessions = await query<{ agent_name: string; scheduled_date: string; status: string; agent_submitted_at: string | null }>(`
    SELECT s.agent_name, s.scheduled_date, s.status, s.agent_submitted_at
    FROM agent_121_sessions s
    INNER JOIN (
      SELECT agent_name, MIN(scheduled_date) AS d FROM agent_121_sessions
      WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')}) GROUP BY agent_name
    ) m ON m.agent_name = s.agent_name AND m.d = s.scheduled_date
    WHERE s.status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `, [...OPEN_STATUSES, ...OPEN_STATUSES]);
  const openByAgent = new Map(openSessions.map((s) => [s.agent_name, s]));

  const lastRows = await query<{ agent_name: string; last_date: string }>(
    `SELECT agent_name, MAX(scheduled_date) AS last_date FROM agent_121_sessions WHERE status = 'complete' GROUP BY agent_name`);
  const lastByAgent = new Map(lastRows.map((r) => [r.agent_name, r.last_date]));

  const actionRows = await query<{ agent_name: string; status: string; n: number }>(
    `SELECT agent_name, status, COUNT(*) AS n FROM agent_121_actions GROUP BY agent_name, status`);
  const actionsByAgent = new Map<string, Record<string, number>>();
  for (const r of actionRows) {
    const m = actionsByAgent.get(r.agent_name) ?? {};
    m[r.status] = r.n;
    actionsByAgent.set(r.agent_name, m);
  }

  const agents: One21OverviewAgent[] = plans.map((p) => {
    const open = openByAgent.get(p.agent_name) ?? null;
    const a = actionsByAgent.get(p.agent_name) ?? {};
    const outstanding = (a['pending'] ?? 0) + (a['open'] ?? 0) + (a['in_progress'] ?? 0) + (a['carried_over'] ?? 0);
    const delivered = a['delivered'] ?? 0;
    const missed = a['missed'] ?? 0;
    const reviewed = delivered + missed;
    const submitted = !!open?.agent_submitted_at;
    return {
      agent_name: p.agent_name,
      nextDate: open?.scheduled_date ?? null,
      nextStatus: open?.status ?? null,
      overdue: !!open && open.scheduled_date < today,
      dueThisWeek: !!open && open.scheduled_date >= today && open.scheduled_date <= weekAhead,
      awaitingPrep: open?.status === 'awaiting_agent' && !submitted,
      prepSubmitted: submitted,
      lastDate: lastByAgent.get(p.agent_name) ?? null,
      outstandingActions: outstanding,
      delivered, missed,
      deliveryRate: reviewed > 0 ? Math.round((delivered / reviewed) * 100) : null,
    };
  });

  const totalDelivered = agents.reduce((s, x) => s + x.delivered, 0);
  const totalMissed = agents.reduce((s, x) => s + x.missed, 0);
  const totalReviewed = totalDelivered + totalMissed;

  return {
    agents,
    summary: {
      total: agents.length,
      scheduled: agents.filter((x) => x.nextDate && !x.overdue).length,
      overdue: agents.filter((x) => x.overdue).length,
      dueThisWeek: agents.filter((x) => x.dueThisWeek).length,
      awaitingPrep: agents.filter((x) => x.awaitingPrep).length,
      neverScheduled: agents.filter((x) => !x.nextDate && !x.lastDate).length,
      deliveryRate: totalReviewed > 0 ? Math.round((totalDelivered / totalReviewed) * 100) : null,
    },
  };
}

// ── Weekly KPI email (Phase 5) — Friday PM, agent only, mirrors the My Team card ──

type Rag = 'green' | 'amber' | 'red' | 'grey';

function kpiRag(sla: number | null, tph: number | null): Rag {
  if (sla === null && tph === null) return 'grey';
  const slaOk = sla !== null && sla >= 95;
  const slaWarn = sla !== null && sla >= 85;
  const tphOk = tph !== null && tph >= 1.5;
  if (slaOk && tphOk) return 'green';
  if ((!slaWarn && sla !== null) || (!slaOk && !tphOk)) return 'red';
  return 'amber';
}
const qaRag = (s: number | null): Rag => s === null ? 'grey' : s >= 8 ? 'green' : s >= 6.5 ? 'amber' : 'red';
const grRag = (s: number | null): Rag => s === null ? 'grey' : s >= 2.5 ? 'green' : s >= 2.0 ? 'amber' : 'red';
const satRag = (s: number | null): Rag => s === null ? 'grey' : s >= 4 ? 'green' : s >= 3 ? 'amber' : 'red';
function trainingRag(done: number, total: number, overdue: number, dueSoon: number): Rag {
  if (total === 0) return 'grey';
  if (done >= total) return 'green';
  if (overdue > 0) return 'red';
  if (dueSoon > 0) return 'amber';
  return done > 0 ? 'green' : 'amber';
}

/** ISO week key like "2026-W26", used to dedup the weekly send. */
function isoWeekKey(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Latest survey's per-agent satisfaction scores (mirrors /roster/survey-scores). */
async function getSurveyScores(): Promise<Record<string, number>> {
  const survey = await queryOne<{ id: number }>(
    `SELECT TOP 1 id FROM surveys WHERE status IN ('active','closed') ORDER BY created_at DESC`);
  if (!survey) return {};
  const questions = await query<{ id: number }>(
    `SELECT id FROM survey_questions WHERE survey_id = ? AND question_type = 'scale_5'`, [survey.id]);
  if (questions.length === 0) return {};
  const qIds = new Set(questions.map((q) => q.id));
  const rows = await query<{ display_name: string; answers: string }>(`
    SELECT sr.display_name, resp.answers FROM survey_responses resp
    JOIN survey_recipients sr ON sr.token = resp.token AND sr.survey_id = resp.survey_id
    WHERE resp.survey_id = ?`, [survey.id]);
  const acc: Record<string, { sum: number; count: number }> = {};
  for (const row of rows) {
    try {
      const answers = JSON.parse(row.answers) as Array<{ question_id: number; value: string | number }>;
      for (const a of answers) {
        if (qIds.has(a.question_id)) {
          const v = Number(a.value);
          if (!isNaN(v) && v >= 1 && v <= 5) {
            acc[row.display_name] ??= { sum: 0, count: 0 };
            acc[row.display_name].sum += v;
            acc[row.display_name].count++;
          }
        }
      }
    } catch { /* skip bad JSON */ }
  }
  const out: Record<string, number> = {};
  for (const [name, { sum, count }] of Object.entries(acc)) out[name] = Math.round((sum / count) * 100) / 100;
  return out;
}

export interface WeeklyKpiResult { sent: number; skipped: number; noEmail: string[]; noData: string[] }

/**
 * Friday-PM weekly KPI email to each rostered agent (their own card metrics, RAG-coloured).
 * Idempotent per ISO week via agent_121_email_log (kind 'weekly_kpi').
 */
export async function runWeeklyKpiEmail(deps: One21Deps): Promise<WeeklyKpiResult> {
  const result: WeeklyKpiResult = { sent: 0, skipped: 0, noEmail: [], noData: [] };
  if (!deps.emailService.isConfigured()) return result;

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const plans = await query<{
    agent_name: string; training_done: number; training_total: number; training_overdue: number; training_due_soon: number;
  }>(`
    SELECT p.agent_name,
      (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id AND t.completed = 1) AS training_done,
      (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id) AS training_total,
      (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id AND t.completed = 0 AND t.target_date IS NOT NULL AND t.target_date < ?) AS training_overdue,
      (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id AND t.completed = 0 AND t.target_date IS NOT NULL AND t.target_date >= ? AND t.target_date <= ?) AS training_due_soon
    FROM agent_development_plans p WHERE p.status IN ('active','deferred') ORDER BY p.agent_name
  `, [today, today, soon]);

  const surveyScores = await getSurveyScores().catch(() => ({} as Record<string, number>));
  const weekKey = isoWeekKey();
  const weekDisplay = `week ${weekKey.split('-W')[1]}`;
  const fmt1 = (v: number | null) => (v == null || isNaN(v) ? '—' : v.toFixed(1));
  const fmtPct = (v: number | null) => (v == null || isNaN(v) ? '—' : `${v.toFixed(1)}%`);

  for (const p of plans) {
    const dedupKey = `${p.agent_name}:${weekKey}`;
    if (await emailAlreadySent('weekly_kpi', dedupKey)) { result.skipped++; continue; }

    const kpis = await getAgentKpis(deps.settingsQueries, p.agent_name);
    const s = kpis?.summary ?? {};
    const sla = (s.slaCompliancePct ?? null) as number | null;
    const tph = (s.ticketsPerHourAvg ?? null) as number | null;
    const qa = (s.qaOverallAvg ?? null) as number | null;
    const gr = (s.goldenRulesAvg ?? null) as number | null;
    const sat = surveyScores[p.agent_name] ?? null;

    const hasAnyKpi = sla !== null || qa !== null || gr !== null || tph !== null;
    if (!hasAnyKpi && p.training_total === 0 && sat === null) { result.noData.push(p.agent_name); continue; }

    const to = await getAgentEmail(deps.settingsQueries, p.agent_name);
    if (!to) { result.noEmail.push(p.agent_name); continue; }

    const rows = [
      { label: 'KPI health', value: fmtPct(sla), rag: kpiRag(sla, tph) },
      { label: 'QA average', value: fmt1(qa), rag: qaRag(qa) },
      { label: 'Golden rules', value: fmt1(gr), rag: grRag(gr) },
      { label: 'Tickets / hour', value: tph == null ? '—' : tph.toFixed(2), rag: (tph != null && tph >= 1.5 ? 'green' : tph != null && tph >= 1 ? 'amber' : tph != null ? 'red' : 'grey') as Rag },
      { label: 'Training', value: `${p.training_done}/${p.training_total}`, rag: trainingRag(p.training_done, p.training_total, p.training_overdue, p.training_due_soon) },
      { label: 'Satisfaction', value: fmt1(sat), rag: satRag(sat) },
    ];

    try {
      await deps.emailService.send({
        to,
        subject: `Your KPIs — ${weekDisplay}`,
        text: rows.map((r) => `${r.label}: ${r.value} (${r.rag})`).join('\n'),
        html: one21WeeklyKpiHtml({ name: p.agent_name.split(' ')[0], weekDisplay, rows, openUrl: novaBaseUrl() }),
      });
      await logEmailSent(null, p.agent_name, 'weekly_kpi', dedupKey);
      result.sent++;
    } catch (err) {
      console.warn(`[121] weekly KPI email to ${p.agent_name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}

// ── Plaud attach (Phase 4) — list matching notes, manager picks (no auto-bind) ──

export interface PlaudCandidate {
  id: string;
  filename: string;
  start_time: number;
  duration: number;
  matchedByName: boolean;
}

/** N days either side of an ISO date, as YYYY-MM-DD (UK). */
function dateOffset(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/**
 * Candidate Plaud recordings for a session. Primary filter: title contains the team
 * member's name (Nick's decision — no auto-bind). Falls back to all recordings in a
 * ±2-day window around the scheduled date so a mis-named note can still be attached.
 */
async function listCandidatesByName(deps: One21Deps, agentName: string, anchorDate: string): Promise<{
  configured: boolean; matchedByName: boolean; candidates: PlaudCandidate[];
}> {
  if (!deps.plaudService.isConfigured()) return { configured: false, matchedByName: false, candidates: [] };
  const recordings = await deps.plaudService.listRecordingsRange(dateOffset(anchorDate, -2), dateOffset(anchorDate, 2)).catch(() => []);
  const parts = agentName.toLowerCase().split(/\s+/).filter((p) => p.length >= 2);
  const named = recordings.filter((r) => parts.some((p) => r.filename.toLowerCase().includes(p)));
  const source = named.length > 0 ? named : recordings;
  return {
    configured: true,
    matchedByName: named.length > 0,
    candidates: source
      .map((r) => ({ ...r, matchedByName: parts.some((p) => r.filename.toLowerCase().includes(p)) }))
      .sort((a, b) => b.start_time - a.start_time),
  };
}

export async function getPlaudCandidates(deps: One21Deps, sessionId: number): Promise<{
  configured: boolean; matchedByName: boolean; candidates: PlaudCandidate[];
}> {
  const session = await queryOne<{ agent_name: string; scheduled_date: string }>(
    `SELECT agent_name, scheduled_date FROM agent_121_sessions WHERE id = ?`, [sessionId]);
  if (!session) return { configured: true, matchedByName: false, candidates: [] };
  return listCandidatesByName(deps, session.agent_name, session.scheduled_date);
}

const ukTodayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

/** The agent's most recent *held* 1-2-1 session — the one a recording attaches to.
 *  Excludes future-only 'scheduled' sessions so a recording binds to the meeting that
 *  actually happened, not the next one on the calendar. */
export async function getLatestSession(agentName: string): Promise<{ id: number; scheduled_date: string; status: string; completed_at: string | null; plaud_recording_id: string | null } | null> {
  return (await queryOne<{ id: number; scheduled_date: string; status: string; completed_at: string | null; plaud_recording_id: string | null }>(
    `SELECT TOP 1 id, scheduled_date, status, completed_at, plaud_recording_id FROM agent_121_sessions
     WHERE agent_name = ? AND (scheduled_date <= ? OR status IN ('in_progress','ready','complete'))
     ORDER BY scheduled_date DESC, id DESC`, [agentName, ukTodayStr()])) ?? null;
}

/** Plaud candidates for an agent (anchored to their latest 1-2-1, else today). */
export async function getPlaudCandidatesForAgent(deps: One21Deps, agentName: string): Promise<{
  configured: boolean; matchedByName: boolean; candidates: PlaudCandidate[]; sessionId: number | null; hasSession: boolean;
}> {
  const latest = await getLatestSession(agentName);
  const anchor = latest?.scheduled_date ?? ukTodayStr();
  const res = await listCandidatesByName(deps, agentName, anchor);
  return { ...res, sessionId: latest?.id ?? null, hasSession: !!latest };
}

// ── Scan-all: triage Plaud recordings and assign 1-2-1s to agents ──
// Plaud auto-names recordings by timestamp, so titles rarely identify a 1-2-1. We therefore
// return ALL recordings (minus already-assigned + dismissed) and let the manager triage:
// assign the 1-2-1s, dismiss the rest. Agent name is pre-suggested when it's in the title.

export interface ScannedRecording { id: string; filename: string; start_time: number; suggestedAgent: string | null; isOneToOne: boolean; }

// Standardised Plaud title produced by the NOVA template: "1-2-1 | <Agent Name> | <date>".
const ONE21_PREFIX_RE = /^\s*1\s*-?\s*2\s*-?\s*1\b/i;
function parseStdTitle(filename: string, agents: string[]): { isOneToOne: boolean; agent: string | null } {
  if (!ONE21_PREFIX_RE.test(filename)) return { isOneToOne: false, agent: null };
  const segs = filename.split('|').map((s) => s.trim()).filter(Boolean);
  let agent: string | null = null;
  if (segs.length >= 2) {
    const cand = segs[1].toLowerCase();
    agent = agents.find((a) => a.toLowerCase() === cand)
      ?? agents.find((a) => cand.includes(a.toLowerCase()) || a.toLowerCase().includes(cand))
      ?? null;
  }
  return { isOneToOne: true, agent };
}

const IGNORED_KEY = 'one21_plaud_ignored';
function getIgnored(deps: One21Deps): Set<string> {
  const raw = deps.settingsQueries.getAll()[IGNORED_KEY];
  try { const a = raw ? JSON.parse(raw) : []; return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); }
}

export function dismissRecording(deps: One21Deps, recordingId: string): void {
  const ignored = getIgnored(deps);
  ignored.add(recordingId);
  deps.settingsQueries.set(IGNORED_KEY, JSON.stringify([...ignored]));
}

/** Scan Plaud for recordings to assign as 1-2-1s. `sinceDays` limits the look-back
 *  (0/undefined = everything back to 2020). */
export async function scanPlaudForOneToOnes(deps: One21Deps, sinceDays?: number): Promise<{
  configured: boolean; recordings: ScannedRecording[]; agents: string[];
}> {
  if (!deps.plaudService.isConfigured()) return { configured: false, recordings: [], agents: [] };

  const from = sinceDays && sinceDays > 0
    ? new Date(Date.now() - sinceDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
    : '2020-01-01';
  const recordings = await deps.plaudService.listRecordingsRange(from, ukTodayStr()).catch(() => []);

  const attachedRows = await query<{ plaud_recording_id: string }>(
    `SELECT plaud_recording_id FROM agent_121_sessions WHERE plaud_recording_id IS NOT NULL`);
  const excluded = new Set(attachedRows.map((r) => r.plaud_recording_id));
  for (const id of getIgnored(deps)) excluded.add(id);

  const agentRows = await query<{ agent_name: string }>(
    `SELECT agent_name FROM agent_development_plans WHERE status IN ('active','deferred') ORDER BY agent_name`);
  const agents = agentRows.map((r) => r.agent_name);
  const agentParts = agents.map((a) => ({ name: a, parts: a.toLowerCase().split(/\s+/).filter((p) => p.length >= 2) }));

  const out: ScannedRecording[] = recordings
    .filter((r) => !excluded.has(r.id))
    .map((r) => {
      const std = parseStdTitle(r.filename, agents);
      const f = r.filename.toLowerCase();
      const nameMatch = agentParts.find((a) => a.parts.some((p) => f.includes(p)))?.name ?? null;
      return { id: r.id, filename: r.filename, start_time: r.start_time, isOneToOne: std.isOneToOne, suggestedAgent: std.agent ?? nameMatch };
    })
    // Confirmed 1-2-1s (standardised title) first, then newest.
    .sort((a, b) => (Number(b.isOneToOne) - Number(a.isOneToOne)) || (b.start_time - a.start_time));
  return { configured: true, recordings: out, agents };
}

/** Assign a scanned recording to an agent: create a completed session dated to the
 *  recording and attach its summary. Idempotent — a recording is never assigned twice. */
export async function assignPlaudToAgent(deps: One21Deps, agentName: string, recordingId: string, recordedAt?: number): Promise<{ ok: boolean; error?: string }> {
  if (!agentName.trim()) return { ok: false, error: 'agent required' };
  const dup = await queryOne<{ id: number }>(
    `SELECT TOP 1 id FROM agent_121_sessions WHERE plaud_recording_id = ?`, [recordingId]);
  if (dup) return { ok: false, error: 'This recording is already assigned.' };

  const recDate = recordedAt && Number.isFinite(recordedAt)
    ? new Date(recordedAt * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
    : ukTodayStr();
  const id = await executeAndGetId(
    `INSERT INTO agent_121_sessions (agent_name, scheduled_date, status) VALUES (?, ?, 'scheduled')`,
    [agentName, recDate]);
  const r = await attachPlaudNote(deps, id, recordingId, recordedAt); // backfills date + marks complete
  if (!r.ok) {
    await execute(`DELETE FROM agent_121_sessions WHERE id = ?`, [id]).catch(() => {});
    return { ok: false, error: r.error };
  }
  return { ok: true };
}

/** Attach a Plaud note to the agent's latest 1-2-1 session. `recordedAt` is the
 *  recording's start time (unix seconds) — used to backfill the held date. */
export async function attachPlaudForAgent(deps: One21Deps, agentName: string, recordingId: string, recordedAt?: number): Promise<{ ok: boolean; notes_text: string | null; error?: string }> {
  const latest = await getLatestSession(agentName);
  if (!latest) return { ok: false, notes_text: null, error: 'No 1-2-1 session for this agent yet — run a 1-2-1 first.' };
  return attachPlaudNote(deps, latest.id, recordingId, recordedAt);
}

/** Attach a chosen Plaud note: pull its summary + merge into the session. If the session
 *  hasn't been completed yet (no "last 1-2-1" date recorded), the recording's own date is
 *  used to mark the 1-2-1 as held — i.e. attaching a recording dates the 1-2-1. */
export async function attachPlaudNote(deps: One21Deps, sessionId: number, recordingId: string, recordedAt?: number): Promise<{ ok: boolean; notes_text: string | null; error?: string }> {
  const session = await queryOne<{ notes_text: string | null; completed_at: string | null }>(
    `SELECT notes_text, completed_at FROM agent_121_sessions WHERE id = ?`, [sessionId]);
  if (!session) return { ok: false, notes_text: null, error: 'Session not found' };

  try {
    const notes = await deps.plaudService.getNotes(recordingId);
    const existing = session.notes_text ?? '';
    // Don't clobber manual discussion notes — append the Plaud summary under a heading.
    const block = notes ? `## Plaud summary\n${notes}` : '## Plaud summary\n_(no summary available yet)_';
    const merged = existing.includes('## Plaud summary')
      ? existing.replace(/## Plaud summary[\s\S]*$/, block)
      : (existing ? `${existing.trim()}\n\n${block}` : block);

    await execute(
      `UPDATE agent_121_sessions SET plaud_recording_id = ?, notes_text = ? WHERE id = ?`,
      [recordingId, merged, sessionId]);

    // Backfill the held date from the recording when the 1-2-1 hasn't been completed yet.
    if (recordedAt && Number.isFinite(recordedAt) && !session.completed_at) {
      const recDate = new Date(recordedAt * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
      await execute(
        `UPDATE agent_121_sessions SET scheduled_date = ?, completed_at = ?, status = 'complete' WHERE id = ?`,
        [recDate, recDate, sessionId]);
    }
    return { ok: true, notes_text: merged };
  } catch (err) {
    return { ok: false, notes_text: session.notes_text, error: err instanceof Error ? err.message : 'Plaud error' };
  }
}

// ── Day-before prep job ──

export interface DayBeforeResult {
  date: string;
  processed: number;
  agentEmails: number;
  managerEmails: number;
  noEmail: string[];
  prepFailed: string[];
}

/**
 * For every session scheduled for `date` (default tomorrow) still in 'scheduled':
 * generate the prep snapshot, email the agent their questions (form link) and the
 * manager the summary, and move the session to 'awaiting_agent'. Idempotent — each
 * email is logged once per session and never repeated.
 */
export async function runDayBeforePrep(deps: One21Deps, date: string = ukTomorrow()): Promise<DayBeforeResult> {
  const result: DayBeforeResult = { date, processed: 0, agentEmails: 0, managerEmails: 0, noEmail: [], prepFailed: [] };

  const sessions = await query<{ id: number; agent_name: string; scheduled_date: string; submit_token: string | null }>(`
    SELECT id, agent_name, scheduled_date, submit_token
    FROM agent_121_sessions
    WHERE scheduled_date = ? AND status = 'scheduled'
  `, [date]);

  if (sessions.length === 0) return result;

  const questions = getPrepQuestions(deps.settingsQueries);
  const emailOk = deps.emailService.isConfigured();
  const dateDisplay = displayDate(date);

  for (const session of sessions) {
    result.processed++;

    // 1. Generate the prep snapshot (best-effort — emails still go out if this fails).
    let prep: any = null;
    let prepSnapshotId: number | null = null;
    try {
      const r = await generatePrepForAgent(session.agent_name, deps.settingsQueries, deps.notificationQueries);
      prep = r.prep;
      prepSnapshotId = r.snapshotId;
    } catch (err) {
      result.prepFailed.push(session.agent_name);
      console.warn(`[121] prep generation failed for ${session.agent_name}:`, err instanceof Error ? err.message : err);
    }

    // 2. Persist prep link + token and advance status.
    const token = session.submit_token || randomBytes(32).toString('hex');
    await execute(`
      UPDATE agent_121_sessions
      SET status = 'awaiting_agent', submit_token = ?, prep_snapshot_id = COALESCE(?, prep_snapshot_id)
      WHERE id = ?
    `, [token, prepSnapshotId, session.id]);

    if (!emailOk) continue;
    const submitUrl = `${novaBaseUrl()}/121/submit/${token}`;
    const dedupKey = String(session.id);

    // 3. Email the agent their prep questions.
    const to = await getAgentEmail(deps.settingsQueries, session.agent_name);
    if (!to) {
      result.noEmail.push(session.agent_name);
    } else if (!(await emailAlreadySent('prep_agent', dedupKey))) {
      try {
        await deps.emailService.send({
          to,
          subject: `Your 1-2-1 prep — ${dateDisplay}`,
          text: `Your 1-2-1 is on ${dateDisplay}. Please add your answers before we meet:\n\n${submitUrl}`,
          html: one21PrepAgentHtml({ name: session.agent_name.split(' ')[0], dateDisplay, intro: prepEmailIntro(deps.settingsQueries), questions, submitUrl }),
        });
        await logEmailSent(session.id, session.agent_name, 'prep_agent', dedupKey);
        result.agentEmails++;
      } catch (err) {
        console.warn(`[121] agent prep email to ${session.agent_name} failed:`, err instanceof Error ? err.message : err);
      }
    }

    // 4. Email the manager the prep summary.
    if (!(await emailAlreadySent('prep_manager', dedupKey))) {
      try {
        await deps.emailService.send({
          to: nickEmail(),
          subject: `1-2-1 prep — ${session.agent_name} (${dateDisplay})`,
          text: prep?.summary ?? `1-2-1 prep for ${session.agent_name} on ${dateDisplay}.`,
          html: one21PrepManagerHtml({
            agentName: session.agent_name,
            dateDisplay,
            intro: managerSummaryIntro(deps.settingsQueries),
            summary: prep?.summary ?? null,
            whatsImproved: prep?.whats_improved ?? [],
            needsAttention: prep?.needs_attention ?? [],
            talkingPoints: prep?.suggested_talking_points ?? [],
            openUrl: novaBaseUrl(),
          }),
        });
        await logEmailSent(session.id, session.agent_name, 'prep_manager', dedupKey);
        result.managerEmails++;
      } catch (err) {
        console.warn(`[121] manager prep email for ${session.agent_name} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return result;
}
