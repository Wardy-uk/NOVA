/**
 * Validate the sentiment signals against the live database — WITHOUT deploying.
 *
 * Same contract as `validate-flow-signals.ts`: it imports the exact function the
 * bridge route calls, so a pass here IS a pass for
 * `GET /api/neuro-bridge/sentiment-signals`. Read-only throughout.
 *
 * Run on AAPP01, FROM THE REPO ROOT so `.env` is found:
 *
 *     cd C:\nurtur\nova
 *     npx tsx scripts/validate-sentiment-signals.ts
 *     npx tsx scripts/validate-sentiment-signals.ts --days 90 --json
 */

import dotenv from 'dotenv';

import { closePool } from '../src/server/services/database.js';
import { getSentimentSignals } from '../src/server/services/sentiment-signals.js';

dotenv.config();

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 30;
const asJson = args.includes('--json');

async function main(): Promise<void> {
  const s = await getSentimentSignals(days);

  if (asJson) {
    console.log(JSON.stringify(s, null, 2));
    await closePool();
    process.exit(s.unavailable.length ? 1 : 0);
  }

  console.log(`\nsentiment-signals — ${s.build}, last ${s.window.days} days\n`);

  if (s.ai.ok && s.ai.data) {
    const d = s.ai.data;
    console.log(`  AI sentiment      ${d.scored} tickets scored, ${d.negative} negative (<= ${d.negativeThreshold})`
      + `${d.average === null ? '' : `, mean ${d.average}`}`);
    console.log(`                    ${d.basis}`);
    for (const w of d.worst.slice(0, 3)) {
      console.log(`                    ${w.ticket} ${w.score} — ${w.summary.slice(0, 90)}`);
    }
  } else {
    console.log(`  AI sentiment      FAILED — ${s.ai.error}`);
  }

  if (s.portalCsat.ok && s.portalCsat.data) {
    const d = s.portalCsat.data;
    console.log(`\n  Portal CSAT       ${d.responded} of ${d.sent} answered`
      + `${d.responseRatePct === null ? '' : ` (${d.responseRatePct}%)`}`
      + `${d.thin ? ' — SAMPLE TOO THIN, scores withheld' : `, avg ${d.avgCsat}`}`);
    for (const c of d.recentComments.slice(0, 3)) {
      console.log(`                    ${c.ticket} [${c.score}] ${c.comment.slice(0, 80)}`);
    }
  } else {
    console.log(`\n  Portal CSAT       FAILED — ${s.portalCsat.error}`);
  }

  if (s.surveys.ok && s.surveys.data) {
    const cats = Object.entries(s.surveys.data.byCategory);
    console.log(`\n  Surveys           ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} with responses`);
    for (const [cat, runs] of cats) {
      console.log(`                    ${cat}: ${runs.length} run(s)`);
      for (const r of runs.slice(-3)) {
        console.log(`                      ${r.period || 'open'} — ${r.responses} responses`
          + `${r.avgScore === null ? ' (suppressed, thin)' : `, avg ${r.avgScore}`}`);
      }
    }
    if (!cats.length) console.log('                    No survey responses yet — nothing has been run.');
  } else {
    console.log(`\n  Surveys           FAILED — ${s.surveys.error}`);
  }

  console.log(s.unavailable.length
    ? `\n${s.unavailable.length} block(s) FAILED — these render as absent downstream, not as zero.\n`
    : '\nAll blocks answered.\n');

  await closePool();
  process.exit(s.unavailable.length ? 1 : 0);
}

main().catch(async err => {
  console.error('\nValidation could not run:', err instanceof Error ? err.message : err);
  await closePool().catch(() => {});
  process.exit(1);
});
