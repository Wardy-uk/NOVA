import { query } from './database.js';

/**
 * Ticket-flow signals — how work MOVES, not how much of it there is.
 *
 * The Support Review (w/c 3 Aug 2026) was written from five facts about
 * movement: 90.5% of SLA breaches happen while the ticket sits in Customer Care,
 * the worst ticket bounced 13 times across 16 queue moves, tickets are handed
 * back without guidance, aged tickets sit with no named owner, and the Dev queue
 * behaves like a black hole.
 *
 * Every one of those was computable from `escalation_log` and `jira_issue_cache`
 * on the day the review was written. Nobody computed them. That is the actual
 * finding, and this service exists so it cannot recur — the numbers cross to
 * NEURO's weekly risk report whether or not anyone thinks to ask.
 *
 * Two things it deliberately does that `EscalationLogService.getStats()` does not:
 *
 * 1. **It counts rejections.** `getStats()` filters `escalation_type <>
 *    'rejection'` out of every aggregate it returns — total, by_type, by_tier,
 *    by_reason, daily. That is right for measuring escalation volume and wrong
 *    for measuring friction: it makes handbacks, the review's single largest
 *    complaint, invisible in NOVA's own reporting.
 *
 * 2. **It reports movement, not level.** Each signal carries the same window
 *    immediately before it. A backlog that is bad and steady needs a plan; a
 *    backlog that doubled in a fortnight needs a phone call, and only the
 *    comparison distinguishes them. Proactive oversight is a first derivative.
 *
 * Each signal is independently fallible and carries its own `ok`. A section that
 * could not be measured must render downstream as absent, never as a healthy
 * zero — a false all-clear in a report going to the person assessing a PIP is
 * worse than no report at all. Same contract as NEURO's `weekly-risk` sources.
 *
 * Strictly SELECT. Nothing here writes.
 */

/**
 * Stamped into every response so a caller can tell WHICH build answered.
 *
 * The validator learned this the hard way — two runs were spent working out
 * that a box was on old code — and the endpoint needed it just as badly: a
 * deploy that silently served a stale `dist` returned a response that looked
 * plausible, with three new fields quietly `undefined`. A missing field is
 * indistinguishable from a field that is legitimately empty; a version is not.
 *
 * Bump on any change to the shape of the response.
 */
export const FLOW_SIGNALS_BUILD = '2026-08-18-classifier';

/** Queue moves within the window before a ticket counts as ping-ponging. */
export const PING_PONG_THRESHOLD = 3;
/** Open and untouched for this long is a stalled ticket, not a queued one. */
export const STALE_DAYS = 14;
/** Rows returned by any "worst offenders" list. */
export const TOP_N = 10;

/**
 * Read `jira_issue_cache` without taking shared locks.
 *
 * The table is small — around 5,600 rows — so nothing here is slow on volume.
 * What it IS, is hot: the Jira sync writes to it continuously, and a reporting
 * SELECT that scans the clustered index queues behind those writes and dies on
 * the 30s request timeout. That is what was killing breach-by-queue while the
 * other signals, which have nonclustered indexes to hide behind, came back fine.
 *
 * A dirty read is the right trade HERE and would not be elsewhere. This is a
 * cache being aggregated for a weekly report, the report already carries an
 * explicit "these are a floor, not a total" caveat about that cache's freshness,
 * and being approximately right on Monday beats being exactly absent. It must
 * not spread to anything that writes, bills, or decides.
 */
const DIRTY_READ = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n';

/**
 * Jira's Resolution SLA field. The wallboards count breaches with
 * `cf[14048] = breached()`, so anything reported here has to come from the same
 * field or the two will disagree in front of the team.
 *
 * Explicitly NOT `sla_breached` / `sla_breach_time` on jira_issue_cache. Those
 * columns are populated from `customfield_10010`, which the sync does not fetch
 * — the field list asks Jira for 14046 and 14048. The columns are therefore 0 on
 * every one of the 5,602 cached rows and always will be. That is a real defect
 * in jira-sync-service, tracked separately; this service routes around it by
 * reading the JSON the sync *does* store.
 */
export const RESOLUTION_SLA_FIELD = 'customfield_14048';

