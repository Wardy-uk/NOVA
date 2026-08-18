/**
 * Validate the flow signals against the live database — WITHOUT deploying.
 *
 * NOVA has no local instance; it runs on BYM-AAPP01. That leaves two ways to
 * find out whether five new SQL statements are correct: ship them to production
 * and watch, or run them on the box first. This is the second.
 *
 * It imports `getFlowSignals` — the exact function the bridge route calls — so
 * there is no second copy of the SQL to drift out of step. A pass here IS a pass
 * for `GET /api/neuro-bridge/flow-signals`.
 *
 * Read-only. Every statement it can reach is a SELECT.
 *
 * Run on AAPP01, FROM THE REPO ROOT — it loads `.env` relative to the working
 * directory, the same file the server reads:
 *
 *     cd C:\nurtur\nova
 *     npx tsx scripts/validate-flow-signals.ts
 *     npx tsx scripts/validate-flow-signals.ts --days 90 --json
 *
 * Exit code 1 if any signal failed, so it can gate a deploy.
 */

import dotenv from 'dotenv';

import { closePool, query } from '../src/server/services/database.js';
import { getFlowSignals, type Signal } from '../src/server/services/flow-signals.js';

// The server loads its environment in index.ts, which this script deliberately
// does not import — the whole point is to reach the queries without standing up
// an Express app. So the .env has to be loaded here instead, or every signal
// fails with "Database not configured" and the run proves nothing.
//
// Safe at import time because `database.ts` reads the connection settings
// lazily, inside buildConfig() on first connect, rather than at module load.
// Resolves against the working directory, so run this from the repo root.
dotenv.config();

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 30;
const asJson = args.includes('--json');

function line(label: string, sig: Signal<unknown>, describe: (d: never) => string): string {
  if (!sig.ok) return `  ✗ ${label.padEnd(20)} FAILED — ${sig.error}`;
  return `  ✓ ${label.padEnd(20)} ${describe(sig.data as never)}`;
}

/**
 * Preflight: the conditions a timeout is almost always caused by.
 *
 * A bare "Request failed to complete in 30000ms" tells you a query was slow and
 * nothing about why, which sent us round the loop twice. These two facts —
 * how big the table is and whether the index the query needs exists — turn that
 * into an instruction.
 *
 * Row count comes from `sys.dm_db_partition_stats` rather than COUNT(*), because
 * a diagnostic that has to scan the table to tell you the table is too big to
 * scan is not a diagnostic.
 */
async function preflight(): Promise<void> {
  try {
    const [size, indexes] = await Promise.all([
      query<{ rows: number }>(
        `SELECT SUM(row_count) AS rows FROM sys.dm_db_partition_stats
          WHERE object_id = OBJECT_ID('jira_issue_cache') AND index_id IN (0, 1)`,
      ),
      query<{ name: string }>(
        `SELECT name FROM sys.indexes
          WHERE object_id = OBJECT_ID('jira_issue_cache') AND name IS NOT NULL`,
      ),
    ]);

    const names = indexes.map(i => i.name);
    console.log(`jira_issue_cache: ${Number(size[0]?.rows ?? 0).toLocaleString()} rows, ${names.length} indexes`);

    if (!names.includes('IX_jira_cache_sla_breach')) {
      console.log(
        '\n  ⚠  IX_jira_cache_sla_breach is MISSING.\n'
        + '     breachesByQueue will scan the whole table and time out at 30s.\n'
        + '     It is created by initializeDatabase() on NOVA startup — deploy and\n'
        + '     restart the site, then re-run this. Running the validator alone\n'
        + '     never creates it.\n',
      );
    }
  } catch (err) {
    // Says so, loudly. The first cut swallowed this, and a preflight that can
    // fail invisibly is indistinguishable from a preflight that never ran —
    // which cost a round trip on the box working out which had happened. The
    // whole point of this chain is that silence never reads as success.
    console.log(`  ⚠  Preflight could not run: ${err instanceof Error ? err.message : err}\n`);
  }
}

