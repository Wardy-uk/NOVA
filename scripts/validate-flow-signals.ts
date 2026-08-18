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
 * Run on AAPP01, from the repo root, with NOVA's own environment loaded:
 *
 *     npx tsx scripts/validate-flow-signals.ts
 *     npx tsx scripts/validate-flow-signals.ts --days 90 --json
 *
 * Exit code 1 if any signal failed, so it can gate a deploy.
 */

import { closePool } from '../src/server/services/database.js';
import { getFlowSignals, type Signal } from '../src/server/services/flow-signals.js';

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 30;
const asJson = args.includes('--json');

function line(label: string, sig: Signal<unknown>, describe: (d: never) => string): string {
  if (!sig.ok) return `  ✗ ${label.padEnd(20)} FAILED — ${sig.error}`;
  return `  ✓ ${label.padEnd(20)} ${describe(sig.data as never)}`;
}

async function main(): Promise<void> {
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

    console.log(line('breachesByQueue', flow.breachesByQueue, (d: { total: number; byTier: Array<{ tier: string; sharePct: number | null }>; coverage: { cachedTickets: number | null; lastSync: string | null } }) =>
      `${d.total} breaches`
      + (d.byTier[0] ? `; top ${d.byTier[0].tier} ${d.byTier[0].sharePct}%` : '')
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
  console.error('If this is a connection error, check NOVA_SQL_CONNECTION (or NOVA_SQL_SERVER/DATABASE/USER/PASSWORD) is in the environment.\n');
  await closePool().catch(() => {});
  process.exit(1);
});
