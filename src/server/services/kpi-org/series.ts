// Daily KPI history for one team — the series behind the weekly averages.
//
// `kpi-org-trend` answers "how did last week compare with the week before".
// That is the right shape for a compliance table and the wrong shape for
// noticing something turning: a week-average hides the day it started, and by
// the time a weekly bucket moves the thing it is describing is already on a
// wallboard. Early warning is a first derivative, and a first derivative needs
// the points.
//
// This is a READER. Every number comes out of `kpi_org_daily` exactly as the
// capture job froze it — nothing here recomputes, smooths, interpolates or
// fills. The detectors that consume it are in VANTAGE; this only has to hand
// them the series and tell them the truth about its holes.
//
// ── The holes are the product ───────────────────────────────────────────────
//
// `kpi_org_daily` is NOT uniformly populated, in two different ways that look
// identical if you only read `value`:
//
//  1. The historic reconstruction (`source = 'reconstruct'`, kpi-org/backfill.ts)
//     deliberately did NOT rebuild over-SLA / FRT-breach stocks or no-reply
//     counts — they need per-ticket SLA cycle parsing and Jira does not version
//     the no-reply fields. Those KPIs are blank before live capture began.
//  2. The 18:00 freeze runs once per UK day, every day including weekends. A
//     day with no row is therefore a day NOVA was down or restarting at the
//     wrong moment — a real hole, not a weekend.
//
// In both cases the day is ABSENT, and absent is not zero. A detector that
// reads a missing day as 0 sees new tickets collapse to nothing and backlog
// vanish overnight; it would fire on an outage and call it an improvement. So
// every series carries a `coverage` block, points are emitted only for days
// that actually hold a value, and the gaps are named.
//
// Reads only. The one statement here that is not a SELECT is `getTeamRange`'s
// inherited call to `ensureOrgKpiTable()` — idempotent `IF NOT EXISTS` DDL that
// every reader in `store.ts` already makes. Nothing in this file writes a value.

import { ORG_KPIS, getKpi, type Direction, type KpiUnit, type RagBands } from './registry.js';
import { getTeamRange, type OrgKpiDailyRow } from './store.js';

/**
 * Stamped into every response, for the same reason `flow-signals` carries one:
 * a stale `dist` on AAPP01 once returned a plausible response with new fields
 * quietly `undefined`, and a missing field is indistinguishable from a field
 * that is legitimately empty. A version is not.
 *
 * Bump on any change to the shape below, and bump the consumer to match.
 */
export const KPI_ORG_SERIES_BUILD = '2026-09-16-series-a';

/** Most days of history one request may ask for. */
export const MAX_DAYS = 400;
/** Gap days listed in full before the list is truncated (the count is always exact). */
export const MAX_GAP_DAYS_LISTED = 40;

/** One day that HAS a value. Days without one are never points — see `coverage`. */
export interface SeriesPoint {
  day: string;
  value: number;
  target: number | null;
  rag: 'green' | 'amber' | 'red' | null;
  /** 'jira' | 'manual' | 'escalation_log' (live capture) or 'reconstruct' (backfill). */
  source: string;
}

/**
 * What this series could and could not see.
 *
 * Read this before reading the points. A consumer that computes a slope without
 * checking `daysMissing` and `longestGapDays` is computing a slope across a
 * hole, and will report the hole as a change.
 */
export interface SeriesCoverage {
  /** Days in the requested window, inclusive. */
  expectedDays: number;
  /** Days with a row in the table at all. */
  daysPresent: number;
  /** Days with a row carrying a non-null value. This is `points.length`. */
  daysWithValue: number;
  /**
   * Days where a row exists but `value` is NULL. The capture ran and could not
   * answer — distinct from never having run, and worth separating because the
   * two have different fixes.
   */
  daysNull: number;
  /** Days in the window with no row at all. */
  daysMissing: number;
  firstValueDay: string | null;
  lastValueDay: string | null;
  /**
   * The longest run of consecutive valueless days BETWEEN the first and last
   * value. Leading and trailing absence is described by `firstValueDay`,
   * `lastValueDay` and `staleDays` instead — a KPI that only started being
   * captured last month has not got a 60-day gap, it has a shorter history.
   */
  longestGapDays: number;
  /** Valueless days inside the window, newest first. Exact count is `daysMissing + daysNull`. */
  gapDays: string[];
  gapDaysTruncated: boolean;
  /** Row counts by `source`, so reconstructed history is distinguishable from captured. */
  sources: Record<string, number>;
  /** Whole days between the last value and the end of the window. Null with no values at all. */
  staleDays: number | null;
}

export interface KpiSeries {
  key: string;
  label: string;
  group: string | null;
  unit: KpiUnit;
  direction: Direction;
  dailyTarget: number | null;
  monthlyTarget: number | null;
  rag: RagBands;
  /** True where inputs keep arriving after the day ends (CSAT), so recent points still move. */
  lateData: boolean;
  points: SeriesPoint[];
  coverage: SeriesCoverage;
}

export interface KpiOrgSeriesResult {
  build: string;
  generatedAt: string;
  team: string;
  window: { days: number; from: string; to: string };
  series: KpiSeries[];
  /**
   * Registry KPIs for this team with NO row in the window. Named rather than
   * omitted: a KPI that is silently missing from a list of KPIs reads as one
   * that is fine. Only populated when the caller did not name `keys` — a key
   * asked for by name always comes back as a series, empty if that is the truth.
   */
  absent: string[];
  /** Keys in the table that the registry does not know. A forgotten KPI, named. */
  unknownKeys: string[];
}

