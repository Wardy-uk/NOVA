/**
 * Create the three sentiment surveys — but ONLY if anonymity actually works.
 *
 * The survey invitation tells people their answers are anonymous. That claim was
 * false until v1.1.438, and it was raised as a finding before anything was sent.
 * Creating these surveys against a database that can still re-identify responses
 * would undo that entirely, so this script VERIFIES the fix first and refuses to
 * write anything if it does not hold.
 *
 * Verification is not "the code looks right" — it runs the actual
 * re-identification join and requires it to return nothing.
 *
 * Run on AAPP01, FROM THE REPO ROOT:
 *
 *     npx tsx scripts/create-sentiment-surveys.ts --check     # verify only
 *     npx tsx scripts/create-sentiment-surveys.ts --create    # verify then create
 *
 * Surveys are created as DRAFTS. Nothing is sent: recipients still need adding
 * (there is no CSM/KAM roster anywhere in NOVA), and activating is a decision.
 */

import dotenv from 'dotenv';

import { query, execute, closePool } from '../src/server/services/database.js';

dotenv.config();

const args = process.argv.slice(2);
const CREATE = args.includes('--create');

/** Minimum responses before any aggregate is shown. */
const MIN_N = 5;

interface Check { name: string; ok: boolean; detail: string }

/**
 * Does the data model support the promise?
 *
 * Three properties, each checked against the database rather than the source.
 */
async function verifyAnonymity(): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. The response row must not carry a token that links back to a recipient.
  const respCols = await query<{ name: string }>(
    `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('survey_responses')`,
  );
  const hasToken = respCols.some(c => c.name.toLowerCase() === 'token');
  checks.push({
    name: 'survey_responses has no token column',
    ok: !hasToken,
    detail: hasToken
      ? 'A token column still exists — the join back to survey_recipients.email is intact.'
      : 'Dropped. There is no column left to join on.',
  });

  // 2. No completed recipient may still hold a raw token.
  const live = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM survey_recipients WHERE completed = 1 AND token IS NOT NULL`,
  );
  const stillLinked = Number(live[0]?.cnt ?? 0);
  checks.push({
    name: 'no completed recipient retains a token',
    ok: stillLinked === 0,
    detail: stillLinked === 0
      ? 'All completed recipients have had their token cleared.'
      : `${stillLinked} completed recipient(s) still hold a raw token — those responses remain identifiable.`,
  });

  // 3. The actual attack: run the join and require it to return nothing.
  //    Only meaningful if the column still exists; skipped cleanly if not.
  if (hasToken) {
    const joined = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt
         FROM survey_responses resp
         JOIN survey_recipients r ON r.token = resp.token`,
    );
    const n = Number(joined[0]?.cnt ?? 0);
    checks.push({
      name: 're-identification join returns nothing',
      ok: n === 0,
      detail: n === 0 ? 'Join returns no rows.' : `Join returns ${n} rows — every one is an identifiable response.`,
    });
  } else {
    checks.push({
      name: 're-identification join returns nothing',
      ok: true,
      detail: 'Not applicable — the column it needed no longer exists.',
    });
  }

  return checks;
}

/**
 * The three surveys.
 *
 * Questions are deliberately NOT invented here — the built-in templates
 * (`support_team_satisfaction`, `kam_satisfaction`, `csm_satisfaction`) were
 * written for this purpose and are what the Trends metrics already expect. This
 * only creates the survey rows and copies the template questions across.
 */
const SURVEYS = [
  {
    template: 'support_team_satisfaction',
    category: 'team_satisfaction',
    title: 'Support Team Sentiment',
    description: 'Monthly. Anonymous — individual responses are not stored against you, and results are only reported once at least five people have answered.',
    recurrenceDays: 30,
  },
  {
    template: 'kam_satisfaction',
    category: 'kam_satisfaction',
    title: 'Key Account Manager Sentiment',
    description: 'How well Support is serving your accounts. Anonymous, reported in aggregate only.',
    recurrenceDays: 30,
  },
  {
    template: 'csm_satisfaction',
    category: 'csm_satisfaction',
    title: 'Customer Success Sentiment',
    description: 'How well Support is serving your customers. Anonymous, reported in aggregate only.',
    recurrenceDays: 30,
  },
];

async function existing(category: string): Promise<number> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM surveys WHERE category = ? AND status IN ('draft','scheduled','active')`,
    [category],
  );
  return Number(rows[0]?.cnt ?? 0);
}

async function main(): Promise<void> {
  console.log('\nSurvey anonymity — verified against the database, not the source\n');

  const checks = await verifyAnonymity();
  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
    console.log(`      ${c.detail}`);
  }

  const sound = checks.every(c => c.ok);
  if (!sound) {
    console.log('\nREFUSING to create surveys. The invitation promises anonymity this database');
    console.log('cannot deliver, which is the finding that paused these surveys in the first place.\n');
    await closePool();
    process.exit(1);
  }

  console.log('\nAnonymity holds.\n');

  if (!CREATE) {
    console.log('Check only. Re-run with --create to create the three surveys as drafts.\n');
    await closePool();
    process.exit(0);
  }

  for (const s of SURVEYS) {
    const already = await existing(s.category);
    if (already > 0) {
      console.log(`  – ${s.title}: ${already} open survey already in this category, skipping.`);
      continue;
    }

    const created = await query<{ id: number }>(
      `INSERT INTO surveys (title, description, category, status, recurrence_interval_days, created_by, created_at)
       OUTPUT INSERTED.id
       VALUES (?, ?, ?, 'draft', ?, 'vantage-setup', GETUTCDATE())`,
      [s.title, s.description, s.category, s.recurrenceDays],
    );
    const surveyId = created[0]?.id;
    if (!surveyId) { console.log(`  ✗ ${s.title}: insert returned no id`); continue; }

    // Copy the template's questions. Read from the most recent survey in the
    // same category if one exists; otherwise the admin UI template picker is the
    // only source and the questions are added there.
    const source = await query<{ id: number }>(
      `SELECT TOP (1) id FROM surveys WHERE category = ? AND id <> ? ORDER BY id DESC`,
      [s.category, surveyId],
    );
    if (source[0]?.id) {
      await execute(
        `INSERT INTO survey_questions (survey_id, order_index, question_text, question_type, required)
         SELECT ?, order_index, question_text, question_type, required
           FROM survey_questions WHERE survey_id = ?`,
        [surveyId, source[0].id],
      );
      console.log(`  ✓ ${s.title} (id ${surveyId}) — questions copied from survey ${source[0].id}, monthly recurrence`);
    } else {
      console.log(`  ✓ ${s.title} (id ${surveyId}) — created, but NO questions.`);
      console.log(`      No previous ${s.category} survey to copy from. Open it in Team Surveys`);
      console.log(`      and apply the "${s.template}" template before activating.`);
    }
  }

  console.log('\nAll created as DRAFTS. Nothing has been sent.');
  console.log('Still to do by hand:');
  console.log('  - Add recipients. There is no CSM/KAM roster in NOVA, so those must be typed in.');
  console.log(`  - Confirm the results view suppresses aggregates below ${MIN_N} responses.`);
  console.log('  - Activate when you are ready.\n');

  await closePool();
  process.exit(0);
}

main().catch(async err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  await closePool().catch(() => {});
  process.exit(1);
});
