import sql from 'mssql';
import { getKpiPool } from './kpi-pipeline.js';
import { query, queryOne, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';

/**
 * Daily failed-jobs ticket.
 *
 * Every weekday morning one T2 Support agent owns the failed automated jobs —
 * monitoring them, reprocessing what can be reprocessed, and fixing what can't.
 * The n8n workflow "Daily Agent Selection" (rJBiif9W35ypktKA) picks that agent at
 * 08:00 by flagging dbo.Agent.isCurrentFailedJob = 'Y', which is what the Grafana
 * board displays. This job raises the Jira ticket for that work and assigns it
 * straight to whoever holds the flag, so the duty has a tracked, SLA'd home
 * instead of living only on a wallboard. On by default; `failed_jobs_ticket_enabled`
 * = 'false' turns it off.
 *
 * n8n's selection reads dbo.Agent.isAvailable, a flag only ever set by hand in the
 * Agent Roster admin — it knows nothing about People HR leave. So before raising the
 * ticket we re-check the flagged agent against NOVA's own agent_availability for
 * today; if they're off, we pick the next eligible agent using n8n's exact ordering
 * and move the flag, keeping the ticket and the Grafana board in agreement.
 */

const DEFAULTS = {
  project: 'NT',
  issueTypeId: '10706',            // NT "Support"
  requestTypeField: 'customfield_12800', // JSM sd-customerrequesttype (see close-ticket-helper)
  requestTypeId: '598',            // Service Request (NT)
  tierField: 'customfield_12981',  // Current Tier
  tierId: '13062',                 // Tier 2
  hour: 8,
  minute: 30,
} as const;

/** Statuses that still count as "at work" — matches assignment-engine. */
const WORKING_STATUSES = new Set(['available', 'wfh']);

export interface FailedJobsAgent {
  agentId: number;
  accountId: string | null;
  displayName: string;
}

export interface FailedJobsRunResult {
  ok: boolean;
  date: string;
  issueKey?: string;
  agent?: string;
  agentId?: number;
  /** True when the n8n-flagged agent was unavailable and we moved the flag. */
  reassigned?: boolean;
  skipped?: string;
  error?: string;
}

export function ukToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function s(settings: SettingsQueries, key: string, fallback: string): string {
  const v = settings.get(key);
  return v && v.trim() ? v.trim() : fallback;
}

/** dbo.Agent.AccountId is stored URL-encoded (same as assignment-engine reads it). */
function decodeAccountId(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  try { return decodeURIComponent(raw.trim()); } catch { return raw.trim(); }
}

function fullName(row: { AgentName?: string | null; AgentSurname?: string | null; AgentId: number }): string {
  const name = [row.AgentName?.trim(), row.AgentSurname?.trim()].filter(Boolean).join(' ');
  return name || `Agent ${row.AgentId}`;
}

/** Agent IDs that NOVA knows are off today (annual leave, sick, training…). */
async function unavailableAgentIds(date: string): Promise<Set<number>> {
  const rows = await query<{ roster_id: number; status: string }>(
    `SELECT roster_id, status FROM agent_availability WHERE available_date = ?`,
    [date],
  );
  return new Set(rows.filter(r => !WORKING_STATUSES.has(r.status)).map(r => r.roster_id));
}

interface AgentRow {
  AgentId: number;
  AccountId: string | null;
  AgentName: string | null;
  AgentSurname: string | null;
}

/**
 * Who owns failed jobs today. Prefers the agent n8n flagged; falls back to the
 * next eligible available agent (and moves the flag) when that agent is off.
 */
export async function resolveFailedJobsAgent(
  settings: SettingsQueries,
  date: string,
  opts: { applyFlag?: boolean } = {},
): Promise<{ agent: FailedJobsAgent | null; reassigned: boolean }> {
  const applyFlag = opts.applyFlag !== false;
  const pool = await getKpiPool(settings);
  const respectAvailability = settings.get('failed_jobs_respect_availability') !== 'false';

  const flagged = (await pool.request().query<AgentRow>(`
    SELECT TOP 1 AgentId, AccountId, AgentName, AgentSurname
    FROM dbo.Agent WHERE isCurrentFailedJob = 'Y'
  `)).recordset[0];

  const off = respectAvailability ? await unavailableAgentIds(date) : new Set<number>();

  if (flagged && !off.has(flagged.AgentId)) {
    return {
      agent: { agentId: flagged.AgentId, accountId: decodeAccountId(flagged.AccountId), displayName: fullName(flagged) },
      reassigned: false,
    };
  }

  // Either nobody is flagged, or the flagged agent is off. Re-pick using the same
  // ordering as the n8n workflow: never-picked first, then longest since last turn.
  const candidates = (await pool.request().query<AgentRow>(`
    SELECT AgentId, AccountId, AgentName, AgentSurname
    FROM dbo.Agent
    WHERE isAvailable = 1 AND IsActive = 1 AND Team = 'Support' AND TierCode = 'T2'
    ORDER BY CASE WHEN lastFailedJobDate IS NULL THEN 0 ELSE 1 END ASC,
             lastFailedJobDate ASC, AgentName ASC
  `)).recordset;

  const next = candidates.find(a => !off.has(a.AgentId));
  if (!next) {
    console.warn(`[failed-jobs] No available T2 Support agent for ${date}` +
      (flagged ? ` (flagged agent ${fullName(flagged)} is unavailable)` : ' (nobody flagged)'));
    return { agent: null, reassigned: false };
  }

  // Move the flag so the Grafana board shows the same person as the ticket.
  // Skipped for the read-only status peek, which must not change the board.
  if (applyFlag) {
    const req = pool.request();
    req.input('agentId', sql.Int, next.AgentId);
    await req.query(`
      UPDATE dbo.Agent SET isCurrentFailedJob = 'N' WHERE isCurrentFailedJob = 'Y';
      UPDATE dbo.Agent SET isCurrentFailedJob = 'Y', lastFailedJobDate = CAST(GETDATE() AS DATE)
       WHERE AgentId = @agentId;
    `);
  }

  if (flagged && applyFlag) {
    console.log(`[failed-jobs] ${fullName(flagged)} is unavailable — failed jobs moved to ${fullName(next)}`);
  }

  return {
    agent: { agentId: next.AgentId, accountId: decodeAccountId(next.AccountId), displayName: fullName(next) },
    reassigned: !!flagged,
  };
}

function buildDescription(agentName: string, date: string) {
  const bullet = (text: string) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `${agentName} owns failed automated jobs for ${date}. Work the Grafana failed jobs board through the day:`,
        }],
      },
      {
        type: 'bulletList',
        content: [
          bullet('Monitor the board for new failures as they appear.'),
          bullet('Reprocess anything that can safely be re-run.'),
          bullet('Investigate and fix the ones that fail again — raise a linked ticket for anything needing dev.'),
          bullet('Leave a comment here with the closing count and anything handed over.'),
        ],
      },
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Raised automatically by NOVA. Owner comes from the daily failed-jobs rota.',
        }],
      },
    ],
  };
}

