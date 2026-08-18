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

export interface Signal<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

export interface HandbackData {
  total: number;
  previous: number;
  changePct: number | null;
  routes: Array<{ from_tier: string; to_tier: string; count: number }>;
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
   * Rows carrying `sla_breached = 1` anywhere in the table, ignoring the window.
   * Zero here means the flag is not populated, which is a different statement
   * from a month with no breaches — and must never render as the same sentence.
   */
  everBreached: number | null;
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
  window: { days: number; from: string };
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
async function handbacks(days: number, prior: number): Promise<HandbackData> {
  const [routes, totals] = await Promise.all([
    query<{ from_tier: string; to_tier: string; count: number }>(
      `SELECT ISNULL(from_tier, 'Unknown') AS from_tier,
              ISNULL(to_tier, 'Unknown')   AS to_tier,
              COUNT(*) AS count
         FROM escalation_log
        WHERE escalation_type = 'rejection'
          AND created_at >= DATEADD(day, ?, GETUTCDATE())
        GROUP BY from_tier, to_tier
        ORDER BY count DESC`,
      [-days],
    ),
    query<{ window: string; count: number }>(
      `SELECT 'current' AS [window], COUNT(*) AS count
         FROM escalation_log
        WHERE escalation_type = 'rejection'
          AND created_at >= DATEADD(day, ?, GETUTCDATE())
       UNION ALL
       SELECT 'previous', COUNT(*)
         FROM escalation_log
        WHERE escalation_type = 'rejection'
          AND created_at >= DATEADD(day, ?, GETUTCDATE())
          AND created_at <  DATEADD(day, ?, GETUTCDATE())`,
      [-days, -prior, -days],
    ),
  ]);

  const current = totals.find(t => t.window === 'current')?.count ?? 0;
  const previous = totals.find(t => t.window === 'previous')?.count ?? 0;
  return { total: current, previous, changePct: delta(current, previous), routes };
}

/**
 * Tickets crossing queues repeatedly. Counted from the log rather than from the
 * live risk-scorer so the figure is reproducible after the fact — a number in a
 * report to a manager has to still be true when he checks it on Thursday.
 */
async function pingPong(days: number): Promise<PingPongData> {
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
        GROUP BY e.ticket_key
       HAVING COUNT(*) >= ?
        ORDER BY COUNT(*) DESC, SUM(CASE WHEN e.escalation_type = 'rejection' THEN 1 ELSE 0 END) DESC`,
      [TOP_N, -days, PING_PONG_THRESHOLD],
    ),
    query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT ticket_key
           FROM escalation_log
          WHERE created_at >= DATEADD(day, ?, GETUTCDATE())
          GROUP BY ticket_key
         HAVING COUNT(*) >= ?
       ) t`,
      [-days, PING_PONG_THRESHOLD],
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
async function breachesByQueue(days: number): Promise<BreachByQueueData> {
  const rows = await query<{ tier: string | null; breaches: number }>(
    `${DIRTY_READ}
     SELECT current_tier AS tier, COUNT(*) AS breaches
       FROM jira_issue_cache
      WHERE sla_breached = 1
        AND sla_breach_time >= DATEADD(day, ?, GETUTCDATE())
      GROUP BY current_tier
      ORDER BY breaches DESC`,
    [-days],
  );

  // Is the flag populated AT ALL? Without this, a `sla_breached` column that is
  // never written reports "0 breaches" — a green tick on a number that means
  // nothing, in the one section of the report whose headline finding is that
  // 90.5% of breaches happen in one queue.
  //
  // Zero breaches in the window is a claim about a good month. Zero breached
  // rows in the entire table is a claim about the pipeline, and the two must not
  // render as the same sentence.
  const ever = await query<{ cnt: number }>(
    `${DIRTY_READ}
     SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE sla_breached = 1`,
  );

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
       SELECT COUNT_BIG(*) AS cached, MAX(synced_at) AS last_sync FROM jira_issue_cache`,
    );
    coverage = { cachedTickets: Number(c[0]?.cached ?? 0) || null, lastSync: c[0]?.last_sync ?? null };
  } catch { /* the caveat is optional; the numbers it qualifies are not */ }

  const total = rows.reduce((s, r) => s + r.breaches, 0);
  return {
    total,
    everBreached: ever[0]?.cnt ?? null,
    byTier: rows.map(r => ({
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
async function unowned(): Promise<UnownedData> {
  const rows = await query<{ tier: string | null; count: number; oldest_days: number }>(
    `${DIRTY_READ}
     SELECT current_tier AS tier,
            COUNT(*) AS count,
            MAX(DATEDIFF(day, jira_created, GETUTCDATE())) AS oldest_days
       FROM jira_issue_cache
      WHERE (status_category IS NULL OR status_category <> 'Done')
        AND (assignee_display IS NULL OR assignee_display = '')
      GROUP BY current_tier
      ORDER BY count DESC`,
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
async function stalled(): Promise<StalledData> {
  const rows = await query<{ tier: string | null; count: number }>(
    `${DIRTY_READ}
     SELECT current_tier AS tier, COUNT(*) AS count
       FROM jira_issue_cache
      WHERE (status_category IS NULL OR status_category <> 'Done')
        AND jira_updated < DATEADD(day, ?, GETUTCDATE())
      GROUP BY current_tier
      ORDER BY count DESC`,
    [-STALE_DAYS],
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
      WHERE (status_category IS NULL OR status_category <> 'Done')
        AND jira_updated < DATEADD(day, ?, GETUTCDATE())
      ORDER BY jira_updated ASC`,
    [TOP_N, -STALE_DAYS],
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
export async function getFlowSignals(days = 30): Promise<FlowSignals> {
  const window = Math.min(Math.max(days, 1), 365);
  const prior = window * 2;   // window start for the immediately preceding period

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
  const h = await signal(() => handbacks(window, prior));
  const p = await signal(() => pingPong(window));
  const b = await signal(() => breachesByQueue(window));
  const u = await signal(() => unowned());
  const s = await signal(() => stalled());

  const named: Array<[string, Signal<unknown>]> = [
    ['handbacks', h], ['pingPong', p], ['breachesByQueue', b],
    ['unowned', u], ['stalled', s],
  ];

  return {
    window: { days: window, from: new Date(Date.now() - window * 86_400_000).toISOString().slice(0, 10) },
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