async function main(): Promise<void> {
  // Stamped so it is obvious at a glance whether the box is running the version
  // you just pushed. Two runs were spent working out that it was not.
  if (!asJson) console.log(`\nvalidate-flow-signals — build 2026-08-18d\n`);
  if (!asJson) await preflight();
  const flow = await getFlowSignals(days);

  if (asJson) {
    console.log(JSON.stringify(flow, null, 2));
  } else {
    console.log(`\nFlow signals — last ${flow.window.days} days (from ${flow.window.from})\n`);

    console.log(line('handbacks', flow.handbacks, (d: { total: number; previous: number; changePct: number | null; routes: unknown[] }) =>
      `${d.total} returned between tiers (previous period ${d.previous}, change ${d.changePct === null ? 'n/a' : `${d.changePct}%`}), ${d.routes.length} routes`));

    console.log(line('pingPong', flow.pingPong, (d: { ticketsAffected: number; threshold: number; worst: Array<{ ticket_key: string; moves: number; returns: number }> }) =>
      `${d.ticketsAffected} tickets crossed queues ${d.threshold}+ times`
      + (d.worst[0] ? `; worst ${d.worst[0].ticket_key} (${d.worst[0].moves} moves, ${d.worst[0].returns} returns)` : '')));

    console.log(line('breachesByQueue', flow.breachesByQueue, (d: { total: number; everBreached: number | null; byTier: Array<{ tier: string; sharePct: number | null }>; coverage: { cachedTickets: number | null; lastSync: string | null } }) =>
      (d.everBreached === 0
        // A green tick on a hollow zero is the exact failure this chain exists
        // to prevent. If nothing in the table is flagged breached, the pipeline
        // is not writing the flag — say that, do not report a quiet month.
        ? 'NO BREACH DATA — sla_breached is not set on ANY row; this is an unpopulated field, not a clean month'
        : `${d.total} breaches`
          + (d.byTier[0] ? `; top ${d.byTier[0].tier} ${d.byTier[0].sharePct}%` : ''))
      + ` — cache ${d.coverage.cachedTickets ?? '?'} tickets, synced ${String(d.coverage.lastSync ?? 'unknown').slice(0, 19)}`));

    console.log(line('unowned', flow.unowned, (d: { total: number; byTier: Array<{ tier: string; count: number; oldest_days: number }> }) =>
      `${d.total} open with no assignee`
      + (d.byTier[0] ? `; worst ${d.byTier[0].tier} ${d.byTier[0].count} (oldest ${d.byTier[0].oldest_days}d)` : '')));

    console.log(line('stalled', flow.stalled, (d: { total: number; staleDays: number; worst: Array<{ issue_key: string; days_untouched: number }> }) =>
      `${d.total} untouched ${d.staleDays}+ days`
      + (d.worst[0] ? `; worst ${d.worst[0].issue_key} (${d.worst[0].days_untouched}d)` : '')));

    // A signal returning zero is not the same as a signal that could not run,
    // and the whole point of this script is to tell them apart before the number
    // reaches a report going to Nick's manager.
    console.log(flow.unavailable.length
      ? `\n${flow.unavailable.length} signal(s) FAILED — these would render as "absent" in the weekly report, not as zero.\n`
      : '\nAll five signals answered.\n');
  }

  await closePool();
  process.exit(flow.unavailable.length ? 1 : 0);
}

main().catch(async err => {
  console.error('\nValidation could not run:', err instanceof Error ? err.message : err);
  console.error('If this is a connection error, check you are running from the repo root so `.env` is found, and that it carries NOVA_SQL_CONNECTION (or NOVA_SQL_SERVER/DATABASE/USER/PASSWORD).\n');
  await closePool().catch(() => {});
  process.exit(1);
});
