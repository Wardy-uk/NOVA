// Hourly intraday KPI readings — the history nobody was keeping.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// `kpi_org_daily` stores ONE row per KPI per day: the 18:00 freeze. That is the
// right shape for "how did yesterday go" and it cannot answer the question Nick
// actually needs answered during the day — *is this slipping right now, and is
// it slipping faster than it normally would by this hour?*
//
// `getSupportLiveSnapshot()` already computes the current value of every
// Support KPI on demand (60s cache), and the wallboard and the tracker export
// both use it to overlay today's column. But nothing has ever KEPT those
// readings, so there has never been anything to compare a mid-morning number
// against. "41 incidents at 11am" is only alarming if you know it is normally
// 26 at 11am, and that fact did not exist anywhere in the estate.
//
// This stores it. One row per (day, hour, kpi). Nothing is computed here that
// is not already computed for the wallboard — this is a recorder, not a second
// measurement, and it must stay that way or the intraday numbers and the board
// will drift apart and disagree in front of the team.
//
// ── What it is NOT for ──────────────────────────────────────────────────────
//
// It is not a replacement for the 18:00 freeze and must never be read as one.
// The freeze is the reported figure; these are readings on the way to it. A
// consumer that averaged intraday rows into a "daily value" would produce a
// number that matches no report anybody has ever sent.
//
// ── Absence ─────────────────────────────────────────────────────────────────
//
// A missing hour is ABSENT, never zero. NOVA restarts, Jira rate-limits, and
// the job is a poll rather than a schedule — so gaps are normal and a reader
// has to be able to see them. Rows are only written for KPIs that returned a
// value; a KPI the live compute could not answer is left out of that hour
// rather than stored as null, and `capturedKpis` records how many answered so a
// thin hour is visible as thin.
//
// Strictly additive: nothing here updates or deletes.

import type { JiraRestClient } from '../jira-client.js';
import { query, execute } from '../database.js';
import { getSupportLiveSnapshot } from './live.js';

/** Bump when the stored shape changes. Read by the bridge route. */
export const KPI_INTRADAY_BUILD = '2026-09-17-intraday-a';

/** Readings older than this are pruned. A year of hours is ample for a
 *  time-of-day baseline and keeps the table small enough to stay boring. */
const RETAIN_DAYS = 400;

let ensured = false;

/** Idempotent. Safe on every boot, same pattern as `ensureOrgKpiTable`. */
export async function ensureIntradayTable(): Promise<void> {
  if (ensured) return;
  await execute(
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_org_intraday') AND type = 'U')
     CREATE TABLE kpi_org_intraday (
       kpi_date    DATE          NOT NULL,
       hour_uk     TINYINT       NOT NULL,
       team_key    NVARCHAR(50)  NOT NULL,
       kpi_key     NVARCHAR(80)  NOT NULL,
       value       FLOAT         NOT NULL,
       captured_at DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT PK_kpi_org_intraday PRIMARY KEY (kpi_date, hour_uk, team_key, kpi_key)
     );`,
  );
  ensured = true;
}

const ukParts = (d: Date) => ({
  day: d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }),
  hour: parseInt(d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10),
});

export interface CaptureResult {
  day: string;
  hour: number;
  /** KPIs that returned a value and were stored. */
  capturedKpis: number;
  /** KPIs the live compute could not answer. Named rather than silently absent. */
  skipped: string[];
  /** False when this hour was already recorded — the job polls, so this is normal. */
  wrote: boolean;
}

/**
 * Record the current reading for every Support KPI that answered.
 *
 * ONE ROW PER HOUR, keyed on (date, hour). The job is a poll on a short
 * interval — the same first-tick-at-or-after pattern the 18:00 freeze uses, so
 * a missed or slow tick does not lose the hour — and the primary key is what
 * makes running it five times in an hour harmless.
 *
 * Manual KPIs are EXCLUDED. `live.ts` falls back to their last stored value
 * when it cannot compute them, so recording them hourly would write the same
 * stale number into every hour and manufacture a flat line that looks like a
 * measured one.
 */
export async function captureIntraday(jira: JiraRestClient, now = new Date()): Promise<CaptureResult> {
  await ensureIntradayTable();
  const { day, hour } = ukParts(now);

  const existing = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM kpi_org_intraday WHERE kpi_date = ? AND hour_uk = ? AND team_key = ?`,
    [day, hour, 'Support'],
  );
  if (Number(existing[0]?.n ?? 0) > 0) {
    return { day, hour, capturedKpis: 0, skipped: [], wrote: false };
  }

  const snap = await getSupportLiveSnapshot(jira);
  const skipped: string[] = [];
  let stored = 0;

  for (const item of snap.items) {
    if (item.manual) { skipped.push(item.key); continue; }
    if (item.value === null || item.value === undefined || !Number.isFinite(item.value)) {
      skipped.push(item.key);
      continue;
    }
    try {
      await execute(
        `INSERT INTO kpi_org_intraday (kpi_date, hour_uk, team_key, kpi_key, value)
         VALUES (?, ?, ?, ?, ?)`,
        [day, hour, 'Support', item.key, item.value],
      );
      stored += 1;
    } catch {
      // A duplicate key means a concurrent tick won the race, which is fine and
      // is the reason for the key. Anything else costs this KPI's hour, not the
      // whole capture.
      skipped.push(item.key);
    }
  }

  return { day, hour, capturedKpis: stored, skipped, wrote: stored > 0 };
}

