/**
 * One-off: force a QA re-score over a window, replacing the existing scores.
 *
 * WHY
 * Every QA score written before v1.1.500 was produced with internal comments fed to the
 * model as if they were customer-facing replies (the `properties` vs `jsdPublic` bug),
 * and without the agent-scoping or quick-close exclusions. Those scores are not
 * comparable with anything written since. The QA RAG reads a rolling 7-day window, so
 * re-scoring the last 7 days makes the rating correct now rather than in a week.
 *
 * Requires v1.1.509+, where force deletes the prior row for a ticket before writing the
 * new one. On an earlier build force would leave BOTH rows in place and every average
 * would count them together — worse than doing nothing.
 *
 * COST (measured): ~5,500 tokens and ~$0.025 per ticket. 7 days is ~380-500 tickets,
 * so ~2.8M tokens and ~$13. That exceeds the 1.2M/day qa_scoring budget, so raise
 * `agent_token_budget_daily_qa_scoring` before running or the pipeline will stop partway
 * (it stops cleanly and logs how many were left, but you'll need a second run).
 *
 * Usage:
 *   node scripts/qa-rescore.mjs --hours=168            # dry run: what would be re-scored
 *   node scripts/qa-rescore.mjs --hours=168 --apply    # do it
 */
import 'dotenv/config';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const HOURS = parseInt(arg('hours', '168'), 10);
const APPLY = process.argv.includes('--apply');
// Resume mode. A full forced pass over a 7-day window is about an hour of sequential LLM
// calls, longer than many remote sessions survive, and `force` restarts from the top each
// time — so an interrupted run never finishes, it just re-does its first N tickets.
// Instead: delete the stale rows for one batch of tickets, then run WITHOUT force, so the
// pipeline's own already-scored check skips everything else and scores exactly the batch
// whose rows are now missing. Repeat until nothing is stale.
const RESUME = process.argv.includes('--resume');
const BATCH = parseInt(arg('batch', '40'), 10);
const BEFORE = arg('before', null);   // rows processed before this are pre-backfill

const DIST = '../dist/server/server';
const { initPool } = await import(`${DIST}/services/database.js`);
const { FileSettingsQueries } = await import(`${DIST}/db/settings-store.js`);
const { ConfigService } = await import(`${DIST}/services/config-service.js`);
const { LlmService } = await import(`${DIST}/services/llm-service.js`);
const { JiraRestClient } = await import(`${DIST}/services/jira-client.js`);
const { QaPipeline } = await import(`${DIST}/services/qa-pipeline.js`);

// Settings live in dbo.settings, read through ConfigService — settings.json is only a
// pre-migration fallback and is badly stale on prod (last written July, and missing
// qa_pipeline_target entirely). Reading the file directly resolved the target to 'uat'
// and would have written every re-scored row to the dead UAT table while leaving the
// live data untouched. Use the same path the service uses.
// initPool, not initializeDatabase: the latter runs the whole idempotent migration set,
// which a scoring script has no business doing on prod (it threw ALTER TABLE errors on
// the first run). ConfigService only needs the pool.
await initPool();
const settings = new ConfigService(new FileSettingsQueries());
await settings.initialize();
const s = settings.getAll();

const target = s.qa_pipeline_target === 'live' ? 'live' : 'uat';
const budget = s.agent_token_budget_daily_qa_scoring || '(unset — hardcoded default 1,200,000)';
console.log(`QA re-score — window ${HOURS}h, target=${target}, daily token budget=${budget}`);

// Writing a backfill into the wrong table is silent and wastes the whole run, so make
// the target an explicit choice rather than something you have to notice in the output.
if (target !== 'live' && !process.argv.includes('--allow-uat')) {
  console.error(`
ABORT: target resolved to '${target}', not 'live'. Refusing to write a backfill to the UAT table.`);
  console.error('If that is genuinely what you want, re-run with --allow-uat.');
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run. Nothing written. Re-run with --apply to re-score.');
  console.log('Check first: is the token budget raised, and is the deployed build v1.1.509 or later?');
  process.exit(0);
}

const jira = new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token });
const llm = new LlmService(settings);
const qa = new QaPipeline(settings, llm, jira, 'NT');

const started = Date.now();

if (RESUME) {
  if (!BEFORE) { console.error('--resume needs --before=<ISO timestamp> to know which rows are stale.'); process.exit(1); }
  const sqlMod = await import('mssql');
  const mssql = sqlMod.default ?? sqlMod;
  const days = Math.ceil(HOURS / 24);
  const pool = await new mssql.ConnectionPool({
    server: s.kpi_sql_server, database: s.kpi_sql_database, user: s.kpi_sql_user, password: s.kpi_sql_password,
    options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 120000,
  }).connect();

  const countStale = async () => (await pool.request()
    .input('before', mssql.DateTime2, new Date(BEFORE))
    .query(`SELECT COUNT(*) AS n FROM dbo.jira_qa_results
            WHERE CreatedAt >= DATEADD(day, -${days}, GETDATE()) AND processedAt < @before`)).recordset[0].n;

  console.log(`stale rows remaining before this batch: ${await countStale()}`);

  const stale = await pool.request()
    .input('before', mssql.DateTime2, new Date(BEFORE))
    .query(`SELECT TOP (${BATCH}) issueKey FROM dbo.jira_qa_results
            WHERE CreatedAt >= DATEADD(day, -${days}, GETDATE()) AND processedAt < @before
            ORDER BY issueKey`);
  const keys = stale.recordset.map(r => r.issueKey);
  if (!keys.length) { console.log('Nothing stale left — backfill complete.'); await pool.close(); process.exit(0); }

  const list = keys.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
  const del = await pool.request().query(`DELETE FROM dbo.jira_qa_results WHERE issueKey IN (${list})`);
  console.log(`deleted ${del.rowsAffected[0]} stale row(s) across ${keys.length} ticket(s) — the pipeline will re-score exactly those`);
  await pool.close();

  const res = await qa.scoreRecentlyResolved(HOURS, { force: false });
  console.log(`Batch done: ${res.length} scored in ${Math.round((Date.now() - started) / 1000)}s. Re-run to continue.`);
  process.exit(0);
}
const results = await qa.scoreRecentlyResolved(HOURS, { force: true });
console.log(`\nRe-scored ${results.length} tickets in ${Math.round((Date.now() - started) / 1000)}s.`);
console.log('If the run stopped on the daily token budget, the log line above says how many were left — re-run to finish.');
process.exit(0);
