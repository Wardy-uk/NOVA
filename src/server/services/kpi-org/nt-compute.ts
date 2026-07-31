// Compute a single org KPI's value for a given day.
// Jira-backed KPIs use the validated JQL from the registry via the REST client;
// flows read NOVA's escalation_log. Manual KPIs return null (value comes from
// a manual-entry row). Mirrors the agreed definitions in org-kpis-spec.md.

import type { JiraRestClient } from '../jira-client.js';
import { query } from '../database.js';
import type { OrgKpi, DayCtx } from './registry.js';
import {
  NOT_ACTIONABLE_STATUSES, NT_OPEN, NT_OPEN_ASOF, NOVA_SOLVED_ON_DAY,
  RES_BREACHED, FRT_BREACHED, ACTIONABLE_JQL, NOT_ACTIONABLE_JQL,
} from './registry.js';

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

/** "Resolved today" population = resolution set that day (resolutiondate), matching the
 *  trusted n8n "Resolved Today" KPIs. Replaces the old
 *  `status CHANGED TO (Resolved/Closed/Done) DURING` method, which counted each ticket
 *  again on every resolve→close hop + bulk transitions (inflated 3–10×). Mirrors the
 *  registry SOLVED_ON_DAY change so every "solved/resolved today" number is consistent. */
const RESOLVED_DURING_DAY = (ctx: DayCtx) =>
  `project = NT AND resolutiondate >= "${ctx.day}" AND resolutiondate < "${ctx.nextDay}"`;

// CC customer-request types (cf12800 values) that count toward FCR.
const CC_RT_VALUES = ['Incident (NT)', 'Chat (NT)', 'AI Request (NT)', 'Emailed request (NT)', 'GDPR (NT)', 'Service Request (NT)', 'TPJ Request (NT)'];
const BOT_PATTERNS = ['nurtur', 'automation', 'jira service', 'servicedesk', 'bot'];
const isBot = (name: string) => BOT_PATTERNS.some(p => name.toLowerCase().includes(p));

/** First Contact Resolution % over CC tickets solved during the day. Mirrors the
 *  legacy comment scan: FCR = an agent replied and the customer did NOT comment
 *  after the agent's first reply. Sampled to the first 30 tickets, like legacy. */
async function computeFcr(jira: JiraRestClient, ctx: DayCtx): Promise<number> {
  const jql = RESOLVED_DURING_DAY(ctx);
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

/** Avg hours from creation to first agent comment, over Tier-3/Dev tickets solved
 *  during the day. Mirrors the legacy "Bug Escalation-to-Ack" (sampled to 30). */
async function computeBugAck(jira: JiraRestClient, ctx: DayCtx): Promise<number> {
  const jql = `${RESOLVED_DURING_DAY(ctx)} AND cf[12981] in ("Tier 3", "Development")`;
  const res = await jira.searchJqlAll(jql, ['created'], 2000);
  const sample = res.issues.slice(0, 30);
  const hours: number[] = [];
  for (const iss of sample) {
    try {
      const comments = await jira.getComments(iss.key, 50);
      const agent = comments.filter(c => {
        const a = c.author as { displayName?: string; accountType?: string } | undefined;
        return a?.accountType !== 'customer' && !isBot(a?.displayName ?? '');
      });
      const created = (iss.fields as Record<string, unknown> | undefined)?.created;
      if (agent.length > 0 && typeof created === 'string') {
        const h = (new Date(agent[agent.length - 1].created).getTime() - new Date(created).getTime()) / 3_600_000;
        if (h >= 0) hours.push(h);
      }
      await new Promise(r => setTimeout(r, 150));
    } catch { /* skip ticket on comment fetch error */ }
  }
  return hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : 0;
}

/** Monday (UK week start) of the given YYYY-MM-DD, as YYYY-MM-DD. */
function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Extract a string from a Jira select/text field that may be a string, {value} or {name}. */
function fieldStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const o = v as { value?: string; name?: string };
  return o.value ?? o.name ?? '';
}