/**
 * Create the ticket, dropping optional fields one at a time if Jira rejects them.
 * A create screen that refuses the request type or tier field should still leave us
 * with a ticket rather than nothing.
 */
async function createTicket(
  jira: JiraRestClient,
  base: Record<string, unknown>,
  optional: Array<{ label: string; fields: Record<string, unknown> }>,
): Promise<{ key: string; dropped: string[] }> {
  let remaining = [...optional];
  const dropped: string[] = [];
  for (;;) {
    const fields = remaining.reduce((acc, o) => ({ ...acc, ...o.fields }), { ...base });
    try {
      const created = await jira.createIssue({ fields });
      return { key: created.key, dropped };
    } catch (err) {
      if (remaining.length === 0) throw err;
      const drop = remaining[remaining.length - 1];
      remaining = remaining.slice(0, -1);
      dropped.push(drop.label);
      console.warn(`[failed-jobs] create rejected — retrying without ${drop.label}:`,
        err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Raise today's failed-jobs ticket. Idempotent per UK day via the unique index on
 * failed_jobs_ticket_log.ticket_date — a restart or a second tick can't double-raise.
 */
export async function runFailedJobsTicket(
  settings: SettingsQueries,
  jira: JiraRestClient | null,
  opts: { date?: string; force?: boolean } = {},
): Promise<FailedJobsRunResult> {
  const date = opts.date ?? ukToday();

  if (!jira) return { ok: false, date, skipped: 'no-jira-client' };

  if (!opts.force) {
    const existing = await queryOne<{ issue_key: string | null }>(
      `SELECT issue_key FROM failed_jobs_ticket_log WHERE ticket_date = ?`, [date],
    );
    if (existing?.issue_key) return { ok: true, date, issueKey: existing.issue_key, skipped: 'already-raised' };
  }

  const { agent, reassigned } = await resolveFailedJobsAgent(settings, date);
  if (!agent) return { ok: false, date, skipped: 'no-available-agent' };

  const project = s(settings, 'failed_jobs_ticket_project', DEFAULTS.project);
  const summaryTemplate = s(settings, 'failed_jobs_ticket_summary',
    'Failed Jobs — monitor, reprocess and fix ({date})');
  const summary = summaryTemplate.replace('{date}', date).replace('{agent}', agent.displayName);

  const base: Record<string, unknown> = {
    project: { key: project.split(',')[0].trim() },
    issuetype: { id: s(settings, 'failed_jobs_ticket_issue_type_id', DEFAULTS.issueTypeId) },
    summary,
    description: buildDescription(agent.displayName, date),
  };

  // Ordered least- to most-droppable: the ladder drops from the end first, so the
  // assignee — the whole point of the ticket — is the last thing to go.
  const optional: Array<{ label: string; fields: Record<string, unknown> }> = [];
  if (agent.accountId) {
    optional.push({ label: 'assignee', fields: { assignee: { accountId: agent.accountId } } });
  }
  optional.push({ label: 'due date', fields: { duedate: date } });
  optional.push({ label: 'labels', fields: { labels: ['failed-jobs', 'nova-automated'] } });
  const tierId = s(settings, 'failed_jobs_ticket_tier_id', DEFAULTS.tierId);
  if (tierId !== 'none') {
    optional.push({
      label: 'tier',
      fields: { [s(settings, 'failed_jobs_ticket_tier_field', DEFAULTS.tierField)]: { id: tierId } },
    });
  }
  const requestTypeId = s(settings, 'failed_jobs_ticket_request_type_id', DEFAULTS.requestTypeId);
  if (requestTypeId !== 'none') {
    optional.push({
      label: 'request type',
      fields: {
        [s(settings, 'failed_jobs_request_type_field', DEFAULTS.requestTypeField)]: { id: requestTypeId },
      },
    });
  }
  // Reversed: createTicket drops from the tail, so put the most droppable last.
  optional.reverse();

  let issueKey: string;
  let dropped: string[];
  try {
    ({ key: issueKey, dropped } = await createTicket(jira, base, optional));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[failed-jobs] Failed to raise ticket for ${date}:`, message);
    await logRun(date, null, agent, reassigned, `create failed: ${message}`.slice(0, 400));
    return { ok: false, date, agent: agent.displayName, error: message };
  }

  // If the assignee was one of the fields Jira refused on create, try it on its own —
  // an unassigned failed-jobs ticket is the one outcome worth a second attempt.
  if (dropped.includes('assignee') && agent.accountId) {
    try {
      await jira.updateFields(issueKey, { assignee: { accountId: agent.accountId } });
      dropped = dropped.filter(d => d !== 'assignee');
    } catch (err) {
      console.warn(`[failed-jobs] ${issueKey} created but could not be assigned:`,
        err instanceof Error ? err.message : err);
    }
  }

  const note = dropped.length ? `created without: ${dropped.join(', ')}` : null;
  await logRun(date, issueKey, agent, reassigned, note);
  console.log(`[failed-jobs] ${issueKey} raised for ${date} → ${agent.displayName}` +
    (reassigned ? ' (reassigned — flagged agent unavailable)' : '') + (note ? ` [${note}]` : ''));

  return { ok: true, date, issueKey, agent: agent.displayName, agentId: agent.agentId, reassigned };
}

async function logRun(
  date: string,
  issueKey: string | null,
  agent: FailedJobsAgent,
  reassigned: boolean,
  note: string | null,
): Promise<void> {
  try {
    await execute(`
      MERGE failed_jobs_ticket_log AS target
      USING (SELECT ? AS ticket_date) AS source ON target.ticket_date = source.ticket_date
      WHEN MATCHED THEN UPDATE SET issue_key = ?, agent_id = ?, agent_name = ?, reassigned = ?, note = ?
      WHEN NOT MATCHED THEN INSERT (ticket_date, issue_key, agent_id, agent_name, reassigned, note)
        VALUES (?, ?, ?, ?, ?, ?);
    `, [
      date,
      issueKey, agent.agentId, agent.displayName, reassigned ? 1 : 0, note,
      date, issueKey, agent.agentId, agent.displayName, reassigned ? 1 : 0, note,
    ]);
  } catch (err) {
    console.warn('[failed-jobs] Could not write run log:', err instanceof Error ? err.message : err);
  }
}

/** True when today is a UK working day the ticket should be raised on. */
export function isTicketDay(settings: SettingsQueries, now = new Date()): boolean {
  const weekday = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  try {
    const holidays = JSON.parse(settings.get('agent_bank_holidays') || '[]') as string[];
    if (Array.isArray(holidays) && holidays.includes(ukToday())) return false;
  } catch { /* malformed setting — treat as no holidays */ }
  return true;
}

/** Minutes past midnight (UK) the job is due to fire. */
export function dueMinuteOfDay(settings: SettingsQueries): number {
  const hour = parseInt(settings.get('failed_jobs_ticket_hour') || '', 10);
  const minute = parseInt(settings.get('failed_jobs_ticket_minute') || '', 10);
  return (Number.isFinite(hour) ? hour : DEFAULTS.hour) * 60 +
         (Number.isFinite(minute) ? minute : DEFAULTS.minute);
}
