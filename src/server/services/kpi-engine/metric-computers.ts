/**
 * KPI Recovery — Pluggable Metric Computers (P1-WP1)
 *
 * A registry mapping computation_key → pure function. The engine looks up the
 * computer for each enabled computed metric and runs it against the space's
 * tickets (already filtered to the space, and to a tier when computing per-tier
 * breakdowns). Metrics whose computation_key has no entry here are skipped
 * gracefully — Phase 1 covers the metrics derivable from jira_issue_cache,
 * jira_comment_cache, and the business-hours engine.
 *
 * SLA timings use the business-hours engine (design §5.4). SLA minute targets
 * come from kpi_tier_definitions (configurable), resolved by the engine onto the
 * tier (per-tier) or space.defaultFrtTargetMin/defaultResTargetMin (space-level).
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §4, §5.
 */
import { calculateBusinessMinutes } from './business-hours.js';
import type { KpiTicket, SpaceConfig, EnabledMetric, TierDefinition, MetricComputer } from './types.js';

// Status names (lower-cased) that mean a ticket is closed / not actionable.
const DONE_CATEGORIES = ['done'];
const EXCLUDED_STATUSES = ['done', 'closed', 'resolved', 'waiting on requestor', 'waiting on partner', 'waiting for customer'];

function isOpen(t: KpiTicket): boolean {
  return !DONE_CATEGORIES.includes((t.statusCategory || '').toLowerCase());
}
function isActionable(t: KpiTicket): boolean {
  const s = (t.statusName || '').toLowerCase();
  return isOpen(t) && !!s && !EXCLUDED_STATUSES.includes(s);
}

/** YYYY-MM-DD for an instant in a timezone. */
function tzDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** Was the ticket resolved "today" in the space timezone? */
function isResolvedToday(t: KpiTicket, space: SpaceConfig, todayKey: string): boolean {
  if (!t.resolvedAt) return false;
  return tzDateKey(t.resolvedAt, space.timezone) === todayKey;
}
function isCreatedToday(t: KpiTicket, space: SpaceConfig, todayKey: string): boolean {
  if (!t.created) return false;
  return tzDateKey(t.created, space.timezone) === todayKey;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100; // vacuously compliant when nothing to measure
  return Math.round((numerator / denominator) * 1000) / 10; // 1 dp
}
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function todayKeyFor(space: SpaceConfig): string {
  return tzDateKey(new Date(), space.timezone);
}

function frtTargetFor(space: SpaceConfig, tier?: TierDefinition): number {
  return tier?.frtTargetMinutes ?? space.defaultFrtTargetMin;
}
function resTargetFor(space: SpaceConfig, tier?: TierDefinition): number {
  return tier?.resolutionTargetMinutes ?? space.defaultResTargetMin;
}

// ── SLA compliance / timing ──

const frt_compliance: MetricComputer = (tickets, space, _m, tier) => {
  const target = frtTargetFor(space, tier);
  const todayKey = todayKeyFor(space);
  const resolved = tickets.filter((t) => isResolvedToday(t, space, todayKey));
  if (resolved.length === 0) return 100;
  const within = resolved.filter((t) => {
    if (!t.created || !t.firstPublicCommentAt) return false;
    return calculateBusinessMinutes(t.created, t.firstPublicCommentAt, space) <= target;
  });
  return pct(within.length, resolved.length);
};

const resolution_compliance: MetricComputer = (tickets, space, _m, tier) => {
  const target = resTargetFor(space, tier);
  const todayKey = todayKeyFor(space);
  const resolved = tickets.filter((t) => isResolvedToday(t, space, todayKey));
  if (resolved.length === 0) return 100;
  const within = resolved.filter((t) => {
    if (!t.created || !t.resolvedAt) return false;
    return calculateBusinessMinutes(t.created, t.resolvedAt, space) <= target;
  });
  return pct(within.length, resolved.length);
};

const frt_avg_minutes: MetricComputer = (tickets, space) => {
  const todayKey = todayKeyFor(space);
  const mins = tickets
    .filter((t) => isResolvedToday(t, space, todayKey) && t.created && t.firstPublicCommentAt)
    .map((t) => calculateBusinessMinutes(t.created!, t.firstPublicCommentAt!, space));
  return avg(mins);
};

const resolution_avg_minutes: MetricComputer = (tickets, space) => {
  const todayKey = todayKeyFor(space);
  const mins = tickets
    .filter((t) => isResolvedToday(t, space, todayKey) && t.created && t.resolvedAt)
    .map((t) => calculateBusinessMinutes(t.created!, t.resolvedAt!, space));
  return avg(mins);
};

