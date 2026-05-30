#!/usr/bin/env tsx
/**
 * KPI Recovery — Retroactive SLA backfill from jira_issue_cache → kpi_daily (P1-WP1)
 *
 * Design §8.3. For each historical date in the range, reconstructs SLA metrics
 * for a Jira space from the NOVA cache (jira_issue_cache + jira_comment_cache)
 * using the business-hours engine, and upserts kpi_daily. NOVA-only — no legacy
 * pool, no forbidden tables.
 *
 * Metrics backfilled per day (per space, space-level):
 *   resolved_today, frt_compliance, resolution_compliance,
 *   frt_avg_minutes, resolution_avg_minutes
 *
 * NOTE: depends on jira_issue_cache.resolved_at, which only populates for tickets
 * synced after the Phase 0 resolutiondate fix. Days before that fill in as the
 * sync re-fetches historical tickets. The script reports how many dates produced
 * data so coverage is transparent.
 *
 * Run: tsx scripts/kpi/backfill-cache-sla.ts [--space NT] [--from 2026-04-01] [--to 2026-05-29] [--dry-run]
 */
import 'dotenv/config';
import { initPool, query, execute, closePool } from '../../src/server/services/database.js';
import { ensureKpiSchema } from '../../src/server/services/kpi-engine/kpi-schema.js';
import { seedKpiFoundation } from '../../src/server/services/kpi-engine/kpi-seed.js';
import { KpiEngine } from '../../src/server/services/kpi-engine/kpi-engine.js';
import { calculateBusinessMinutes } from '../../src/server/services/kpi-engine/business-hours.js';
import type { SpaceConfig } from '../../src/server/services/kpi-engine/types.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DRY_RUN = process.argv.includes('--dry-run');
const SPACE_KEY = arg('space', 'NT')!;
const FROM = arg('from')!;
const TO = arg('to')!;

function tzDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}

function* dateRange(from: string, to: string): Generator<string> {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}

interface ResolvedRow { issue_key: string; jira_created: string | Date | null; resolved_at: string | Date | null; first_public: string | Date | null; }

async function upsert(spaceKey: string, metricKey: string, date: string, value: number, target: number | null): Promise<void> {
  if (DRY_RUN) return;
  await execute(
    `MERGE kpi_daily AS t
     USING (SELECT ? AS space_key, ? AS metric_key, ? AS report_date) AS s
     ON t.space_key = s.space_key AND t.metric_key = s.metric_key AND t.tier_name IS NULL AND t.report_date = s.report_date
     WHEN MATCHED THEN UPDATE SET value = ?, target_value = ?
     WHEN NOT MATCHED THEN INSERT (space_key, metric_key, tier_name, report_date, value, target_value)
       VALUES (?, ?, NULL, ?, ?, ?);`,
    [spaceKey, metricKey, date, value, target, spaceKey, metricKey, date, value, target],
  );
}

async function main(): Promise<void> {
  if (!FROM || !TO) {
    console.error('Usage: tsx scripts/kpi/backfill-cache-sla.ts --from YYYY-MM-DD --to YYYY-MM-DD [--space NT] [--dry-run]');
    process.exit(1);
  }
  console.log(`[backfill-sla] space=${SPACE_KEY} ${FROM}..${TO} ${DRY_RUN ? '(DRY RUN)' : ''}`);
  await initPool();
  await ensureKpiSchema();
  await seedKpiFoundation();

  const engine = new KpiEngine();
  const space: SpaceConfig | null = await engine.getSpaceConfig(SPACE_KEY);
  if (!space || !space.jiraProject) { console.error(`Space ${SPACE_KEY} not found or not a Jira space.`); process.exit(1); }

  const frtTarget = space.defaultFrtTargetMin;
  const resTarget = space.defaultResTargetMin;

  // Pull all resolved tickets in the window once, then bucket by tz date.
  const rows = await query<ResolvedRow>(
    `SELECT c.issue_key, c.jira_created, c.resolved_at, fc.first_public
     FROM jira_issue_cache c
     LEFT JOIN (SELECT issue_key, MIN(jira_created) AS first_public FROM jira_comment_cache WHERE is_public = 1 GROUP BY issue_key) fc
       ON fc.issue_key = c.issue_key
     WHERE c.project_key = ? AND c.resolved_at IS NOT NULL`,
    [space.jiraProject],
  );

  const byDate = new Map<string, ResolvedRow[]>();
  for (const r of rows) {
    const ra = r.resolved_at ? new Date(r.resolved_at) : null;
    if (!ra || isNaN(ra.getTime())) continue;
    const key = tzDateKey(ra, space.timezone);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(r);
  }

  let datesWithData = 0, datesEmpty = 0;
  for (const date of dateRange(FROM, TO)) {
    const dayRows = byDate.get(date) || [];
    if (dayRows.length === 0) { datesEmpty++; continue; }
    datesWithData++;

    const frtMins: number[] = [], resMins: number[] = [];
    let frtWithin = 0, frtTotal = 0, resWithin = 0, resTotal = 0;
    for (const r of dayRows) {
      const created = r.jira_created ? new Date(r.jira_created) : null;
      const resolved = r.resolved_at ? new Date(r.resolved_at) : null;
      const firstPublic = r.first_public ? new Date(r.first_public) : null;
      if (created && firstPublic) {
        const m = calculateBusinessMinutes(created, firstPublic, space);
        frtMins.push(m); frtTotal++; if (m <= frtTarget) frtWithin++;
      }
      if (created && resolved) {
        const m = calculateBusinessMinutes(created, resolved, space);
        resMins.push(m); resTotal++; if (m <= resTarget) resWithin++;
      }
    }
    const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 100);

    await upsert(SPACE_KEY, 'resolved_today', date, dayRows.length, null);
    await upsert(SPACE_KEY, 'frt_compliance', date, pct(frtWithin, frtTotal), 90);
    await upsert(SPACE_KEY, 'resolution_compliance', date, pct(resWithin, resTotal), 90);
    await upsert(SPACE_KEY, 'frt_avg_minutes', date, avg(frtMins), null);
    await upsert(SPACE_KEY, 'resolution_avg_minutes', date, avg(resMins), null);
  }

  console.log(`[backfill-sla] ${datesWithData} date(s) backfilled${DRY_RUN ? ' (dry-run)' : ''}, ${datesEmpty} date(s) had no resolved_at data in cache.`);
  await closePool();
  console.log('[backfill-sla] Done.');
}

main().catch((err) => {
  console.error('[backfill-sla] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
