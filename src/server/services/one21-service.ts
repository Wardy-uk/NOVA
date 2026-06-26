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
import { one21PrepAgentHtml, one21PrepManagerHtml } from './email-templates.js';
import { nickEmail, novaBaseUrl } from '../config/standup-config.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { EmailService } from './email.js';

export interface One21Deps {
  settingsQueries: FileSettingsQueries;
  notificationQueries: NotificationQueries;
  emailService: EmailService;
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
             QAOverallAvg, GoldenRulesAvg, SLABreachedCount, FrtCompliancePercent, ResolutionSlaPercent
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
        frtCompliancePct: avg('FrtCompliancePercent'),
        resolutionSlaPct: avg('ResolutionSlaPercent'),
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
