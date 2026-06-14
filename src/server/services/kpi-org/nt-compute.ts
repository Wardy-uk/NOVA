// Compute a single org KPI's value for a given day.
// Jira-backed KPIs use the validated JQL from the registry via the REST client;
// flows read NOVA's escalation_log. Manual KPIs return null (value comes from
// a manual-entry row). Mirrors the agreed definitions in org-kpis-spec.md.

import type { JiraRestClient } from '../jira-client.js';
import { query } from '../database.js';
import type { OrgKpi, DayCtx } from './registry.js';
import { NOT_ACTIONABLE_STATUSES } from './registry.js';

/** Port of kpi-pipeline.ts isSlaBreached — true if any cycle is breached / over time.
 *  Returns null when the SLA field is absent (ticket excluded from compliance %). */
function slaBreached(field: unknown): boolean | null {
  if (!field) return null;
  const cycles = Array.isArray(field) ? field : [field];
  for (const cyc of cycles as Array<Record<string, unknown>>) {
    if (!cyc || typeof cyc !== 'object') continue;
    const completed = cyc.completedCycles as Array<Record<string, unknown>> | undefined;
    for (const cc of completed ?? []) {
      const rt = cc.remainingTime as { millis?: number } | undefined;
      if (cc.breached === true || (rt?.millis != null && rt.millis < 0)) return true;
    }
    const ongoing = cyc.ongoingCycle as Record<string, unknown> | undefined;
    if (ongoing) {
      const rt = ongoing.remainingTime as { millis?: number } | undefined;
      if (ongoing.breached === true || (rt?.millis != null && rt.millis < 0)) return true;
    }
  }
  return false;
}

// CC customer-request types (cf12800 values) that count toward FCR.
const CC_RT_VALUES = ['Incident (NT)', 'Chat (NT)', 'AI Request (NT)', 'Emailed request (NT)', 'GDPR (NT)', 'Service Request (NT)', 'TPJ Request (NT)'];
const BOT_PATTERNS = ['nurtur', 'automation', 'jira service', 'servicedesk', 'bot'];
const isBot = (name: string) => BOT_PATTERNS.some(p => name.toLowerCase().includes(p));

/** First Contact Resolution % over CC tickets solved during the day. Mirrors the
 *  legacy comment scan: FCR = an agent replied and the customer did NOT comment
 *  after the agent's first reply. Sampled to the first 30 tickets, like legacy. */
async function computeFcr(jira: JiraRestClient, ctx: DayCtx): Promise<number> {
  const jql = `project = NT AND statusCategory = Done ` +
    `AND status CHANGED TO ("Resolved", "Closed", "Done") DURING ("${ctx.day}", "${ctx.nextDay}")`;
  const res = await jira.searchJqlAll(jql, ['customfield_12800'], 2000);
  const ccTickets = res.issues.filter(iss => {
    const rt = ((iss.fields as Record<string, unknown> | undefined)?.customfield_12800 as { value?: string } | undefined)?.value ?? '';
    return CC_RT_VALUES.includes(rt);
  }).slice(0, 30);
  let fcrCount = 0, fcrTotal = 0;
  for (const iss of ccTickets) {
    try {
      const comments = await jira.getComments(iss.key, 50);
      const agent = comments.filter(c => {
        const a = c.author as { displayName?: string; accountType?: string } | undefined;
        return a?.accountType !== 'customer' && !isBot(a?.displayName ?? '');
      });
      const customer = comments.filter(c => (c.author as { accountType?: string } | undefined)?.accountType === 'customer');
      fcrTotal++;
      if (agent.length > 0) {
        const firstAgentTime = new Date(agent[agent.length - 1].created);
        const customerAfter = customer.some(c => new Date(c.created) > firstAgentTime);
        if (!customerAfter) fcrCount++;
      }
      await new Promise(r => setTimeout(r, 150));
    } catch { /* skip ticket on comment fetch error */ }
  }
  return fcrTotal > 0 ? Math.round((fcrCount / fcrTotal) * 100) : 0;
}

interface ResolvedAgg { frtTotal: number; frtBreached: number; resTotal: number; resBreached: number; csatSum: number; csatCount: number; }

/** Aggregate FRT/Resolution breaches + CSAT ratings over tickets solved during the
 *  day (status transitioned to a Done status that day). Mirrors the legacy
 *  resolved-today snapshot: cf14046 (FRT), cf14048 (Resolution), cf12802.rating (CSAT). */
