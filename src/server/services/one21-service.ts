/**
 * 1-2-1 closed loop — shared business logic for the scheduled day-before prep job
 * (index.ts) and the agent-facing submission form (routes/one21-public.ts).
 *
 * Mirrors the standup loop (services/standup-service.ts): generate prep, email both
 * parties, agent answers come back into NOVA. See agent_work/ba/one-to-one-loop-spec.md.
 */
import { randomBytes } from 'node:crypto';
import { query, queryOne, execute } from './database.js';
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
