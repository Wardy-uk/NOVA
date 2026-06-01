// Shared wallboard drill-down + tile logic.
//
// The wallboard TILES (Customer Care / Technical Support) and the drill-down
// PANEL must agree on their counts. To guarantee that, both derive their
// numbers from the SAME live ticket set and the SAME filter logic defined here.
// (Previously tiles read n8n's jira_kpi_daily snapshot while the drill queried
// live Jira — two sources, so counts drifted, e.g. tile 6 vs drill 7.)

import { isOverdueUpdate, isResolutionSlaBreached } from './jira-sla.js';

/** Minimal shape we need off an aggregator NormalizedTask. */
export interface DrillTicket {
  source_id: string;
  title: string;
  status?: string | null;
  priority?: number | null;
  source_url?: string | null;
  raw_data?: unknown;
}

export interface TicketWithMeta {
  ticket: DrillTicket;
  tier: string | null;
  rt: string;
  issue: Record<string, unknown>;
  status: string;
}

// CC bucket logic matching the n8n KPI engine: request type → bucket.
const CC_INCIDENTS = new Set(['Incident', 'Chat', 'AI Request', 'Emailed Request', 'GDPR']);
const CC_SERVICE_REQUESTS = new Set(['Service Request']);
const CC_TPJ = new Set(['TPJ Request']);

// SLA actionable status set (matching n8n).
const SLA_ACTIONABLE = new Set(['open', 'reopened', 'work in progress']);
const EXCLUDED_STATUSES = new Set(['done', 'closed', 'resolved', 'waiting on requestor', 'waiting on partner']);

export function extractTier(t: { raw_data?: unknown }): string | null {
  const rd = (t.raw_data && typeof t.raw_data === 'object') ? t.raw_data as Record<string, unknown> : null;
  if (!rd) return null;
  const raw = rd.customfield_12981;
  const val = typeof raw === 'string' ? raw : (raw && typeof raw === 'object') ? (raw as any).value ?? (raw as any).name : null;
  if (!val) return null;
  const lower = val.toString().trim().toLowerCase();
  if (lower === 'customer care') return 'Customer Care';
  if (lower === 'production') return 'Production';
  if (lower === 'tier 2') return 'Tier 2';
  if (lower === 'tier 3') return 'Tier 3';
  if (lower === 'development') return 'Development';
  return val.toString().trim();
}

export function extractRequestType(t: { raw_data?: unknown }): string {
  const rd = (t.raw_data && typeof t.raw_data === 'object') ? t.raw_data as Record<string, unknown> : null;
  if (!rd) return '';
  // customfield_13482 is the request type field (from n8n KPI engine)
  const v1 = rd.customfield_13482;
  const rt1 = typeof v1 === 'string' ? v1 : (v1 && typeof v1 === 'object') ? ((v1 as any).value ?? (v1 as any).name ?? '') : '';
  if (rt1) return rt1.toString().trim();
  // Fallback: customfield_12800.requestType
  const v2 = rd.customfield_12800 as Record<string, unknown> | undefined;
  const rt2 = v2?.requestType as Record<string, unknown> | undefined;
  return ((rt2?.name ?? rt2?.value ?? rt2?.displayName ?? '') as string).toString().trim();
}

export function extractAssignee(t: { raw_data?: unknown }): string {
  const rd = (t.raw_data && typeof t.raw_data === 'object') ? t.raw_data as Record<string, unknown> : null;
  if (!rd) return 'Unassigned';
  const fields = (rd.fields as Record<string, unknown>) ?? rd;
  const a = fields.assignee as Record<string, unknown> | undefined;
  return ((a?.displayName ?? a?.name ?? 'Unassigned') as string).toString();
}

export function ccBucket(rt: string): string | null {
  if (CC_INCIDENTS.has(rt)) return 'CC (Incidents)';
  if (CC_SERVICE_REQUESTS.has(rt)) return 'CC (Service Requests)';
  if (CC_TPJ.has(rt)) return 'CC (TPJ)';
  return null;
}

function isActionableSla(status: string): boolean {
  return SLA_ACTIONABLE.has(status.toLowerCase());
}