// Tier seniority lives in its own module because the Jira sync classifies moves
// as they happen and this classifies them retrospectively — if the two ever
// disagreed, the weekly report would contradict the escalation log.
import { tierRank } from './tier-rank.js';

export { tierRank };

/**
 * Projects these signals cover.
 *
 * NT only, because every NOVA KPI and every wallboard tile is scoped
 * `project = NT` (registry.ts NT_OPEN). The ticket cache is NOT — the sync pulls
 * whatever `agent_jira_project` and `assignment_projects` are set to, so it
 * carries NTPJ and others alongside. The first cut of this service filtered by
 * nothing at all and silently mixed them, which would have put figures in front
 * of the team that could never be reconciled against the board on the wall.
 *
 * Widening this is a legitimate choice — the Support Review itself counted TPJ
 * work — but it has to be a deliberate one, and the excluded projects are
 * reported so the decision stays visible rather than becoming a default nobody
 * remembers making.
 */
export const DEFAULT_PROJECTS = ['NT'];

/**
 * `escalation_log` has no project column, only `ticket_key`. Matching on the
 * prefix therefore has to include the hyphen: `LIKE 'NT%'` also matches every
 * NTPJ ticket, which is exactly the conflation this scoping exists to prevent.
 */
function ticketKeyScope(projects: string[]): { clause: string; params: string[] } {
  return {
    clause: `(${projects.map(() => 'ticket_key LIKE ?').join(' OR ')})`,
    params: projects.map(p => `${p}-%`),
  };
}

function projectScope(projects: string[], alias = ''): { clause: string; params: string[] } {
  const col = alias ? `${alias}.project_key` : 'project_key';
  return {
    clause: `${col} IN (${projects.map(() => '?').join(', ')})`,
    params: projects,
  };
}

export interface Signal<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

export interface HandbackData {
  /**
   * EVIDENCED rejections only — moves the sync could prove went through the
   * "Submit for Rejection to ..." screen. A downward tier move is not enough:
   * Development → Customer Care is usually a released fix returning for test.
   */
  total: number;
  previous: number;
  changePct: number | null;
  routes: Array<{ from_tier: string; to_tier: string; count: number }>;
  /**
   * Moves down the ladder that are NOT rejections, plus moves involving a queue
   * with no place on it (Escalations, Production). Reported rather than silently
   * dropped, so the rejection total cannot be read as covering every movement.
   */
  unclassified: number;
  /**
   * Returns evidenced as completed work coming back to be verified — a linked
   * delivery item is Done. This is the system working. Kept apart from `total`
   * so it can never be presented as friction.
   */
  returnsAfterFix: number;
  /**
   * Why work came back, from the mandatory Rejection Reason on the transition
   * screen (cf13216). Null when the query failed; `withoutReason` counts rows
   * recorded before the sync started capturing it, so the reasons cannot be
   * mistaken for complete coverage.
   */
  reasons: {
    top: Array<{ reason: string; count: number }>;
    withoutReason: number;
    classified: number;
  } | null;
}

export interface PingPongData {
  threshold: number;
  ticketsAffected: number;
  worst: Array<{
    ticket_key: string; moves: number; returns: number;
    first_move: string; last_move: string;
  }>;
}

export interface BreachByQueueData {
  total: number;
  /**
   * Open tickets in scope with a LIVE Resolution SLA clock — an ongoing cycle
   * carrying a breach time. Deliberately not called "tickets with an SLA": a
   * paused SLA (waiting on requestor/partner/development) and a completed cycle
   * both fall out of this, so it is a much smaller number than the population
   * that has an SLA applied, and reading it as a denominator is wrong.
   */
  withLiveClock: number;
  /**
   * Open tickets in scope carrying a Resolution SLA field at all, paused or
   * running. THIS is the denominator for "what share of work is under SLA".
   * Null when the count could not be taken — it parses JSON and is best-effort,
   * so it degrades rather than costing the breach numbers.
   */
  withSlaField: number | null;
  /** Open tickets in scope — the denominator `withSlaField` is a share OF. */
  openTickets: number;
  /**
   * What this actually measures, carried with the number so a reader cannot
   * mistake it for the Support Review's figure. See the note on the function.
   */
  basis: string;
  byTier: Array<{ tier: string; breaches: number; sharePct: number | null }>;
  coverage: { cachedTickets: number | null; lastSync: string | null };
}