const DAY_MS = 86_400_000;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Every day in [from, to], inclusive. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Build one KPI's series and, more importantly, its coverage.
 *
 * `rows` may be empty — that is a legitimate and informative answer, not a
 * reason to skip the KPI.
 */
function buildSeries(key: string, rows: OrgKpiDailyRow[], from: string, to: string): KpiSeries {
  const meta = getKpi(key);
  // Callers only ever reach here for a registered key; the guard keeps the type
  // honest rather than describing a case that happens.
  if (!meta) throw new Error(`buildSeries called for unregistered KPI: ${key}`);

  const byDay = new Map(rows.map(r => [r.kpi_date, r]));
  const points: SeriesPoint[] = [];
  const sources: Record<string, number> = {};

  for (const row of rows) {
    sources[row.source] = (sources[row.source] || 0) + 1;
    if (row.value !== null && row.value !== undefined) {
      points.push({
        day: row.kpi_date,
        value: row.value,
        target: row.target,
        rag: row.rag,
        source: row.source,
      });
    }
  }
  points.sort((a, b) => a.day.localeCompare(b.day));

  const window = eachDay(from, to);
  const valued = new Set(points.map(p => p.day));
  const gapDays = window.filter(d => !valued.has(d));

  const firstValueDay = points[0]?.day ?? null;
  const lastValueDay = points[points.length - 1]?.day ?? null;

  // Interior gaps only. A KPI whose capture started three weeks ago has a short
  // history, not a 70-day hole, and calling that a gap would make every recently
  // added measure look broken.
  let longestGapDays = 0;
  if (firstValueDay && lastValueDay) {
    let run = 0;
    for (const d of eachDay(firstValueDay, lastValueDay)) {
      if (valued.has(d)) { run = 0; continue; }
      run += 1;
      if (run > longestGapDays) longestGapDays = run;
    }
  }

  const daysPresent = byDay.size;
  const daysWithValue = points.length;

  return {
    key: meta.key,
    label: meta.label,
    group: meta.colA ?? null,
    unit: meta.unit,
    direction: meta.direction,
    dailyTarget: meta.dailyTarget,
    monthlyTarget: meta.monthlyTarget,
    rag: meta.rag,
    lateData: Boolean(meta.lateData),
    points,
    coverage: {
      expectedDays: window.length,
      daysPresent,
      daysWithValue,
      daysNull: daysPresent - daysWithValue,
      daysMissing: window.length - daysPresent,
      firstValueDay,
      lastValueDay,
      longestGapDays,
      gapDays: gapDays.slice(-MAX_GAP_DAYS_LISTED).reverse(),
      gapDaysTruncated: gapDays.length > MAX_GAP_DAYS_LISTED,
      sources,
      staleDays: lastValueDay === null ? null : daysBetween(lastValueDay, to),
    },
  };
}

export interface KpiOrgSeriesOptions {
  days?: number;
  team?: string;
  /**
   * Specific KPI keys. A key named here ALWAYS comes back as a series, empty if
   * it has no data — a detector asking for `nt_oldest_development` must be told
   * "no history" rather than handed a list that quietly does not contain it.
   */
  keys?: string[];
  /** End of the window, for the replay harness. Defaults to today (UK). */
  to?: string;
}

/**
 * Daily KPI history for a team.
 *
 * The window ends TODAY by default and today is almost always incomplete — the
 * freeze runs at 18:00 UK — so the last point may be partial. That is not
 * hidden here: `source` and `captured_at` are the capture's own, and consumers
 * that care about a settled day should look at `staleDays` and ignore the
 * current day. The alternative, silently trimming today, would mean the series
 * disagreed with the wallboard for eight hours a day.
 */
export async function getKpiOrgSeries(opts: KpiOrgSeriesOptions = {}): Promise<KpiOrgSeriesResult> {
  const days = Math.min(Math.max(Math.floor(opts.days ?? 90), 2), MAX_DAYS);
  const team = opts.team || 'Support';
  const to = opts.to || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const from = addDays(to, -(days - 1));

  const rows = await getTeamRange(team, from, to);

  const byKpi = new Map<string, OrgKpiDailyRow[]>();
  const unknown = new Set<string>();
  for (const row of rows) {
    if (!getKpi(row.kpi_key)) { unknown.add(row.kpi_key); continue; }
    const list = byKpi.get(row.kpi_key);
    if (list) list.push(row); else byKpi.set(row.kpi_key, [row]);
  }

  const requested = opts.keys?.filter(Boolean) ?? null;
  const teamKpis = ORG_KPIS.filter(k => k.team === team);

  let keys: string[];
  let absent: string[] = [];
  if (requested?.length) {
    // Asked for by name: answered by name. An unregistered key is reported
    // rather than returned as an empty series, which would look like a real KPI
    // with no data.
    for (const k of requested) if (!getKpi(k)) unknown.add(k);
    keys = requested.filter(k => getKpi(k));
  } else {
    keys = [...byKpi.keys()].sort();
    absent = teamKpis.map(k => k.key).filter(k => !byKpi.has(k)).sort();
  }

  return {
    build: KPI_ORG_SERIES_BUILD,
    generatedAt: new Date().toISOString(),
    team,
    window: { days, from, to },
    series: keys.map(k => buildSeries(k, byKpi.get(k) ?? [], from, to)),
    absent,
    unknownKeys: [...unknown].sort(),
  };
}