// Cache the solved-during-day issue set (with SLA + tier fields) so the ~30 per-tier
// SLA KPIs share ONE Jira fetch per capture/live pass instead of refetching each.
interface ResolvedIssue { fields?: Record<string, unknown> }
let resolvedSlaCache: { day: string; ts: number; issues: ResolvedIssue[] } | null = null;
async function getResolvedSlaIssues(jira: JiraRestClient, ctx: DayCtx): Promise<ResolvedIssue[]> {
  if (resolvedSlaCache && resolvedSlaCache.day === ctx.day && Date.now() - resolvedSlaCache.ts < 120_000) {
    return resolvedSlaCache.issues;
  }
  const jql = RESOLVED_DURING_DAY(ctx);
  const res = await jira.searchJqlAll(jql, ['customfield_14046', 'customfield_14048', 'customfield_12981'], 2000);
  resolvedSlaCache = { day: ctx.day, ts: Date.now(), issues: res.issues };
  return res.issues;
}

interface ResolvedAgg { frtTotal: number; frtBreached: number; resTotal: number; resBreached: number; csatSum: number; csatCount: number; }

/** Aggregate FRT/Resolution breaches + CSAT ratings over tickets solved during the
 *  day (status transitioned to a Done status that day). Mirrors the legacy
 *  resolved-today snapshot: cf14046 (FRT), cf14048 (Resolution), cf12802.rating (CSAT). */
