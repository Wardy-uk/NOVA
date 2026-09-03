/**
 * Validate the people signals against the live database — WITHOUT deploying.
 *
 * NOVA has no local instance; it runs on BYM-AAPP01. That leaves two ways to
 * find out whether a set of new SQL statements is correct: ship them to
 * production and watch, or run them on the box first. This is the second.
 *
 * It imports `getPeopleSignals` — the exact function the bridge route calls — so
 * there is no second copy of the SQL to drift out of step. A pass here IS a pass
 * for `GET /api/neuro-bridge/people-signals`.
 *
 * Read-only. Every statement it can reach is a SELECT.
 *
 * Run on AAPP01, FROM THE REPO ROOT — it loads `.env` relative to the working
 * directory, the same file the server reads:
 *
 *     cd C:\Nurtur\NOVA
 *     npx tsx scripts/validate-people-signals.ts
 *     npx tsx scripts/validate-people-signals.ts --days 90 --day 2026-09-02 --json
 *
 * Exit code 1 if any signal failed, so it can gate a deploy.
 */

import dotenv from 'dotenv';

import { FileSettingsQueries } from '../src/server/db/settings-store.js';
import { closePool } from '../src/server/services/database.js';
import {
  getPeopleSignals,
  PEOPLE_SIGNALS_BUILD,
  type PeopleSignals,
  type Signal,
} from '../src/server/services/people-signals.js';

// The server loads its environment in index.ts, which this script deliberately
// does not import — the whole point is to reach the queries without standing up
// an Express app. So the .env has to be loaded here instead, or every signal
// fails with "Database not configured" and the run proves nothing.
//
// Safe at import time because `database.ts` reads its connection settings lazily
// on first connect. It matters MORE here than it did for flow-signals: the
// roster comes from the KPI pool, whose credentials live in settings.json, which
// FileSettingsQueries resolves against DATA_DIR — set in .env, and on production
// pointing at C:\ProgramData\NOVA rather than the repo.
dotenv.config();

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 30;
const dayArg = args.includes('--day') ? args[args.indexOf('--day') + 1] : undefined;
const asJson = args.includes('--json');

function line(label: string, sig: Signal<unknown>, describe: (d: never) => string): string {
  if (!sig.ok) return `  ✗ ${label.padEnd(14)} FAILED — ${sig.error}`;
  return `  ✓ ${label.padEnd(14)} ${describe(sig.data as never)}`;
}

/**
 * Preflight: the two things that make this endpoint return a plausible lie.
 *
 * A roster that cannot be read fails loudly and is therefore not the danger. The
 * danger is a roster that reads fine while the KPI capture has not run for a
 * week, because every person then comes back `no-capture` — correct, honest, and
 * easy to mistake for "the team did nothing". Saying so up front turns a
 * confusing result into an instruction.
 */
