/**
 * One-off: recalculate historical Golden Rules OverallScore under the new formula.
 *
 * WHY
 * Overall used to be the MINIMUM of the three rules — a comment scoring 3/3/1 was
 * recorded as 1. From v1.1.504 it is the MEAN of the rules that apply, so that same
 * comment is 2.33. Left alone, the column holds two different definitions and any trend
 * crossing the changeover shows a jump that looks like the team improving overnight.
 *
 * Every rule score is stored, so historical overalls can be recomputed exactly. Rows
 * written under the new code already hold a mean and must not be touched — they are
 * identified by Rule3Score IS NULL (impossible under the old schema, which was NOT NULL)
 * or by a non-integer OverallScore (impossible under the old TINYINT column).
 *
 * CAVEAT: old rows scored rule 3 as 1 in places where the new rubric would mark it "not
 * applicable", so recomputed history still reads slightly low. This removes most of the
 * discontinuity, not all of it.
 *
 * ORDER MATTERS — run this only AFTER deploying v1.1.504 or later. That deploy runs
 * ensureScoreColumns(), which widens OverallScore from TINYINT to DECIMAL(4,2). Running
 * it against the old TINYINT column would round every mean back to an integer and make
 * the data worse than it is now.
 *
 * Usage:
 *   node scripts/recalc-gr-overall.mjs --check     # report only, writes nothing
 *   node scripts/recalc-gr-overall.mjs --apply     # perform the update
 *   node scripts/recalc-gr-overall.mjs --apply --table=Jira_QA_GoldenRules   # one table
 *
 * --table exists because the UAT table holds 21 abandoned rows whose average "overall"
 * is 5.38 — impossible on a 1-3 scale, so they predate this scoring entirely and the
 * guard below cannot distinguish them. Their original values are not recoverable from
 * the rule scores, so they are left alone unless explicitly named.
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const MODE = process.argv.includes('--apply') ? 'apply' : 'check';
const DATA_DIR = process.env.DATA_DIR || process.cwd();

const settings = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
  return raw.settings || raw;
})();

const ONLY = (process.argv.find(a => a.startsWith('--table=')) || '').split('=')[1];
const TABLES = ONLY ? [ONLY] : ['Jira_QA_GoldenRules', 'Jira_QA_GoldenRulesUAT'];

async function main() {
  const pool = await new sql.ConnectionPool({
    server: settings.kpi_sql_server,
    database: settings.kpi_sql_database,
    user: settings.kpi_sql_user,
    password: settings.kpi_sql_password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 300000,
  }).connect();

  for (const tbl of TABLES) {
    const exists = await pool.request().query(`SELECT OBJECT_ID('dbo.${tbl}') AS id`);
    if (!exists.recordset[0].id) { console.log(`${tbl}: does not exist, skipping`); continue; }

    // Guard: the migration must have run first, or means get rounded back to integers.
    const col = await pool.request().query(`
      SELECT t.name AS type FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
      WHERE c.object_id = OBJECT_ID('dbo.${tbl}') AND c.name = 'OverallScore'`);
    const type = col.recordset[0]?.type;
    if (type === 'tinyint') {
      console.error(`${tbl}: ABORT — OverallScore is still TINYINT. Deploy v1.1.504+ first so ensureScoreColumns() widens it, then re-run.`);
      continue;
    }

    // Old rows only: rule 3 scored (never null under the old schema) AND an integer
    // overall (the old TINYINT column could hold nothing else).
    const WHERE = `Rule3Score IS NOT NULL AND OverallScore = FLOOR(OverallScore)`;

    const before = await pool.request().query(`
      SELECT COUNT(*) AS n, AVG(CAST(OverallScore AS FLOAT)) AS avgNow,
             AVG((CAST(Rule1Score AS FLOAT)+Rule2Score+Rule3Score)/3.0) AS avgNew
      FROM dbo.${tbl} WHERE ${WHERE}`);
    const b = before.recordset[0];
    if (!b.n) { console.log(`${tbl}: no legacy rows to recalculate`); continue; }

    console.log(`${tbl}: ${b.n} legacy rows — overall ${b.avgNow.toFixed(2)} (min-of-three) → ${b.avgNew.toFixed(2)} (mean-of-three)`);

    if (MODE !== 'apply') { console.log(`  --check: nothing written. Re-run with --apply to update.`); continue; }

    const res = await pool.request().query(`
      UPDATE dbo.${tbl}
      SET OverallScore = ROUND((CAST(Rule1Score AS FLOAT) + Rule2Score + Rule3Score) / 3.0, 2)
      WHERE ${WHERE}`);
    console.log(`  updated ${res.rowsAffected[0]} rows`);
  }

  await pool.close();
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