// ── Volume ──

const queue_total: MetricComputer = (tickets) => tickets.filter(isOpen).length;
const queue_actionable: MetricComputer = (tickets) => tickets.filter(isActionable).length;

const queue_over_sla: MetricComputer = (tickets, space, _m, tier) => {
  const target = resTargetFor(space, tier);
  const now = new Date();
  return tickets.filter((t) => {
    if (!isOpen(t) || !t.created) return false;
    return calculateBusinessMinutes(t.created, now, space) > target;
  }).length;
};

function noReplyDays(tickets: KpiTicket[], space: SpaceConfig, minBusinessDays: number): number {
  const now = new Date();
  const thresholdMinutes = minBusinessDays * (space.bizEndMinutes - space.bizStartMinutes);
  return tickets.filter((t) => {
    if (!isActionable(t)) return false;
    const since = t.firstPublicCommentAt ?? t.created;
    if (!since) return false;
    return calculateBusinessMinutes(since, now, space) >= thresholdMinutes;
  }).length;
}
const queue_no_reply_3d: MetricComputer = (tickets, space) => noReplyDays(tickets, space, 3);
const queue_no_reply_5d: MetricComputer = (tickets, space) => noReplyDays(tickets, space, 5);

const opened_today: MetricComputer = (tickets, space) => {
  const todayKey = todayKeyFor(space);
  return tickets.filter((t) => isCreatedToday(t, space, todayKey)).length;
};
const resolved_today: MetricComputer = (tickets, space) => {
  const todayKey = todayKeyFor(space);
  return tickets.filter((t) => isResolvedToday(t, space, todayKey)).length;
};

const oldest_actionable_hrs: MetricComputer = (tickets, space) => {
  const now = new Date();
  let oldest = 0;
  for (const t of tickets) {
    if (!isActionable(t) || !t.created) continue;
    const hrs = calculateBusinessMinutes(t.created, now, space) / 60;
    if (hrs > oldest) oldest = hrs;
  }
  return Math.round(oldest * 10) / 10;
};

const sla_breach_count: MetricComputer = (tickets) =>
  tickets.filter((t) => isOpen(t) && t.slaBreached).length;

const backlog_age_avg_days: MetricComputer = (tickets, space) => {
  const now = new Date();
  const ages = tickets
    .filter((t) => isOpen(t) && t.created)
    .map((t) => calculateBusinessMinutes(t.created!, now, space) / (60 * ((space.bizEndMinutes - space.bizStartMinutes) / 60)));
  return avg(ages);
};

const tickets_per_agent: MetricComputer = (tickets) => {
  const open = tickets.filter(isOpen);
  const agents = new Set(open.map((t) => t.assigneeAccountId).filter(Boolean));
  if (agents.size === 0) return 0;
  return Math.round((open.length / agents.size) * 10) / 10;
};

// ── Quality ──

const csat_score: MetricComputer = (tickets) => {
  const rated = tickets.map((t) => t.csatRating).filter((r): r is number => r != null);
  return avg(rated);
};
const csat_response_rate: MetricComputer = (tickets, space) => {
  const todayKey = todayKeyFor(space);
  const resolved = tickets.filter((t) => isResolvedToday(t, space, todayKey));
  if (resolved.length === 0) return 0;
  const rated = resolved.filter((t) => t.csatRating != null);
  return pct(rated.length, resolved.length);
};

const first_line_resolution: MetricComputer = (tickets, space) => {
  // NT only — resolved today at 1st-line tier (Customer Care).
  const todayKey = todayKeyFor(space);
  const resolved = tickets.filter((t) => isResolvedToday(t, space, todayKey));
  if (resolved.length === 0) return 0;
  const firstLine = resolved.filter((t) => (t.currentTier || '').toLowerCase() === 'customer care');
  return pct(firstLine.length, resolved.length);
};

// ── Escalation / QA source families (KPX-WP3) ──
// These derive from non-ticket sources (escalation_log, jira_qa_results,
// Jira_QA_GoldenRules) pre-fetched into `ctx` by the engine. Each intersects its
// source rows with the ticket subset it is handed via issueKey, so the SAME
// computer yields the space-level value (all tickets) and the agent-level value
// (one agent's tickets) with no name/id mapping. They return `null` (not 0) when
// the source is unavailable or there is nothing to measure, so an outage reads as
// "—" and never as a fabricated metric.