function preflight(settings: FileSettingsQueries): boolean {
  const missing = ['kpi_sql_server', 'kpi_sql_database', 'kpi_sql_user', 'kpi_sql_password']
    .filter(k => !settings.get(k));
  if (missing.length) {
    console.log(
      `  ⚠  KPI SQL settings missing: ${missing.join(', ')}\n`
      + `     Read from ${process.env.DATA_DIR ?? process.cwd()}\\settings.json.\n`
      + '     On production DATA_DIR is C:\\ProgramData\\NOVA — if that is not what is\n'
      + '     printed above, .env was not found and you are running from the wrong\n'
      + '     directory. The roster (and with it every signal) will fail.\n',
    );
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const settings = new FileSettingsQueries();

  // Stamped so it is obvious at a glance whether the box is running the version
  // you just pushed. Two runs were spent on that with flow-signals.
  if (!asJson) {
    console.log(`\nvalidate-people-signals — service build ${PEOPLE_SIGNALS_BUILD}\n`);
    preflight(settings);
  }

  const p: PeopleSignals = await getPeopleSignals(settings, days, dayArg);

  if (asJson) {
    console.log(JSON.stringify(p, null, 2));
  } else {
    console.log(`People signals — standups/escalations over the last ${p.window.days} days (from ${p.window.from})\n`);

    console.log(line('roster', p.roster, (d: {
      people: Array<{ name: string; tierCode: string | null; availableForAssignment: boolean }>;
      scope: { departments: string[] };
      measuredButNotOnRoster: Array<{ name: string | null }> | null;
    }) => {
      const off = d.measuredButNotOnRoster;
      return `${d.people.length} active in ${d.scope.departments.join('/')}`
        + ` (${d.people.filter(x => x.availableForAssignment).length} available for assignment)`
        + (off === null
          // Not checked is not the same as agrees, and saying so is the whole
          // point of the null.
          ? `\n${' '.repeat(19)}? roster/capture agreement NOT CHECKED — the capture could not be read`
          : off.length
            // Not a warning about this script — a finding. Someone in the day's
            // totals who is not in the population every percentage divides by.
            ? `\n${' '.repeat(19)}⚠ ${off.length} measured but NOT on the roster: `
              + off.map(x => x.name ?? '(unnamed)').join(', ')
            : '');
    }));

    console.log(line('performance', p.performance, (d: {
      asOf: { day: string | null; ageDays: number | null };
      people: Array<{ state: string; quality: { qaScored: number | null }; sla: { compliancePct: number | null } }>;
      notCaptured: number;
      slaCoverage: { withValue: number; ofPeople: number };
    }) => {
      const measured = d.people.filter(x => x.state === 'measured').length;
      const qaScored = d.people.filter(x => (x.quality.qaScored ?? 0) > 0).length;
      return `capture ${d.asOf.day ?? 'NONE'}`
        + (d.asOf.ageDays === null ? '' : ` (${d.asOf.ageDays}d old)`)
        + ` — ${measured} measured, ${d.notCaptured} with no row`
        + `\n${' '.repeat(19)}${qaScored} scored any QA that day; `
        + `SLA compliance readable for ${d.slaCoverage.withValue}/${d.slaCoverage.ofPeople}`;
    }));

    console.log(line('standups', p.standups, (d: {
      sessionsInWindow: number;
      sessionsEvidenced: number;
      perPerson: Array<{ name: string; submitted: number; missed: number | null }>;
      unmatchedSubmitters: Array<{ name: string; submissions: number }>;
    }) =>
      (d.sessionsEvidenced === 0
        // A green tick on "everyone missed every standup" is the exact failure
        // this chain exists to prevent. No evidenced session is a fact about the
        // standup, not about the team — and session ROWS are auto-created, so a
        // non-zero row count here still proves nothing ran.
        ? `NO EVIDENCED SESSIONS in the window (${d.sessionsInWindow} session rows, all with zero `
          + 'submissions) — coverage is undefined, not 0%'
        : `${d.sessionsEvidenced} evidenced of ${d.sessionsInWindow} session rows; `
          + `${d.perPerson.filter(x => x.submitted > 0).length}/${d.perPerson.length} people submitted at least once`
          + `, worst gap ${Math.max(0, ...d.perPerson.map(x => x.missed ?? 0))} missed`)
      + (d.unmatchedSubmitters.length
        ? `\n${' '.repeat(19)}⚠ ${d.unmatchedSubmitters.length} submitter name(s) matched nobody: `
          + d.unmatchedSubmitters.map(x => `"${x.name}" (${x.submissions})`).join(', ')
        : '')));

    console.log(line('escalations', p.escalations, (d: {
      perPerson: Array<{ name: string; raised: number; rejections: number; total: number }>;
      unmatchedActors: Array<{ name: string; events: number }>;
    }) => {
      const top = [...d.perPerson].sort((a, b) => b.total - a.total)[0];
      return `${d.perPerson.reduce((s, x) => s + x.total, 0)} events attributed`
        + (top && top.total ? `; most ${top.name} (${top.raised} raised, ${top.rejections} rejections)` : '')
        + (d.unmatchedActors.length
          ? `\n${' '.repeat(19)}${d.unmatchedActors.length} actor name(s) off-roster (bots, leavers, other teams): `
            + d.unmatchedActors.slice(0, 5).map(x => `${x.name} (${x.events})`).join(', ')
          : '');
    }));

    // A signal returning zero is not the same as a signal that could not run,
    // and the whole point of this script is to tell them apart before the number
    // reaches a report that informs a performance conversation.
    console.log(p.unavailable.length
      ? `\n${p.unavailable.length} signal(s) FAILED — these would render as "absent" in VANTAGE, not as zero.\n`
      : '\nAll four signals answered.\n');
  }

  await closePool();
  process.exit(p.unavailable.length ? 1 : 0);
}

main().catch(async err => {
  console.error('\nValidation could not run:', err instanceof Error ? err.message : err);
  console.error(
    'If this is a connection error, check you are running from the repo root so `.env` is found, '
    + 'that it carries NOVA_SQL_CONNECTION (or NOVA_SQL_SERVER/DATABASE/USER/PASSWORD) for the NOVA '
    + 'database, and that DATA_DIR points at the settings.json holding the kpi_sql_* credentials.\n',
  );
  await closePool().catch(() => {});
  process.exit(1);
});