export interface UnownedData {
  total: number;
  byTier: Array<{ tier: string; count: number; oldest_days: number }>;
}

export interface StalledData {
  staleDays: number;
  total: number;
  byTier: Array<{ tier: string; count: number }>;
  worst: Array<{
    issue_key: string; summary: string; tier: string;
    assignee: string | null; days_untouched: number;
  }>;
}

export interface FlowSignals {
  /** Which build of this service answered. See FLOW_SIGNALS_BUILD. */
  build: string;
  window: { days: number; from: string };
  /**
   * Which Jira projects these numbers cover, and which are deliberately left
   * out. Carried on every response so a figure can always be reconciled against
   * the wallboards, which are `project = NT`.
   */
  scope: {
    projects: string[];
    excluded: Array<{ project: string; cachedTickets: number }> | null;
  };
  handbacks: Signal<HandbackData>;
  pingPong: Signal<PingPongData>;
  breachesByQueue: Signal<BreachByQueueData>;
  unowned: Signal<UnownedData>;
  stalled: Signal<StalledData>;
  unavailable: Array<{ name: string; error: string | null }>;
}

/**
 * Run one signal so its failure degrades a section rather than losing the whole
 * response. Mirrors `pull()` in NEURO's weekly-risk — the shape is deliberate,
 * because the two halves have to agree on what "unavailable" looks like.
 */