/** Enrich raw aggregator tickets with the fields the filters need. */
export function enrichTickets(tickets: DrillTicket[]): TicketWithMeta[] {
  return tickets.map(t => {
    const issue = (t.raw_data ?? {}) as Record<string, unknown>;
    return {
      ticket: t,
      tier: extractTier(t),
      rt: extractRequestType(t),
      issue,
      status: t.status ?? 'unknown',
    };
  });
}

/**
 * Build a predicate for a KPI name, or null if the KPI isn't ticket-drillable
 * (e.g. CSAT, FRT, Oldest, Compliance %). `now` is needed for no-reply checks.
 */
export function buildKpiFilter(kpiName: string, now: Date): ((t: TicketWithMeta) => boolean) | null {
  const kn = kpiName.trim();

  // Volume KPIs: "Number of Tickets in <tier/bucket>"
  const volMatch = kn.match(/^Number of Tickets in (.+)$/i);
  if (volMatch) {
    const target = volMatch[1].trim();
    return (t) => {
      if (t.tier === 'Customer Care') return ccBucket(t.rt) === target;
      return t.tier === target;
    };
  }

  // No Reply KPIs: "Number of Tickets With No Reply in <tier/bucket>"
  const nrMatch = kn.match(/^Number of Tickets With No Reply in (.+)$/i);
  if (nrMatch) {
    const target = nrMatch[1].trim();
    return (t) => {
      const tierMatch = t.tier === 'Customer Care' ? ccBucket(t.rt) === target : t.tier === target;
      return tierMatch && isOverdueUpdate(t.issue, now);
    };
  }

  // SLA breached KPIs: "<name> over SLA (actionable|not actionable)"
  const slaMatch = kn.match(/^(.+) over SLA \((actionable|not actionable)\)$/i);
  if (slaMatch) {
    const name = slaMatch[1].trim();
    const actionable = slaMatch[2].toLowerCase() === 'actionable';
    return (t) => {
      let tierMatch = false;
      if (name === 'CC Incidents') tierMatch = t.tier === 'Customer Care' && CC_INCIDENTS.has(t.rt);
      else if (name === 'CC Service Requests') tierMatch = t.tier === 'Customer Care' && CC_SERVICE_REQUESTS.has(t.rt);
      else if (name === 'CC TPJ' || name === 'CC (TPJ)') tierMatch = t.tier === 'Customer Care' && CC_TPJ.has(t.rt);
      else tierMatch = t.tier === name;

      if (!tierMatch) return false;
      if (!isResolutionSlaBreached(t.issue)) return false;
      const statusLower = t.status.toLowerCase();
      if (EXCLUDED_STATUSES.has(statusLower)) return false;
      return actionable === isActionableSla(statusLower);
    };
  }

  // Non-drillable KPI types — no underlying ticket list.
  // (FRT breached, Oldest actionable, Compliance %, KPI roll-up counts, etc.)
  return null;
}

// ── SLA Breach board: per-agent stats, ported from n8n "Daily KPI Report v4" ──
// raw_data is the flat Jira issue (custom fields at top level), so we read the
// fields directly off `issue` rather than `issue.fields`.

const SLA_RESOLUTION_FIELD = 'customfield_14048';   // Time to resolution SLA
const AGENT_LAST_UPDATE_FIELD = 'customfield_14081';
const AGENT_NEXT_UPDATE_FIELD = 'customfield_14185';
const SLA_EXCLUDED_STATUSES = new Set(['done', 'closed', 'resolved', 'waiting on requestor', 'waiting on partner']);
const FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1000;