const escalation_rate: MetricComputer = (tickets, _space, _m, _tier, ctx) => {
  if (!ctx?.escalationAvailable) return null;
  const keys = new Set(tickets.map((t) => t.issueKey));
  if (keys.size === 0) return null; // no tickets in scope → no rate to express
  // ctx.escalations already excludes rejection-type rows (partitioned in the
  // provider), so bounce-backs never inflate the escalation rate.
  const escalated = ctx.escalations.filter((e) => keys.has(e.issueKey)).length;
  return pct(escalated, keys.size);
};

// rejection / bounce-back family (KPX-WP5). Sourced from explicitly-captured
// `rejection` events in escalation_log (never inferred from tier moves). Both
// return null until the rejection capture path has produced at least one event
// (ctx.rejectionAvailable), so a system with no captured rejections reads "—"
// rather than a fabricated 0% (rejection) / 100% (accuracy).

const rejection_rate: MetricComputer = (tickets, _space, _m, _tier, ctx) => {
  if (!ctx?.rejectionAvailable) return null;
  const keys = new Set(tickets.map((t) => t.issueKey));
  if (keys.size === 0) return null;
  const rejected = ctx.rejections.filter((r) => keys.has(r.issueKey)).length;
  return pct(rejected, keys.size);
};

const escalation_accuracy: MetricComputer = (tickets, _space, _m, _tier, ctx) => {
  // Needs both a live escalation source and a live rejection source: accuracy is
  // the proportion of escalations that were NOT bounced back, so without rejection
  // capture we cannot claim escalations were accurate.
  if (!ctx?.escalationAvailable || !ctx?.rejectionAvailable) return null;
  const keys = new Set(tickets.map((t) => t.issueKey));
  const escalated = ctx.escalations.filter((e) => keys.has(e.issueKey)).length;
  if (escalated === 0) return null; // no escalations → accuracy undefined, not a fabricated 100
  const rejected = ctx.rejections.filter((r) => keys.has(r.issueKey)).length;
  return pct(Math.max(0, escalated - rejected), escalated);
};

const qa_score_avg: MetricComputer = (tickets, _space, _m, _tier, ctx) => {
  if (!ctx?.qaAvailable) return null;
  const keys = new Set(tickets.map((t) => t.issueKey));
  const scores = ctx.qaResults
    .filter((r) => keys.has(r.issueKey) && r.overallScore != null)
    .map((r) => r.overallScore as number);
  if (scores.length === 0) return null; // nothing scored for these tickets
  return avg(scores);
};

const golden_rules_avg: MetricComputer = (tickets, _space, _m, _tier, ctx) => {
  if (!ctx?.goldenRulesAvailable) return null;
  const keys = new Set(tickets.map((t) => t.issueKey));
  const scores = ctx.goldenRules
    .filter((r) => keys.has(r.issueKey) && r.overallScore != null)
    .map((r) => r.overallScore as number);
  if (scores.length === 0) return null;
  return avg(scores);
};

// ── NTPJ bespoke ──

const story_points_completed: MetricComputer = (tickets, space) => {
  const todayKey = todayKeyFor(space);
  return Math.round(
    tickets
      .filter((t) => isResolvedToday(t, space, todayKey) && t.storyPoints != null)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0) * 10,
  ) / 10;
};
const story_points_remaining: MetricComputer = (tickets) =>
  Math.round(
    tickets
      .filter((t) => isOpen(t) && t.storyPoints != null)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0) * 10,
  ) / 10;

/**
 * Registry. Keyed by computation_key (== metric_key for computed metrics).
 * Only the keys present here will populate; everything else is skipped.
 */
export const metricComputers: Record<string, MetricComputer> = {
  frt_compliance,
  resolution_compliance,
  frt_avg_minutes,
  resolution_avg_minutes,
  queue_total,
  queue_actionable,
  queue_over_sla,
  queue_no_reply_3d,
  queue_no_reply_5d,
  opened_today,
  resolved_today,
  oldest_actionable_hrs,
  sla_breach_count,
  backlog_age_avg_days,
  tickets_per_agent,
  csat_score,
  csat_response_rate,
  first_line_resolution,
  escalation_rate,
  rejection_rate,
  escalation_accuracy,
  qa_score_avg,
  golden_rules_avg,
  story_points_completed,
  story_points_remaining,
};

export function hasComputer(key: string | null | undefined): boolean {
  return !!key && key in metricComputers;
}