/** Drop readings past the retention horizon. Cheap, and keeps the table boring. */
export async function pruneIntraday(): Promise<number> {
  await ensureIntradayTable();
  const res = await execute(
    `DELETE FROM kpi_org_intraday WHERE kpi_date < DATEADD(day, ?, CAST(GETDATE() AS DATE))`,
    [-RETAIN_DAYS],
  );
  return res.rowsAffected ?? 0;
}

export interface IntradayPoint { day: string; hour: number; value: number }
export interface IntradaySeries {
  key: string;
  points: IntradayPoint[];
  /** Distinct (day, hour) pairs this KPI actually has. The denominator for any
   *  time-of-day claim, and the thing that says a baseline is too thin. */
  readings: number;
  firstDay: string | null;
  lastDay: string | null;
}

/**
 * Intraday readings for the last `days` days.
 *
 * Returns what is there and says how much that is. A caller computing "normal
 * for this hour" must check `readings` first — four Tuesdays is a baseline,
 * one is an anecdote, and nothing in the shape of the data makes that obvious
 * on its own.
 */
export async function getIntraday(days = 28, keys?: string[]): Promise<{
  build: string;
  from: string;
  to: string;
  hoursCovered: number;
  series: IntradaySeries[];
}> {
  await ensureIntradayTable();
  const rows = await query<{ kpi_date: string; hour_uk: number; kpi_key: string; value: number }>(
    `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, hour_uk, kpi_key, value
       FROM kpi_org_intraday
      WHERE team_key = 'Support' AND kpi_date >= DATEADD(day, ?, CAST(GETDATE() AS DATE))
      ORDER BY kpi_key, kpi_date, hour_uk`,
    [-days],
  );

  const wanted = keys?.length ? new Set(keys) : null;
  const byKey = new Map<string, IntradayPoint[]>();
  const hourSet = new Set<string>();
  for (const r of rows) {
    if (wanted && !wanted.has(r.kpi_key)) continue;
    hourSet.add(`${r.kpi_date}T${r.hour_uk}`);
    const list = byKey.get(r.kpi_key);
    const p = { day: r.kpi_date, hour: r.hour_uk, value: r.value };
    if (list) list.push(p); else byKey.set(r.kpi_key, [p]);
  }

  const all = [...byKey.keys()].sort();
  return {
    build: KPI_INTRADAY_BUILD,
    from: rows[0]?.kpi_date ?? '',
    to: rows[rows.length - 1]?.kpi_date ?? '',
    hoursCovered: hourSet.size,
    series: all.map(key => {
      const points = byKey.get(key)!;
      return {
        key,
        points,
        readings: points.length,
        firstDay: points[0]?.day ?? null,
        lastDay: points[points.length - 1]?.day ?? null,
      };
    }),
  };
}
