/**
 * Standalone data audit script — connects to SQL Server and checks coverage
 * across all KPI/QA/GR tables for each checkpoint date.
 *
 * Usage: node scripts/data-audit.mjs
 * Reads credentials from settings.json in project root.
 */
import fs from 'fs';
import sql from 'mssql';

const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
const { kpi_sql_server: server, kpi_sql_database: database, kpi_sql_user: user, kpi_sql_password: password } = settings;

if (!server || !database || !user || !password) {
  console.error('Missing SQL Server credentials in settings.json');
  process.exit(1);
}

const CHECKPOINTS = [
  { label: 'Day 0', date: '2026-03-01' },
  { label: 'Day 1', date: '2026-03-16' },
  { label: 'Day 15', date: '2026-03-31' },
  { label: 'Day 30', date: '2026-04-15' },
];

const pool = await new sql.ConnectionPool({
  server, database, user, password,
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 30000,
}).connect();

console.log('Connected to SQL Server\n');

// ─── 1. Table overview ───
console.log('═══════════════════════════════════════════');
console.log('TABLE OVERVIEW');
console.log('═══════════════════════════════════════════');

const tables = [
  { key: 'jira_kpi_daily', dateCol: 'CreatedAt' },
  { key: 'jira_qa_results', dateCol: 'CreatedAt' },
  { key: 'Jira_QA_GoldenRules', dateCol: 'COALESCE(commentTimestamp, CreatedAt)' },
  { key: 'jira_agent_kpi_daily', dateCol: 'CreatedAt' },
];

for (const t of tables) {
  try {
    const r = await pool.request().query(`
      SELECT COUNT(*) AS total,
             MIN(CAST(${t.dateCol} AS DATE)) AS earliest,
             MAX(CAST(${t.dateCol} AS DATE)) AS latest
      FROM dbo.${t.key}
    `);
    const row = r.recordset[0];
    console.log(`  ${t.key.padEnd(30)} ${String(row.total).padStart(8)} rows  ${row.earliest?.toISOString().slice(0,10) ?? 'N/A'} → ${row.latest?.toISOString().slice(0,10) ?? 'N/A'}`);
  } catch (e) {
    console.log(`  ${t.key.padEnd(30)} ERROR: ${e.message}`);
  }
}

// ─── 2. Per-checkpoint coverage ───
console.log('\n═══════════════════════════════════════════');
console.log('CHECKPOINT COVERAGE');
console.log('═══════════════════════════════════════════');