function rawStatusName(issue: Record<string, unknown>): string {
  const s = issue?.status as Record<string, unknown> | string | undefined;
  const name = typeof s === 'string' ? s : (s?.name as string) ?? '';
  return name.toString().trim().toLowerCase();
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Mirror of n8n isSlaBreached: ongoing or completed resolution SLA cycle breached. */
function slaResolutionBreached(slaField: unknown): boolean {
  if (!slaField) return false;
  const arr = Array.isArray(slaField) ? slaField : [slaField];
  for (const x of arr as Array<Record<string, unknown>>) {
    if (!x) continue;
    const ongoing = x.ongoingCycle as Record<string, unknown> | undefined;
    if (ongoing) {
      if (ongoing.breached === true) return true;
      const rem = (ongoing.remainingTime as Record<string, unknown> | undefined)?.millis;
      if (typeof rem === 'number' && rem < 0) return true;
    }
    const completed = x.completedCycles as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(completed)) {
      for (const c of completed) {
        if (!c) continue;
        if (c.breached === true) return true;
        const crem = (c.remainingTime as Record<string, unknown> | undefined)?.millis;
        if (typeof crem === 'number' && crem < 0) return true;
      }
    }
  }
  return false;
}

/** n8n isOverSla: resolution SLA breached, excluding done/closed/resolved/waiting, with duedate guard. */
export function isOverSlaResolution(issue: Record<string, unknown>, now: Date): boolean {
  const status = rawStatusName(issue);
  if (SLA_EXCLUDED_STATUSES.has(status)) return false;
  const dueStr = issue?.duedate as string | undefined;
  if (dueStr) {
    const due = toDate(dueStr + 'T23:59:59.999');
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (due && due > endOfDay) return false;
  }
  return slaResolutionBreached(issue?.[SLA_RESOLUTION_FIELD]);
}

/** n8n isNotUpdated: agent last-update before today, next-update not in future, not waiting-on-requestor. */
export function isNotUpdatedToday(issue: Record<string, unknown>, now: Date): boolean {
  const status = rawStatusName(issue);
  if (status === 'waiting on requestor') return false;
  const lastDt = toDate(issue?.[AGENT_LAST_UPDATE_FIELD]);
  const nextDt = toDate(issue?.[AGENT_NEXT_UPDATE_FIELD]);
  if (nextDt && nextDt > now) return false;
  if (!lastDt) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (lastDt >= startOfToday) return false;
  if (lastDt < new Date(now.getTime() - FIFTY_TWO_WEEKS_MS)) return false;
  return true;
}

export interface AgentLiveStats {
  open: number;
  overSla: number;
  notUpdated: number;
  oldestDays: number;
  oldestKey: string;
}

/** Compute the SLA-board stats for one agent's subset of enriched open tickets. */
export function agentStatsForSubset(subset: TicketWithMeta[], now: Date): AgentLiveStats {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  let overSla = 0, notUpdated = 0;
  let oldestCreated: Date | null = null;
  let oldestKey = '';
  for (const { issue, ticket } of subset) {
    if (isOverSlaResolution(issue, now)) overSla++;
    if (isNotUpdatedToday(issue, now)) notUpdated++;
    const created = toDate(issue?.created);
    if (created && (!oldestCreated || created < oldestCreated)) {
      oldestCreated = created;
      oldestKey = ticket.source_id || '';
    }
  }
  return {
    open: subset.length,
    overSla,
    notUpdated,
    oldestDays: oldestCreated ? Math.floor((now.getTime() - oldestCreated.getTime()) / ONE_DAY_MS) : 0,
    oldestKey,
  };
}

/** Fuzzy assignee↔agent-name match — identical to the agent drill, so tile == drill. */
export function agentNameMatches(assigneeLower: string, agentNameLower: string): boolean {
  if (!assigneeLower || !agentNameLower) return false;
  return assigneeLower.includes(agentNameLower) || agentNameLower.includes(assigneeLower);
}

/**
 * Live count for a KPI from an enriched ticket set. Supports `sumKpis`
 * (e.g. Development = Development + Tier 3). Returns null if none of the
 * KPI names are drillable.
 */
export function countForPanel(
  enriched: TicketWithMeta[],
  now: Date,
  panel: { kpi: string; sumKpis?: string[] },
): number | null {
  const names = panel.sumKpis?.length ? panel.sumKpis : [panel.kpi];
  let total = 0;
  let anyDrillable = false;
  for (const name of names) {
    const filter = buildKpiFilter(name, now);
    if (!filter) continue;
    anyDrillable = true;
    total += enriched.filter(filter).length;
  }
  return anyDrillable ? total : null;
}
