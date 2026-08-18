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
    // Sequential, not Promise.all — same lesson as the signals themselves. The
    // pool is small and the sync is writing; three concurrent aggregates starve
    // each other.
    const [size, indexes] = [
      await query<{ rows: number }>(
        `SELECT SUM(row_count) AS rows FROM sys.dm_db_partition_stats
          WHERE object_id = OBJECT_ID('jira_issue_cache') AND index_id IN (0, 1)`,
      ),
      await query<{ name: string }>(
        `SELECT name FROM sys.indexes
          WHERE object_id = OBJECT_ID('jira_issue_cache') AND name IS NOT NULL`,
      ),
    ];

    const names = indexes.map(i => i.name);
    console.log(`jira_issue_cache: ${Number(size[0]?.rows ?? 0).toLocaleString()} rows, ${names.length} indexes`);

    // "How do I know the sync has caught up?" — answered here rather than left
    // to be inferred. The SLA columns backfill on the full sync that runs at
    // NOVA startup, so after a deploy this is the line that says whether the
    // breach signal can be trusted yet.
    const sync = await query<{ last_sync: string | null; breached: number; timed: number }>(
      // READ UNCOMMITTED for the same reason the signals use it: this aggregates
      // the whole cache while the 45s sync is writing to it, and without this the
      // preflight queues behind those writes and times out — the diagnostic
      // failing for exactly the reason it exists to diagnose.
      `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
       SELECT MAX(synced_at) AS last_sync,
              SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS breached,
              SUM(CASE WHEN sla_breach_time IS NOT NULL THEN 1 ELSE 0 END) AS timed
         FROM jira_issue_cache`,
    );
    const last = sync[0]?.last_sync ? new Date(sync[0].last_sync) : null;
    const ageMin = last ? Math.round((Date.now() - last.getTime()) / 60_000) : null;
    console.log(
      `last sync: ${last ? last.toLocaleString('en-GB') : 'never'}`
      + (ageMin === null ? '' : ` (${ageMin} min ago)`)
      + ` · sla_breached set on ${Number(sync[0]?.breached ?? 0).toLocaleString()} rows`
      + `, sla_breach_time on ${Number(sync[0]?.timed ?? 0).toLocaleString()}`,
    );
    if (!sync[0]?.breached && !sync[0]?.timed) {
      console.log(
        '\n  ℹ  The SLA columns are still empty. They backfill on the FULL sync\n'
        + '     that runs at NOVA startup, so deploy and give it a few minutes.\n'
        + '     The 45s incremental sync only touches tickets that changed, so it\n'
        + '     will not backfill the cache on its own.\n',
      );
    }

    if (!names.includes('IX_jira_cache_sla_breach')) {
      // Deliberately worded down from the original. The first version of this
      // warning blamed the timeout on the missing index, which was wrong: at
      // 5,602 rows nothing here is slow on volume. The query was BLOCKED behind
      // the Jira sync's writes on the clustered index, and READ UNCOMMITTED is
      // what fixed it. Leaving the alarming version in place would send the next
      // person down the same wrong path this one already cost three rounds on.
      console.log(
        '\n  ℹ  IX_jira_cache_sla_breach is not present yet.\n'
        + '     Not urgent — READ UNCOMMITTED is what stops breachesByQueue\n'
        + '     blocking behind the sync. The index only saves a clustered scan\n'
        + '     of a small table. It is created by initializeDatabase() on NOVA\n'
        + '     startup, so it appears after the next deploy.\n',
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
  if (!asJson) console.log(`\nvalidate-flow-signals — build 2026-08-18l\n`);
  if (!asJson) await preflight();
  const flow = await getFlowSignals(days);

  if (asJson) {
    console.log(JSON.stringify(flow, null, 2));
  } else {
    console.log(`\nFlow signals — last ${flow.window.days} days (from ${flow.window.from})`);
    console.log(`Scope: project ${flow.scope.projects.join(', ')}`
      + (flow.scope.excluded?.length
        ? ` — EXCLUDING ${flow.scope.excluded.map(e => `${e.project} (${e.cachedTickets})`).join(', ')}`
        : '')
      + '\n');

    console.log(line('handbacks', flow.handbacks, (d: { total: number; previous: number; changePct: number | null; routes: Array<{ from_tier: string; to_tier: string; count: number }>; unclassified: number }) =>
      `${d.total} returned to a lower tier (previous period ${d.previous}, change ${d.changePct === null ? 'n/a' : `${d.changePct}%`})`
      + (d.routes[0] ? `; top ${d.routes[0].from_tier} → ${d.routes[0].to_tier} ${d.routes[0].count}` : '')
      + (d.unclassified ? `; ${d.unclassified} moves off-ladder (Escalations/Production), direction not inferred` : '')));

    console.log(line('pingPong', flow.pingPong, (d: { ticketsAffected: number; threshold: number; worst: Array<{ ticket_key: string; moves: number; returns: number }> }) =>
      `${d.ticketsAffected} tickets crossed queues ${d.threshold}+ times`
      + (d.worst[0] ? `; worst ${d.worst[0].ticket_key} (${d.worst[0].moves} moves, ${d.worst[0].returns} returns)` : '')));

    console.log(line('breachesByQueue', flow.breachesByQueue, (d: { total: number; withLiveClock: number; withSlaField: number | null; openTickets: number; byTier: Array<{ tier: string; breaches: number; sharePct: number | null }>; coverage: { cachedTickets: number | null; lastSync: string | null } }) =>
      (d.withSlaField === 0
        // A green tick on a hollow zero is the exact failure this chain exists
        // to prevent. Zero tickets carrying a parseable SLA field is a broken
        // mapping, not a clean queue.
        ? 'NO SLA DATA — no open ticket carries a parseable cf14048; broken field mapping, not a clean month'
        : `${d.total} open tickets currently breached`
          + (d.byTier[0] ? `; top ${d.byTier[0].tier} ${d.byTier[0].breaches} (${d.byTier[0].sharePct}%)` : ''))
      + ` — ${d.withSlaField ?? '?'} of ${d.openTickets} OPEN tickets have a Resolution SLA`
      + ` (${d.withLiveClock} with a live clock; the rest paused or completed)`));

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
