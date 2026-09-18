/**
 * Validate the health signals against the live database — WITHOUT deploying.
 *
 * NOVA has no local instance; it runs on BYM-AAPP01. That leaves two ways to
 * find out whether a dozen new SQL statements are correct: ship them to
 * production and watch, or run them on the box first. This is the second.
 *
 * It imports `getHealthSignals` — the exact function both the Health page and
 * the NEURO bridge call — so there is no second copy of the SQL to drift out of
 * step. A pass here IS a pass for `GET /api/neuro-bridge/health-signals` and for
 * `GET /api/admin/health/signals`.
 *
 * What it CANNOT prove: the route. Without a JobRegistry the jobs section is
 * expected to report unavailable here, and a pure function passing tells you
 * nothing about the impure one the API serves. Check the endpoint itself after
 * deploy, and check the build stamp on the response while you are there.
 *
 * Read-only. Every statement it can reach is a SELECT.
 *
 * Run on AAPP01, FROM THE REPO ROOT — it loads `.env` relative to the working
 * directory, the same file the server reads:
 *
 *     cd C:\Nurtur\NOVA
 *     npx tsx scripts/validate-health-signals.ts
 *     npx tsx scripts/validate-health-signals.ts --json
 *
 * Exit code 1 if a check could not be evaluated, or if a positive control is
 * unhealthy — NOT if a watched table is genuinely broken. Finding a real fault
 * is this script succeeding, and a deploy gate that trips on a true finding is a
 * gate that gets bypassed.
 */

import dotenv from 'dotenv';

import { closePool } from '../src/server/services/database.js';
import { getHealthSignals, HEALTH_SIGNALS_BUILD } from '../src/server/services/health-signals.js';

// The server loads its environment in index.ts, which this script deliberately
// does not import — the whole point is to reach the queries without standing up
// an Express app. So the .env has to be loaded here instead, or every check
// fails with "Database not configured" and the run proves nothing.
dotenv.config();

const asJson = process.argv.includes('--json');

const MARK: Record<string, string> = { ok: '✓', warn: '!', fail: '✗', unknown: '?' };

async function main(): Promise<number> {
  const health = await getHealthSignals(); // no registry — jobs section will report unavailable

  if (asJson) {
    console.log(JSON.stringify(health, null, 2));
  } else {
    console.log(`\nNOVA health signals — build ${HEALTH_SIGNALS_BUILD}`);
    // `controlsHealthy`, not `trustworthy`: the wider flag also counts the jobs
    // section, which cannot run here by design, so reading it would print an
    // alarm on every successful validation run.
    console.log(`Overall: ${health.overall.toUpperCase()}${health.controlsHealthy ? '' : '  [UNTRUSTWORTHY — a positive control is unhealthy]'}\n`);

    console.log('Tables');
    if (!health.tables.ok) {
      console.log(`  ✗ section FAILED — ${health.tables.error}`);
    } else {
      for (const t of health.tables.data ?? []) {
        const tag = t.control ? ' [control]' : t.unverified ? ' [unverified]' : '';
        console.log(`  ${MARK[t.severity]} ${t.table.padEnd(30)}${tag} ${t.verdict}`);
      }
    }

    console.log('\nColumns');
    if (!health.columns.ok) {
      console.log(`  ✗ section FAILED — ${health.columns.error}`);
    } else {
      for (const c of health.columns.data ?? []) {
        console.log(`  ${MARK[c.severity]} ${`${c.table}.${c.column}`.padEnd(40)} ${c.verdict}`);
      }
    }

    console.log('\nJobs');
    console.log(health.jobs.ok
      ? `  ${health.jobs.data?.jobs.length ?? 0} jobs reported`
      : `  – not evaluated here (${health.jobs.error}) — expected outside the server process`);
    console.log('');
  }

  // Only the checker's own integrity gates the exit code. A red table is a
  // finding, not a validation failure.
  const controlsBad = (health.tables.data ?? []).filter(t => t.control && t.severity !== 'ok');
  const sectionsDown = health.unavailable.filter(u => u.name !== 'jobs');

  if (!asJson) {
    for (const c of controlsBad) console.error(`CONTROL UNHEALTHY: ${c.table} — ${c.verdict}`);
    for (const s of sectionsDown) console.error(`SECTION UNAVAILABLE: ${s.name} — ${s.error}`);
  }
  return controlsBad.length || sectionsDown.length ? 1 : 0;
}

main()
  .then(async code => { await closePool(); process.exit(code); })
  .catch(async err => {
    console.error('Validation run failed outright:', err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