for (const cp of CHECKPOINTS) {
  console.log(`\n── ${cp.label} (${cp.date}) ──`);

  // KPI: exact day
  const kpi = await pool.request()
    .input('d', sql.Date, cp.date)
    .query(`SELECT COUNT(*) AS rows FROM dbo.jira_kpi_daily WHERE CAST(CreatedAt AS DATE) = @d`);
  console.log(`  KPI daily (exact day):       ${kpi.recordset[0].rows} rows`);

  // KPI: which metrics exist on that day
  if (kpi.recordset[0].rows > 0) {
    const kpiList = await pool.request()
      .input('d', sql.Date, cp.date)
      .query(`SELECT kpi, [Count] AS val FROM dbo.jira_kpi_daily WHERE CAST(CreatedAt AS DATE) = @d ORDER BY kpi`);

    // Check the specific checkpoint metric patterns
    const patterns = [
      'FRT Compliance%Open Queue%',
      'Resolution Compliance%Open Queue%',
      'Escalation Accuracy%',
      'Number of Tickets in Development',
      'Oldest actionable ticket (days) in Development',
      'CSAT%',
      'FCR%',
      '1st Line Resolution Rate%',
      'Bug Escalation-to-Ack%',
    ];
    for (const pat of patterns) {
      const match = kpiList.recordset.find(r => {
        const regex = new RegExp('^' + pat.replace(/%/g, '.*'), 'i');
        return regex.test(r.kpi);
      });
      const label = pat.replace(/%/g, '').padEnd(50);
      console.log(`    ${label} ${match ? match.val : '— MISSING'}`);
    }
  }

  // QA: exact day + 7-day window
  const qaExact = await pool.request()
    .input('d', sql.Date, cp.date)
    .query(`SELECT COUNT(*) AS rows, AVG(CAST(overallScore AS FLOAT)) AS avg
            FROM dbo.jira_qa_results WHERE CAST(CreatedAt AS DATE) = @d AND qaType != 'excluded'`);
  const qaWin = await pool.request()
    .input('d', sql.Date, cp.date)
    .query(`SELECT COUNT(*) AS rows, AVG(CAST(overallScore AS FLOAT)) AS avg,
                   COUNT(DISTINCT CAST(CreatedAt AS DATE)) AS days
            FROM dbo.jira_qa_results
            WHERE CAST(CreatedAt AS DATE) BETWEEN DATEADD(DAY, -6, @d) AND @d
              AND qaType != 'excluded'`);
  console.log(`  QA (exact day):              ${qaExact.recordset[0].rows} rows, avg=${qaExact.recordset[0].avg?.toFixed(2) ?? 'null'}`);
  console.log(`  QA (7-day window):           ${qaWin.recordset[0].rows} rows across ${qaWin.recordset[0].days} days, avg=${qaWin.recordset[0].avg?.toFixed(2) ?? 'null'}`);

  // GR: exact day + 7-day window
  const grExact = await pool.request()
    .input('d', sql.Date, cp.date)
    .query(`SELECT COUNT(*) AS rows,
              AVG(CASE WHEN rule1Pass=1 THEN 100.0 ELSE 0 END +
                  CASE WHEN rule2Pass=1 THEN 100.0 ELSE 0 END +
                  CASE WHEN rule3Pass=1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
            FROM dbo.Jira_QA_GoldenRules
            WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE) = @d`);
  const grWin = await pool.request()
    .input('d', sql.Date, cp.date)
    .query(`SELECT COUNT(*) AS rows,
              AVG(CASE WHEN rule1Pass=1 THEN 100.0 ELSE 0 END +
                  CASE WHEN rule2Pass=1 THEN 100.0 ELSE 0 END +
                  CASE WHEN rule3Pass=1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct,
              COUNT(DISTINCT CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)) AS days
            FROM dbo.Jira_QA_GoldenRules
            WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
                  BETWEEN DATEADD(DAY, -6, @d) AND @d`);
  console.log(`  GR (exact day):              ${grExact.recordset[0].rows} rows, avg=${grExact.recordset[0].avg_pct?.toFixed(1) ?? 'null'}%`);
  console.log(`  GR (7-day window):           ${grWin.recordset[0].rows} rows across ${grWin.recordset[0].days} days, avg=${grWin.recordset[0].avg_pct?.toFixed(1) ?? 'null'}%`);
}

// ─── 3. Daily QA coverage (Feb-Mar) ───
console.log('\n═══════════════════════════════════════════');
console.log('QA DAILY COVERAGE (Feb 1 - Mar 26)');
console.log('═══════════════════════════════════════════');
const qaDays = await pool.request().query(`
  SELECT CAST(CreatedAt AS DATE) AS day, COUNT(*) AS rows,
         ROUND(AVG(CAST(overallScore AS FLOAT)), 2) AS avg_score
  FROM dbo.jira_qa_results
  WHERE CreatedAt >= '2026-02-01' AND qaType != 'excluded'
  GROUP BY CAST(CreatedAt AS DATE)
  ORDER BY day
`);
for (const r of qaDays.recordset) {
  const d = r.day.toISOString().slice(0,10);
  const bar = '█'.repeat(Math.min(Math.round(r.rows / 5), 40));
  console.log(`  ${d}  ${String(r.rows).padStart(5)} rows  avg=${String(r.avg_score).padStart(5)}  ${bar}`);
}

// ─── 4. Daily GR coverage (Feb-Mar) ───
console.log('\n═══════════════════════════════════════════');
console.log('GOLDEN RULES DAILY COVERAGE (Feb 1 - Mar 26)');
console.log('═══════════════════════════════════════════');
const grDays = await pool.request().query(`
  SELECT CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE) AS day, COUNT(*) AS rows,
         ROUND(AVG(CASE WHEN rule1Pass=1 THEN 100.0 ELSE 0 END +
                   CASE WHEN rule2Pass=1 THEN 100.0 ELSE 0 END +
                   CASE WHEN rule3Pass=1 THEN 100.0 ELSE 0 END) / 3.0, 1) AS avg_pct
  FROM dbo.Jira_QA_GoldenRules
  WHERE COALESCE(commentTimestamp, CreatedAt) >= '2026-02-01'
  GROUP BY CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
  ORDER BY day
`);
for (const r of grDays.recordset) {
  const d = r.day.toISOString().slice(0,10);
  const bar = '█'.repeat(Math.min(Math.round(r.rows / 3), 40));
  console.log(`  ${d}  ${String(r.rows).padStart(5)} rows  avg=${String(r.avg_pct).padStart(5)}%  ${bar}`);
}

await pool.close();
console.log('\nDone.');