async function resolvedAgg(jira: JiraRestClient, ctx: DayCtx): Promise<ResolvedAgg> {
  const jql = `project = NT AND statusCategory = Done ` +
    `AND status CHANGED TO ("Resolved", "Closed", "Done") DURING ("${ctx.day}", "${ctx.nextDay}")`;
  const res = await jira.searchJqlAll(jql, ['customfield_14046', 'customfield_14048', 'customfield_12802'], 2000);
  const agg: ResolvedAgg = { frtTotal: 0, frtBreached: 0, resTotal: 0, resBreached: 0, csatSum: 0, csatCount: 0 };
  for (const iss of res.issues) {
    const f = (iss.fields ?? {}) as Record<string, unknown>;
    const frt = slaBreached(f.customfield_14046);
    if (frt !== null) { agg.frtTotal++; if (frt) agg.frtBreached++; }
    const r = slaBreached(f.customfield_14048);
    if (r !== null) { agg.resTotal++; if (r) agg.resBreached++; }
    const rating = (f.customfield_12802 as { rating?: number } | undefined)?.rating;
    if (typeof rating === 'number' && rating >= 1 && rating <= 5) { agg.csatSum += rating; agg.csatCount++; }
  }
  return agg;
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1000;

/** Port of kpi-pipeline.ts isNoReply, working off raw Jira issue fields. */
function isNoReply(
  statusName: string | null,
  created: Date | null,
  agentLastUpdated: Date | null,
  agentNextUpdate: Date | null,
  now: Date,
): boolean {
  if ((statusName || '').toLowerCase() === 'waiting on requestor') return false;
  if (!created || now.getTime() - created.getTime() < FOUR_HOURS_MS) return false;
  if (agentNextUpdate && agentNextUpdate > now) return false;
  if (!agentLastUpdated) return false;
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  if (agentLastUpdated >= startOfToday) return false;
  if (agentLastUpdated < new Date(now.getTime() - FIFTY_TWO_WEEKS_MS)) return false;
  return true;
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const NOT_ACTIONABLE_LIST = NOT_ACTIONABLE_STATUSES.map(s => `"${s}"`).join(', ');

/** Jira fields the isNoReply predicate needs — request these when fetching for a no-reply check. */
export const NO_REPLY_FIELDS = ['status', 'created', 'customfield_14081', 'customfield_14185'];

/** Apply the isNoReply predicate to a single raw Jira issue (fields must include NO_REPLY_FIELDS). */
export function isNoReplyIssue(issue: { fields?: Record<string, unknown> }, now: Date): boolean {
  const f = (issue.fields ?? {}) as Record<string, unknown>;
  const status = (f.status as { name?: string } | undefined)?.name ?? null;
  return isNoReply(status, parseDate(f.created), parseDate(f.customfield_14081), parseDate(f.customfield_14185), now);
}

/** Count open tickets matching `jql` that satisfy the isNoReply predicate. */
export async function countNoReply(jira: JiraRestClient, jql: string, now: Date): Promise<number> {
  const res = await jira.searchJqlAll(jql, NO_REPLY_FIELDS, 2000);
  let count = 0;
  for (const issue of res.issues) {
    if (isNoReplyIssue(issue, now)) count++;
  }
  return count;
}

export interface ComputeResult {
  value: number | null;
  /** True when the compute path failed (vs a legitimate zero/null). */
  failed: boolean;
}

/**
 * Compute one KPI for `ctx.day`. `now` is the freeze instant (≈18:00 UK on the day).
 * Returns { value, failed }. Manual KPIs return { value: null, failed: false }.
 */
export async function computeNtKpi(
  kpi: OrgKpi,
  jira: JiraRestClient,
  ctx: DayCtx,
  now: Date,
): Promise<ComputeResult> {
  const c = kpi.compute;

  switch (c.kind) {
    case 'manual':
      return { value: null, failed: false };

    case 'jql_count': {
      const n = await jira.jqlCount(c.jql(ctx));
      return n < 0 ? { value: null, failed: true } : { value: n, failed: false };
    }

    case 'escalation_log': {
      const rows = await query<{ n: number }>(
        `SELECT COUNT(DISTINCT ticket_key) AS n FROM escalation_log
         WHERE ticket_key LIKE 'NT-%'
           AND escalation_type ${c.rejection ? '=' : '<>'} 'rejection'
           AND created_at >= ? AND created_at < ?`,
        [`${ctx.day}T00:00:00.000Z`, `${ctx.nextDay}T00:00:00.000Z`],
      );
      return { value: rows[0]?.n ?? 0, failed: false };
    }

    case 'escalation_tier': {
      const params: unknown[] = [`${ctx.day}T00:00:00.000Z`, `${ctx.nextDay}T00:00:00.000Z`];
      let where = 'created_at >= ? AND created_at < ?';
      if (c.fromTiers && c.fromTiers.length) {
        where += ` AND from_tier IN (${c.fromTiers.map(() => '?').join(', ')})`;
        params.push(...c.fromTiers);
      }
      where += ` AND to_tier IN (${c.toTiers.map(() => '?').join(', ')})`;
      params.push(...c.toTiers);
      const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM escalation_log WHERE ${where}`, params);
      return { value: rows[0]?.n ?? 0, failed: false };
    }

    case 'no_reply':
      return { value: await countNoReply(jira, c.bucketJql, now), failed: false };

    case 'oldest_actionable': {
      const jql = `${c.bucketJql} AND status not in (${NOT_ACTIONABLE_LIST}) ORDER BY created ASC`;
      const res = await jira.searchJql(jql, ['created'], 1);
      const oldest = res.issues[0];
      if (!oldest) return { value: 0, failed: false };
      const created = parseDate((oldest.fields as Record<string, unknown>).created);
      if (!created) return { value: 0, failed: false };
      const days = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
      return { value: Math.max(0, days), failed: false };
    }

    case 'resolved_outcome': {
      const agg = await resolvedAgg(jira, ctx);
      if (c.metric === 'csat') {
        return { value: agg.csatCount > 0 ? Math.round((agg.csatSum / agg.csatCount) * 20) : 0, failed: false };
      }
      if (c.metric === 'frt') {
        return { value: agg.frtTotal > 0 ? Math.round(((agg.frtTotal - agg.frtBreached) / agg.frtTotal) * 100) : 100, failed: false };
      }
      // res
      return { value: agg.resTotal > 0 ? Math.round(((agg.resTotal - agg.resBreached) / agg.resTotal) * 100) : 100, failed: false };
    }

    case 'fcr':
      return { value: await computeFcr(jira, ctx), failed: false };
  }
}
