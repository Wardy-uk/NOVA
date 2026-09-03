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

const DIST = '../dist/server/server';
const { FileSettingsQueries } = await import(`${DIST}/db/settings-store.js`);
const { LlmService } = await import(`${DIST}/services/llm-service.js`);
const { JiraRestClient } = await import(`${DIST}/services/jira-client.js`);
const { QaPipeline } = await import(`${DIST}/services/qa-pipeline.js`);

const settings = new FileSettingsQueries();
const s = settings.getAll();

const target = s.qa_pipeline_target === 'live' ? 'live' : 'uat';
const budget = s.agent_token_budget_daily_qa_scoring || '(unset — hardcoded default 1,200,000)';
console.log(`QA re-score — window ${HOURS}h, target=${target}, daily token budget=${budget}`);

if (!APPLY) {
  console.log('\nDry run. Nothing written. Re-run with --apply to re-score.');
  console.log('Check first: is the token budget raised, and is the deployed build v1.1.509 or later?');
  process.exit(0);
}

const jira = new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token });
const llm = new LlmService(settings);
const qa = new QaPipeline(settings, llm, jira, 'NT');

const started = Date.now();
const results = await qa.scoreRecentlyResolved(HOURS, { force: true });
console.log(`\nRe-scored ${results.length} tickets in ${Math.round((Date.now() - started) / 1000)}s.`);
console.log('If the run stopped on the daily token budget, the log line above says how many were left — re-run to finish.');
process.exit(0);