async function resolvedAgg(jira: JiraRestClient, ctx: DayCtx): Promise<ResolvedAgg> {
  const jql = RESOLVED_DURING_DAY(ctx);
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
/** Grace period before a ticket with no agent update counts as no-reply. */
export const NO_REPLY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
  if (agentLastUpdated >= new Date(now.getTime() - NO_REPLY_AFTER_MS)) return false;
  if (agentLastUpdated < new Date(now.getTime() - FIFTY_TWO_WEEKS_MS)) return false;
  return true;
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const NOT_ACTIONABLE_LIST = NOT_ACTIONABLE_STATUSES.map(s => `"${s}"`).join(', ');

// ── Historical over-SLA reconstruction ──
// An over-SLA stock KPI's live JQL is `<bucket> AND cf[1404x] = breached() AND <actionability>`.
// breached() is current-state, so it can't be re-queried for a past day. Instead we rebuild the
// open+actionable+bucket population AS OF the day (via WAS/ON) and count tickets whose SLA had
// actually breached by end of that day — the SLA field carries a per-cycle breachTime + breached
// flag (present on completed AND ongoing cycles), so "breached as of D" is exact.
interface SlaCycle { breached?: boolean; breachTime?: { epochMillis?: number } }
interface SlaField { completedCycles?: SlaCycle[]; ongoingCycle?: SlaCycle }

function slaBreachedAsOf(field: unknown, endMs: number): boolean {
  const f = field as SlaField | undefined;
  if (!f) return false;
  const cycles = [...(f.completedCycles ?? []), ...(f.ongoingCycle ? [f.ongoingCycle] : [])];
  for (const c of cycles) {
    const bt = c.breachTime?.epochMillis;
    if (c.breached === true && typeof bt === 'number' && bt <= endMs) return true;
  }
  return false;
}

// Small LRU of fetched populations (keyed by the as-of population JQL, unique per day/bucket/
// actionability) so paired resolution+FRT KPIs sharing a population fetch Jira once.
const breachPopCache = new Map<string, Array<{ fields?: Record<string, unknown> }>>();
function cacheGetPut(key: string, make: () => Promise<Array<{ fields?: Record<string, unknown> }>>) {
  const hit = breachPopCache.get(key);
  if (hit) return Promise.resolve(hit);
  return make().then(v => {
    breachPopCache.set(key, v);
    if (breachPopCache.size > 8) breachPopCache.delete(breachPopCache.keys().next().value as string);
    return v;
  });
}

async function computeBreachedAsOf(jira: JiraRestClient, liveJql: string, ctx: DayCtx): Promise<ComputeResult> {
  const slaField = liveJql.includes(FRT_BREACHED) ? 'customfield_14046' : 'customfield_14048';
  const actAsOf = `status WAS NOT IN (${NOT_ACTIONABLE_LIST}) ON "${ctx.day}"`;
  const notActAsOf = `status WAS IN (${NOT_ACTIONABLE_LIST}) ON "${ctx.day}"`;
  // Population = live JQL minus the breach filter, with open + actionability rebuilt as-of the day.
  const popJql = liveJql
    .split(NT_OPEN).join(NT_OPEN_ASOF(ctx.day, ctx.nextDay))
    .split(` AND ${RES_BREACHED}`).join('')
    .split(` AND ${FRT_BREACHED}`).join('')
    .split(` AND ${ACTIONABLE_JQL}`).join(` AND ${actAsOf}`)
    .split(` AND ${NOT_ACTIONABLE_JQL}`).join(` AND ${notActAsOf}`);
  const issues = await cacheGetPut(popJql, async () =>
    (await jira.searchJqlAll(popJql, ['customfield_14048', 'customfield_14046'], 3000)).issues);
  const endMs = new Date(`${ctx.nextDay}T00:00:00Z`).getTime();
  let n = 0;
  for (const iss of issues) if (slaBreachedAsOf((iss.fields ?? {})[slaField], endMs)) n++;
  return { value: n, failed: false };
}

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
      let jql = c.jql(ctx);
      if (ctx.asOf) {
        // Historical reconstruction. SLA-breach counts (breached()) rebuild via per-ticket
        // cycle breachTime; pure open-stock counts rebuild via NT_OPEN_ASOF.
        if (jql.includes('breached()')) return computeBreachedAsOf(jira, jql, ctx);
        jql = jql.split(NT_OPEN).join(NT_OPEN_ASOF(ctx.day, ctx.nextDay));
      }
      const n = await jira.jqlCount(jql);
      return n < 0 ? { value: null, failed: true } : { value: n, failed: false };
    }

    case 'net_solved': {
      // Net throughput = open(prevDayEOD) − open(dayEOD) + created(day), floored at 0.
      // Tickets that actually left the board (direct resolve counts double via reopen
      // churn; resolutiondate undercounts). asOf → dayEOD open uses NT_OPEN_ASOF; live
      // (today) uses NT_OPEN (partial-day "solved so far"). prev-day EOD is always as-of.
      const prev = new Date(`${ctx.day}T00:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 1);
      const prevDay = prev.toISOString().slice(0, 10);
      const openTodayJql = ctx.asOf ? NT_OPEN_ASOF(ctx.day, ctx.nextDay) : NT_OPEN;
      const openPrevJql = NT_OPEN_ASOF(prevDay, ctx.day);
      const createdJql = `project = NT AND created >= "${ctx.day}" AND created < "${ctx.nextDay}"`;
      const [openToday, openPrev, created] = await Promise.all([
        jira.jqlCount(openTodayJql), jira.jqlCount(openPrevJql), jira.jqlCount(createdJql),
      ]);
      if (openToday < 0 || openPrev < 0 || created < 0) return { value: null, failed: true };
      let net = openPrev - openToday + created;
      if (c.minusNova) {
        const nova = await jira.jqlCount(NOVA_SOLVED_ON_DAY(ctx.day, ctx.nextDay));
        if (nova > 0) net -= nova;
      }
      return { value: Math.max(0, net), failed: false };
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
      // No-reply is a live operational state; its fields (cf14081/cf14185) aren't
      // versioned in Jira's changelog, so it can't be reconstructed for a past day.
      if (ctx.asOf) return { value: null, failed: false };
      return { value: await countNoReply(jira, c.bucketJql, now), failed: false };

    case 'oldest_actionable': {
      const bucket = ctx.asOf ? c.bucketJql.split(NT_OPEN).join(NT_OPEN_ASOF(ctx.day, ctx.nextDay)) : c.bucketJql;
      const jql = `${bucket} AND status not in (${NOT_ACTIONABLE_LIST}) ORDER BY created ASC`;
      const res = await jira.searchJql(jql, ['created'], 1);
      const oldest = res.issues[0];
      if (!oldest) return { value: 0, failed: false };
      const created = parseDate((oldest.fields as Record<string, unknown>).created);
      if (!created) return { value: 0, failed: false };
      // As-of: age measured to end of `day`, not now.
      const ref = ctx.asOf ? new Date(`${ctx.nextDay}T00:00:00Z`) : now;
      const days = Math.floor((ref.getTime() - created.getTime()) / 86_400_000);
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

    case 'ai_metric': {
      // AI agent throughput from the local approval_queue (NOVA app DB).
      if (c.metric === 'pending') {
        const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'pending'`);
        return { value: rows[0]?.n ?? 0, failed: false };
      }
      const resolved = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'approved' AND CAST(decided_at AS DATE) = ?`, [ctx.day]);
      const rv = resolved[0]?.n ?? 0;
      if (c.metric === 'resolved') return { value: rv, failed: false };
      // rate = approved today / created today
      const total = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM approval_queue WHERE CAST(created_at AS DATE) = ?`, [ctx.day]);
      const tv = total[0]?.n ?? 0;
      return { value: tv > 0 ? Math.round((rv / tv) * 100) : 0, failed: false };
    }

    case 'first_line_rate': {
      const solved = RESOLVED_DURING_DAY(ctx);
      const total = await jira.jqlCount(solved);
      if (total < 0) return { value: null, failed: true };
      if (total === 0) return { value: 0, failed: false };
      const cc = await jira.jqlCount(`${solved} AND cf[12981] = "Customer Care"`);
      if (cc < 0) return { value: null, failed: true };
      return { value: Math.round((cc / total) * 100), failed: false };
    }

    case 'bug_ack':
      return { value: await computeBugAck(jira, ctx), failed: false };

    case 'wtd_rag': {
      // % of this-week captured Support rows (target-bearing) that are green / red.
      const rows = await query<{ rag: string | null }>(
        `SELECT rag FROM kpi_org_daily WHERE team_key = 'Support' AND target IS NOT NULL AND kpi_date >= ? AND kpi_date <= ?`,
        [weekStartOf(ctx.day), ctx.day]);
      const scored = rows.filter(r => r.rag === 'green' || r.rag === 'amber' || r.rag === 'red');
      if (scored.length === 0) return { value: 0, failed: false };
      const hit = scored.filter(r => r.rag === c.rag).length;
      return { value: Math.round((hit / scored.length) * 100), failed: false };
    }

    case 'resolved_sla': {
      const issues = await getResolvedSlaIssues(jira, ctx);
      const field = c.metric === 'frt' ? 'customfield_14046' : 'customfield_14048';
      let met = 0, breached = 0;
      for (const iss of issues) {
        const f = iss.fields ?? {};
        if (c.tier && fieldStr(f.customfield_12981) !== c.tier) continue;
        const b = slaBreached(f[field]);
        if (b === true) breached++; else if (b === false) met++;
      }
      if (c.stat === 'met') return { value: met, failed: false };
      if (c.stat === 'breached') return { value: breached, failed: false };
      const tot = met + breached;
      return { value: tot > 0 ? Math.round((met / tot) * 100) : 100, failed: false };
    }

    case 'escalation_accuracy': {
      const where = c.allTime
        ? `ticket_key LIKE 'NT-%'`
        : `ticket_key LIKE 'NT-%' AND created_at >= ? AND created_at < ?`;
      const params = c.allTime ? [] : [`${ctx.day}T00:00:00.000Z`, `${ctx.nextDay}T00:00:00.000Z`];
      const esc = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM escalation_log WHERE ${where} AND escalation_type <> 'rejection'`, params);
      const rej = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM escalation_log WHERE ${where} AND escalation_type = 'rejection'`, params);
      const e = esc[0]?.n ?? 0, r = rej[0]?.n ?? 0;
      return { value: e > 0 ? Math.round(((e - r) / e) * 100) : 100, failed: false };
    }
  }
}
