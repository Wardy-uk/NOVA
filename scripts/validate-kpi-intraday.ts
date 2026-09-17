/**
 * Prove the intraday capture on the box, before anything depends on it.
 *
 * Same contract as `validate-kpi-org-series.ts`: it imports the functions the
 * job and the bridge route call, so a pass here IS a pass for them. No second
 * copy of the logic to drift.
 *
 * ⚠ IT DOES NOT CAPTURE. An earlier draft had a `--capture` flag and it could
 * not have worked: `captureIntraday` needs a live Jira client and this script
 * has no way to build one. A flag that looks like it takes a reading and cannot
 * is worse than no flag — it would be run, report nothing, and be read as "the
 * capture is broken". The `kpi-org-intraday` job holds the Jira client and is
 * the only thing that writes readings.
 *
 * The one write this DOES make is `ensureIntradayTable()` — idempotent DDL, so
 * the table exists before the first job tick and an empty read means "no
 * readings yet" rather than "no table". That is still a schema change to the
 * production database, which is why this belongs on AAPP01 rather than on
 * somebody's laptop.
 *
 *     cd C:\nurtur\nova
 *     npx tsx scripts/validate-kpi-intraday.ts
 *
 * Exit 1 if the read fails.
 */

import dotenv from 'dotenv';

import { closePool } from '../src/server/services/database.js';
import {
  getIntraday, ensureIntradayTable, KPI_INTRADAY_BUILD,
} from '../src/server/services/kpi-org/intraday.js';
import { TRACKER_ROWS } from '../src/server/routes/kpi-org.js';

dotenv.config();

/**
 * How many days of readings before a time-of-day baseline means anything.
 *
 * Ten weekdays — two working weeks — so every hour has been seen on every
 * weekday twice. Below that, "unusual for a Tuesday morning" rests on one or
 * two Tuesdays, and a claim like that is an anecdote wearing a statistic's
 * clothes. Stated here so the readiness answer is a rule rather than a feeling.
 */
const MIN_DAYS_FOR_BASELINE = 10;

async function main(): Promise<void> {
  console.log(`\nvalidate-kpi-intraday — build ${KPI_INTRADAY_BUILD}\n`);

  const keys = TRACKER_ROWS.map(r => r.kpiKey).filter((k): k is string => Boolean(k));
  console.log(`Tracker: ${TRACKER_ROWS.length} rows, ${keys.length} measurable`);
  const blank = TRACKER_ROWS.filter(r => !r.kpiKey).map(r => r.label);
  if (blank.length) {
    console.log(`  ${blank.length} row(s) have no KPI key and are NOT monitored:`);
    for (const b of blank) console.log(`    - ${b}`);
    console.log('  Named rather than dropped: the tracker has 34 rows, and a monitor');
    console.log('  watching 31 of them must not look like one watching all 34.\n');
  }

  await ensureIntradayTable();

  const data = await getIntraday(60, keys);
  console.log(`Stored readings: ${data.hoursCovered} distinct (day, hour) slots`
    + (data.from ? `, ${data.from} → ${data.to}` : ''));

  if (!data.series.length) {
    console.log('\n  No readings yet. That is the expected state until the job has run —');
    console.log('  it is a poll on a 10-minute tick and writes once per hour.\n');
    await closePool();
    process.exit(0);
  }

  const days = new Set<string>();
  for (const s of data.series) for (const p of s.points) days.add(p.day);
  const hours = new Set<number>();
  for (const s of data.series) for (const p of s.points) hours.add(p.hour);

  console.log(`  days covered : ${days.size}`);
  console.log(`  hours seen   : ${[...hours].sort((a, b) => a - b).join(', ')}`);
  console.log(`  KPIs with readings: ${data.series.length} of ${keys.length}`);

  const missing = keys.filter(k => !data.series.some(s => s.key === k));
  if (missing.length) {
    console.log(`  ⚠ ${missing.length} tracker KPI(s) have NO intraday readings: ${missing.join(', ')}`);
    console.log('    Manual KPIs are excluded by design — live.ts falls back to their last');
    console.log('    stored value, and recording that hourly would draw a flat line that');
    console.log('    looks measured. Anything else here is a gap worth chasing.');
  }

  console.log('');
  if (days.size >= MIN_DAYS_FOR_BASELINE) {
    console.log(`  ✓ ${days.size} days of readings — enough for a time-of-day baseline (bar: ${MIN_DAYS_FOR_BASELINE}).`);
  } else {
    console.log(`  … ${days.size} of ${MIN_DAYS_FOR_BASELINE} days needed before "unusual for this hour"`);
    console.log('    is a statement about evidence. Until then the tactical read can only');
    console.log('    compare against yesterday\'s close, and should say so.');
  }
  console.log('');

  await closePool();
  process.exit(0);
}

main().catch(async err => {
  console.error('\nValidation could not run:', err instanceof Error ? err.message : err);
  console.error('Run from the repo root so `.env` is found.\n');
  try { await closePool(); } catch { /* already down */ }
  process.exit(1);
});