async function signal<T>(fn: () => Promise<T>): Promise<Signal<T>> {
  try {
    return { ok: true, error: null, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Query failed', data: null };
  }
}

/** Percentage change, or null when the baseline is zero and a ratio is meaningless. */
function delta(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/**
 * A higher tier formally returning a ticket to a lower one. The review's two-way
 * complaint — Tier 2 rejecting without saying what is missing, Customer Care
 * escalating without enough investigation — is this number.
 */
async function handbacks(days: number, prior: number, projects: string[]): Promise<HandbackData> {
  const scope = ticketKeyScope(projects);
  // Classified by DIRECTION, not by escalation_type.
  //
  // `escalation_type = 'rejection'` returns zero and always will: the only
  // caller of logRejection() is an admin endpoint with no UI behind it, and the
  // live sync at jira-sync-service.ts hardcodes 'jira_transition' for every tier
  // move regardless of direction. But it writes from_tier and to_tier correctly,
  // so a move from Tier 2 back to Customer Care is already sitting in the table
  // — described accurately, just never named.
  //
  // Reading direction from the columns means this works on the existing history
  // rather than only on rows written after a fix ships. Nothing about the write
  // path has to change for the number to become true.
  // The period CASE is computed in a derived table and grouped by its alias.
  //
  // Writing it in both SELECT and GROUP BY does not work here: each `?` becomes
  // a separate parameter (@p0 vs @p3), so SQL Server sees two textually
  // different expressions and rejects the grouping outright — "created_at is
  // invalid in the select list". Same value, different parameter, different
  // expression. Computing it once removes the possibility.
  const rows = await query<{ from_tier: string | null; to_tier: string | null; escalation_type: string; reason_code: string | null; period: string; count: number }>(
    `SELECT from_tier, to_tier, escalation_type, reason_code, period, COUNT(*) AS count
       FROM (
         SELECT from_tier, to_tier, escalation_type, reason_code,
                CASE WHEN created_at >= DATEADD(day, ?, GETUTCDATE()) THEN 'current' ELSE 'previous' END AS period
           FROM escalation_log
          WHERE created_at >= DATEADD(day, ?, GETUTCDATE())
            AND ${scope.clause}
            AND from_tier IS NOT NULL AND to_tier IS NOT NULL
            AND from_tier <> to_tier
       ) t
      GROUP BY from_tier, to_tier, escalation_type, reason_code, period`,
    [-days, -prior, ...scope.params],
  );

  // Returns that are the system WORKING: a released fix coming back to be
  // verified, evidenced by a closed delivery item in another project. Counted
  // separately and never added to the rejection total — the first version of
  // this signal folded them in and reported 217 "handbacks", of which 80 were
  // Development → Customer Care and almost certainly completed work.
  const returnsAfterFix = rows
    .filter(r => r.period === 'current' && r.reason_code === 'jira_return_after_fix')
    .reduce((s, r) => s + r.count, 0);

  const routes: HandbackData['routes'] = [];
  let total = 0;
  let previous = 0;
  let unclassified = 0;

  for (const r of rows) {
    const from = tierRank(r.from_tier);
    const to = tierRank(r.to_tier);
    // A move touching a queue outside the ladder — Escalations, Production — has
    // no direction. Counted, and reported, but never guessed at.
    if (from === null || to === null) {
      if (r.period === 'current') unclassified += r.count;
      continue;
    }
    if (to >= from) continue;              // escalation, or sideways
    // A downward move is NOT automatically a rejection. Development → Customer
    // Care is usually a released fix coming back to be tested, and only rows the
    // sync could evidence as rejections carry escalation_type = 'rejection'.
    // Everything else downward is counted separately below.
    if (r.escalation_type !== 'rejection') {
      if (r.period === 'current') unclassified += r.count;
      continue;
    }
    if (r.period === 'current') {
      total += r.count;
      routes.push({ from_tier: r.from_tier as string, to_tier: r.to_tier as string, count: r.count });
    } else {
      previous += r.count;
    }
  }

  routes.sort((a, b) => b.count - a.count);

  // WHY work is coming back, not just how often.
  //
  // Rejection Reason (cf13216) is mandatory on the "Submit for Rejection to ..."
  // transition screen, so a genuine handback carries one. The sync snapshots it
  // onto the log row at the moment of the move; this groups them. It is free
  // text, so it is reported as written rather than bucketed — inventing
  // categories over someone else's words would be a worse distortion than a
  // slightly untidy list.
  //
  // Best-effort, and only populated for moves recorded AFTER the sync started
  // capturing it. Older rows have no reason and are counted as such rather than
  // being quietly dropped from the denominator.
  let reasons: HandbackData['reasons'] = null;
  try {
    const rows = await query<{ reason: string | null; count: number }>(
      `SELECT TOP (?) reason_label AS reason, COUNT(*) AS count
         FROM escalation_log
        WHERE escalation_type = 'rejection'
          AND created_at >= DATEADD(day, ?, GETUTCDATE())
          AND ${scope.clause}
        GROUP BY reason_label
        ORDER BY COUNT(*) DESC`,
      [TOP_N, -days, ...scope.params],
    );
    const withReason = rows.filter(r => r.reason && r.reason.trim());
    reasons = {
      top: withReason.map(r => ({ reason: (r.reason as string).trim(), count: r.count })),
      withoutReason: rows.filter(r => !r.reason || !r.reason.trim()).reduce((s, r) => s + r.count, 0),
      classified: rows.reduce((s, r) => s + r.count, 0),
    };
  } catch { /* the reasons are the enrichment; the count is the signal */ }

  return { total, previous, changePct: delta(total, previous), routes, unclassified, returnsAfterFix, reasons };
}

/**
 * Tickets crossing queues repeatedly. Counted from the log rather than from the
 * live risk-scorer so the figure is reproducible after the fact — a number in a
 * report to a manager has to still be true when he checks it on Thursday.
 */
async function pingPong(days: number, projects: string[]): Promise<PingPongData> {
  const scope = ticketKeyScope(projects);
  const [worst, affected] = await Promise.all([
    query<PingPongData['worst'][number]>(
      `SELECT TOP (?)
              e.ticket_key,
              COUNT(*) AS moves,
              SUM(CASE WHEN e.escalation_type = 'rejection' THEN 1 ELSE 0 END) AS [returns],
              MIN(e.created_at) AS first_move,
              MAX(e.created_at) AS last_move
         FROM escalation_log e
        WHERE e.created_at >= DATEADD(day, ?, GETUTCDATE())
          AND ${scope.clause.replace(/ticket_key/g, 'e.ticket_key')}
        GROUP BY e.ticket_key
       HAVING COUNT(*) >= ?
        ORDER BY COUNT(*) DESC, SUM(CASE WHEN e.escalation_type = 'rejection' THEN 1 ELSE 0 END) DESC`,
      [TOP_N, -days, ...scope.params, PING_PONG_THRESHOLD],
    ),
    query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT ticket_key
           FROM escalation_log
          WHERE created_at >= DATEADD(day, ?, GETUTCDATE())
            AND ${scope.clause}
          GROUP BY ticket_key
         HAVING COUNT(*) >= ?
       ) t`,
      [-days, ...scope.params, PING_PONG_THRESHOLD],
    ),
  ]);

  return { threshold: PING_PONG_THRESHOLD, ticketsAffected: affected[0]?.cnt ?? 0, worst };
}

/**
 * Where the ticket was sitting when it breached. The review's headline — 90.5%
 * in Customer Care — is not evidence that Customer Care is slow. It is evidence
 * that Customer Care is where tickets wait for everybody else, and reading it
 * the other way would put the improvement effort in the wrong team entirely.
 */
async function breachesByQueue(projects: string[]): Promise<BreachByQueueData> {
  const scope = projectScope(projects, 'c');
  const bare = projectScope(projects);
  // Reads customfield_14048 out of `fields_json` — the same Resolution SLA field
  // the wallboards count with `cf[14048] = breached()`. A figure in this report
  // that disagreed with the wallboard would be indefensible in front of the team,
  // so it has to be the same field, breached by the same definition: the ongoing
  // cycle breached, or any completed cycle breached.
  // ONE pass, and only the ongoing cycle.
  //
  // The first version parsed each row twice — a JSON_VALUE plus an OPENJSON
  // subquery over completedCycles — and then made a second full pass to count
  // how many tickets carried an SLA at all. Three JSON parses per row across the
  // whole NT cache is real CPU on a DTU-limited instance, and it timed out.
  //
  // completedCycles is dropped deliberately rather than for speed alone. This
  // signal counts tickets that are OPEN and over SLA; for an open ticket the
  // ongoing cycle is the live one, and that is also what Jira's `breached()`
  // matches — so keeping only it makes the figure agree with the wallboards
  // rather than quietly exceeding them.
  //
  // The SLA-present count rides along in the same aggregate, so distinguishing
  // "no breaches" from "no SLA data" costs nothing extra.
  // Reads the COLUMN, not the JSON.
  //
  // Parsing cf14048 out of fields_json per row was correct but far too
  // expensive — it timed out at 30s even scoped to NT and reduced to a single
  // pass. The underlying reason the column could not be used was a genuine bug
  // in jira-sync-service: it populated sla_breached from customfield_10010, a
  // field the sync never fetches, so the column was 0 on every row. That is now
  // fixed at source, and this reads the indexed column it should always have
  // read (IX_jira_cache_sla_breach covers exactly this shape).
  //
  // Note the column fills in on the NEXT sync pass, not retroactively. Until
  // then slaDataPresent is 0 and the signal reports itself as unreadable rather
  // than as a clean queue — which is the correct behaviour while it catches up.
  const rows = await query<{ tier: string | null; breaches: number; live_clock: number; open_total: number }>(
    `${DIRTY_READ}
     SELECT c.current_tier AS tier,
            SUM(CASE WHEN c.sla_breached = 1 THEN 1 ELSE 0 END) AS breaches,
            SUM(CASE WHEN c.sla_breach_time IS NOT NULL THEN 1 ELSE 0 END) AS live_clock,
            COUNT(*) AS open_total
       FROM jira_issue_cache c
      WHERE ${scope.clause}
        AND (c.status_category IS NULL OR c.status_category <> 'Done')
      GROUP BY c.current_tier`,
    scope.params,
  );

  // How many open tickets have a Resolution SLA AT ALL — paused or running.
  //
  // This is the honest denominator, and it needs the JSON: `sla_breach_time` is
  // extracted from the ongoing cycle only, so a paused SLA (waiting on
  // requestor, partner or development) has no breach time and would vanish from
  // any count based on the column. Using that as a denominator implied ~93% of
  // open tickets had no SLA, which is not a credible claim about this service
  // desk and was an artefact of the measure, not a finding.
  //
  // Best-effort: it parses JSON over the open population, so it degrades to null
  // rather than taking the breach numbers down with it.
  let withSlaField: number | null = null;
  try {
    const r = await query<{ cnt: number }>(
      `${DIRTY_READ}
       SELECT COUNT(*) AS cnt FROM jira_issue_cache c
        WHERE ${scope.clause}
          AND (c.status_category IS NULL OR c.status_category <> 'Done')
          AND c.fields_json IS NOT NULL
          AND ISJSON(c.fields_json) = 1
          AND JSON_QUERY(c.fields_json, '$.${RESOLUTION_SLA_FIELD}') IS NOT NULL`,
      scope.params,
    );
    withSlaField = r[0]?.cnt ?? null;
  } catch { /* the denominator is a caveat; the breach counts are the number */ }

  // `jira_issue_cache` is a CACHE, not the ledger. If the sync is behind, every
  // count above is an undercount — and an undercount presented as a total is the
  // same failure as a failed query presented as a zero. The freshness travels
  // with the number so the report can date it rather than assert it.
  //
  // Best-effort on purpose. It is a whole-table aggregate and therefore the
  // most expensive statement here, and losing the caveat is survivable in a way
  // that losing the breach numbers is not. A null coverage renders as "cache
  // freshness unknown — treat these as a floor", which is the honest reading.
  let coverage: BreachByQueueData['coverage'] = { cachedTickets: null, lastSync: null };
  try {
    const c = await query<{ cached: number; last_sync: string | null }>(
      `${DIRTY_READ}
       SELECT COUNT_BIG(*) AS cached, MAX(synced_at) AS last_sync FROM jira_issue_cache
        WHERE ${bare.clause}`,
      bare.params,
    );
    coverage = { cachedTickets: Number(c[0]?.cached ?? 0) || null, lastSync: c[0]?.last_sync ?? null };
  } catch { /* the caveat is optional; the numbers it qualifies are not */ }

  const total = rows.reduce((s, r) => s + r.breaches, 0);
  const withBreaches = rows.filter(r => r.breaches > 0).sort((a, b) => b.breaches - a.breaches);
  return {
    total,
    withLiveClock: rows.reduce((s, r) => s + r.live_clock, 0),
    withSlaField,
    // Open tickets, NOT the whole cache. `coverage.cachedTickets` counts every
    // cached NT row including resolved ones, and pairing an open-only numerator
    // with a total-including-Done denominator is how "7% of tickets have an
    // SLA" got said out loud in the first place.
    openTickets: rows.reduce((s, r) => s + r.open_total, 0),
    basis: 'Open tickets whose Resolution SLA (cf14048) is currently breached, '
      + 'grouped by the queue they are in NOW. Same field and definition as the '
      + 'wallboards. This is a stock, not a flow — it is NOT the Support Review\'s '
      + '"breaches by queue at time of breach", which no source in NOVA can produce.',
    byTier: withBreaches.map(r => ({
      tier: r.tier ?? 'Unassigned',
      breaches: r.breaches,
      sharePct: total ? Math.round((r.breaches / total) * 1000) / 10 : null,
    })),
    coverage,
  };
}

/**
 * Open tickets with nobody's name on them. The review's single most important
 * recommendation is a named case owner for every multi-team ticket; this is the
 * count that says whether that landed.
 */
async function unowned(projects: string[]): Promise<UnownedData> {
  const scope = projectScope(projects);
  const rows = await query<{ tier: string | null; count: number; oldest_days: number }>(
    `${DIRTY_READ}
     SELECT current_tier AS tier,
            COUNT(*) AS count,
            MAX(DATEDIFF(day, jira_created, GETUTCDATE())) AS oldest_days
       FROM jira_issue_cache
      WHERE ${scope.clause}
        AND (status_category IS NULL OR status_category <> 'Done')
        AND (assignee_display IS NULL OR assignee_display = '')
      GROUP BY current_tier
      ORDER BY count DESC`,
    scope.params,
  );
  const byTier = rows.map(r => ({ ...r, tier: r.tier ?? 'Unassigned' }));
  return { total: byTier.reduce((s, r) => s + r.count, 0), byTier };
}

/**
 * Open and not touched in STALE_DAYS. Measured from `jira_updated` rather than
 * `jira_created`: an old ticket being actively worked is a hard problem, an old
 * ticket nobody has touched in a fortnight is a forgotten one, and only the
 * second is a management failure.
 */
async function stalled(projects: string[]): Promise<StalledData> {
  const scope = projectScope(projects);
  const rows = await query<{ tier: string | null; count: number }>(
    `${DIRTY_READ}
     SELECT current_tier AS tier, COUNT(*) AS count
       FROM jira_issue_cache
      WHERE ${scope.clause}
        AND (status_category IS NULL OR status_category <> 'Done')
        AND jira_updated < DATEADD(day, ?, GETUTCDATE())
      GROUP BY current_tier
      ORDER BY count DESC`,
    [...scope.params, -STALE_DAYS],
  );

  const worst = await query<Omit<StalledData['worst'][number], 'tier'> & { tier: string | null }>(
    `${DIRTY_READ}
     SELECT TOP (?)
            issue_key,
            summary,
            current_tier AS tier,
            assignee_display AS assignee,
            DATEDIFF(day, jira_updated, GETUTCDATE()) AS days_untouched
       FROM jira_issue_cache
      WHERE ${scope.clause}
        AND (status_category IS NULL OR status_category <> 'Done')
        AND jira_updated < DATEADD(day, ?, GETUTCDATE())
      ORDER BY jira_updated ASC`,
    [TOP_N, ...scope.params, -STALE_DAYS],
  );

  const byTier = rows.map(r => ({ ...r, tier: r.tier ?? 'Unassigned' }));
  return {
    staleDays: STALE_DAYS,
    total: byTier.reduce((s, r) => s + r.count, 0),
    byTier,
    worst: worst.map(w => ({ ...w, tier: w.tier ?? 'Unassigned' })),
  };
}

/**
 * The whole flow picture in one pass.
 *
 * One window parameter across every signal is deliberate: five separately
 * defaulted calls is how a report ends up comparing a fortnight of handbacks
 * against a month of breaches and nobody notices for six weeks.
 */
export async function getFlowSignals(days = 30, projects = DEFAULT_PROJECTS): Promise<FlowSignals> {
  const window = Math.min(Math.max(days, 1), 365);
  const prior = window * 2;   // window start for the immediately preceding period

  // What the scope leaves out, counted rather than assumed. A filter nobody can
  // see is a filter nobody remembers, and "why doesn't this match the wallboard"
  // is a much easier question to answer when the answer is printed next to the
  // number. Best-effort: the scope note is not worth failing the run for.
  let excluded: FlowSignals['scope']['excluded'] = null;
  try {
    const rows = await query<{ project_key: string; cnt: number }>(
      `${DIRTY_READ}
       SELECT project_key, COUNT(*) AS cnt FROM jira_issue_cache
        WHERE project_key NOT IN (${projects.map(() => '?').join(', ')})
        GROUP BY project_key ORDER BY cnt DESC`,
      projects,
    );
    excluded = rows.map(r => ({ project: r.project_key, cachedTickets: r.cnt }));
  } catch { /* the note is optional; the numbers are not */ }

  // SEQUENTIAL, deliberately. The first cut fired all five concurrently and the
  // two heaviest — breachesByQueue and stalled — both died on the 30s request
  // timeout, while the cheap ones came back fine. `jira_issue_cache` is wide
  // (several NVARCHAR(MAX) columns) and the database is a DTU-limited Azure SQL
  // instance shared with live NOVA traffic, so eight parallel scans starve each
  // other and nothing finishes.
  //
  // Wall-clock does not matter here: this runs once a week to build one report.
  // Being slower and correct beats being parallel and absent — and an absent
  // section is a section the manager reading it cannot use.
  //
  // It also keeps the load off live NOVA, which is sharing these DTUs.
  const h = await signal(() => handbacks(window, prior, projects));
  const p = await signal(() => pingPong(window, projects));
  const b = await signal(() => breachesByQueue(projects));
  const u = await signal(() => unowned(projects));
  const s = await signal(() => stalled(projects));

  const named: Array<[string, Signal<unknown>]> = [
    ['handbacks', h], ['pingPong', p], ['breachesByQueue', b],
    ['unowned', u], ['stalled', s],
  ];

  return {
    build: FLOW_SIGNALS_BUILD,
    window: { days: window, from: new Date(Date.now() - window * 86_400_000).toISOString().slice(0, 10) },
    scope: { projects, excluded },
    handbacks: h,
    pingPong: p,
    breachesByQueue: b,
    unowned: u,
    stalled: s,
    // Named so a downstream renderer can list what did not answer without
    // knowing the shape of each signal.
    unavailable: named.filter(([, v]) => !v.ok).map(([name, v]) => ({ name, error: v.error })),
  };
}
