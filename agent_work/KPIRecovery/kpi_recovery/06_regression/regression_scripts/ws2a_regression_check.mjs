// WS2-A Regression Check — RC-011 through RC-014
// Protects escalation and rejection KPI family from regression to structural zero
import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

function parseCS(cs) {
  const c = {};
  for (const p of cs.split(';').filter(Boolean)) {
    const [k,...v] = p.split('=');
    const key = k.trim().toLowerCase(), val = v.join('=').trim();
    if (key === 'server' || key === 'data source') c.server = val;
    if (key === 'database' || key === 'initial catalog') c.database = val;
    if (key === 'user id' || key === 'uid') c.user = val;
    if (key === 'password' || key === 'pwd') c.password = val;
  }
  return c;
}

const results = [];
const today = new Date().toISOString().slice(0, 10);

console.log(`\nWS2-A REGRESSION CHECK — ${today}`);
console.log('='.repeat(60) + '\n');

// Connect to NOVA main DB (escalation_log + settings live here)
const nova = await sql.connect({
  ...parseCS(process.env.NOVA_SQL_CONNECTION),
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 120000
});

// Fetch KPI DB credentials from NOVA settings table (password may be absent — use env fallback)
const credRows = await nova.query(`
  SELECT [key], value FROM settings
  WHERE [key] IN ('kpi_sql_server','kpi_sql_database','kpi_sql_user','kpi_sql_password')
`);
const kpiConf = {};
credRows.recordset.forEach(r => kpiConf[r.key] = r.value);
const kpiServer = kpiConf.kpi_sql_server || 'bym-asqlep01.database.windows.net';
const kpiDatabase = kpiConf.kpi_sql_database || 'TechSupportJSM';
const kpiUser = kpiConf.kpi_sql_user || 'azureadmin';
const kpiPassword = kpiConf.kpi_sql_password || process.env.KPI_SQL_PASSWORD;
if (!kpiPassword) { console.error('ERROR: No KPI SQL password in settings or KPI_SQL_PASSWORD env'); process.exit(2); }
const kpiPool = await new sql.ConnectionPool({
  server: kpiServer, database: kpiDatabase, user: kpiUser, password: kpiPassword,
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 120000
}).connect();
console.log(`KPI DB: ${kpiServer} / ${kpiDatabase}`);

// Discover KPI table name and column names
const tblResult = await kpiPool.query(`
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'jira_kpi_daily%'
`);
const tblNames = tblResult.recordset.map(r => r.TABLE_NAME);
const tbl = tblNames.includes('jira_kpi_daily') ? 'jira_kpi_daily'
  : tblNames[0] || 'jira_kpi_daily';

const colResult = await kpiPool.query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tbl}'
`);
const cols = colResult.recordset.map(r => r.COLUMN_NAME);
const kpiCol = cols.includes('kpi') ? 'kpi' : 'kpi_name';
const valCol = cols.includes('count') ? 'count' : cols.includes('value') ? 'value' : 'kpi_value';
const dateCol = cols.includes('createdAt') ? 'createdAt' : cols.includes('CreatedAt') ? 'CreatedAt' : 'createdAt';
console.log(`KPI table: ${tbl}, columns: kpi=${kpiCol}, val=${valCol}, date=${dateCol}\n`);

// ── RC-011: Non-zero escalation activity ──
const escLogQuery = await nova.query(`
  SELECT COUNT(*) AS cnt
  FROM escalation_log
  WHERE created_at >= DATEADD(day, -3, GETUTCDATE())
`);
const recentEscCount = escLogQuery.recordset[0].cnt;
const rc011Pass = recentEscCount > 0;
console.log(`RC-011: Non-zero escalation activity .... ${rc011Pass ? 'PASS' : 'FAIL'}`);
console.log(`  escalation_log entries (last 3 days): ${recentEscCount}`);
console.log();
results.push({ id: 'RC-011', name: 'Non-zero escalation activity', pass: rc011Pass, detail: `${recentEscCount} entries in last 3 days` });

// ── RC-012: Rejection behaviour exists ──
const rejQuery = await nova.query(`
  SELECT COUNT(*) AS cnt
  FROM escalation_log
  WHERE (
    (from_tier IN ('T3', 'Tier 3') AND to_tier IN ('T2', 'Tier 2', 'T1', 'Customer Care'))
    OR (from_tier IN ('Dev', 'Development') AND to_tier IN ('T3', 'Tier 3', 'T2', 'Tier 2'))
    OR (from_tier IN ('T2', 'Tier 2') AND to_tier IN ('T1', 'Customer Care'))
    OR (from_tier IN ('Production') AND to_tier IN ('Customer Care', 'T1'))
  )
`);
const rejCount = rejQuery.recordset[0].cnt;
const rc012Pass = rejCount > 0;
console.log(`RC-012: Rejection behaviour exists ...... ${rc012Pass ? 'PASS' : 'FAIL'}`);
console.log(`  Downward tier-change entries (all time): ${rejCount}`);
console.log();
results.push({ id: 'RC-012', name: 'Rejection behaviour exists', pass: rc012Pass, detail: `${rejCount} rejection entries` });

// ── RC-013: Escalation Accuracy % is not false-100% ──
const accQuery = await kpiPool.query(`
  SELECT TOP 1 ${valCol} AS val, CAST(${dateCol} AS DATE) AS snap_date
  FROM ${tbl}
  WHERE ${kpiCol} LIKE '%Accuracy%'
  ORDER BY ${dateCol} DESC
`);
let rc013Pass = false;
let accDetail = '';
if (accQuery.recordset.length === 0) {
  accDetail = 'No Escalation Accuracy % rows found';
} else {
  const accVal = accQuery.recordset[0].val;
  const snapDate = accQuery.recordset[0].snap_date;
  const snapStr = typeof snapDate === 'object' ? snapDate.toISOString().slice(0,10) : String(snapDate).slice(0,10);

  const escCountQuery = await kpiPool.query(`
    SELECT SUM(${valCol}) AS total_esc
    FROM ${tbl}
    WHERE CAST(${dateCol} AS DATE) = '${snapStr}'
      AND ${kpiCol} LIKE 'Tickets escalated to%'
  `);
  const totalEsc = escCountQuery.recordset[0].total_esc || 0;

  if (totalEsc > 0 && accVal === 100) {
    accDetail = `Accuracy=${accVal}% but totalEsc=${totalEsc} on ${snapStr} — likely false-100% default`;
  } else if (totalEsc > 0 && accVal < 100) {
    accDetail = `Accuracy=${accVal}%, totalEsc=${totalEsc} on ${snapStr} — derived from real data`;
    rc013Pass = true;
  } else if (totalEsc === 0) {
    accDetail = `Accuracy=${accVal}%, totalEsc=0 on ${snapStr} — no escalations to validate against (acceptable)`;
    rc013Pass = true;
  }
}
console.log(`RC-013: Escalation Accuracy non-default . ${rc013Pass ? 'PASS' : 'FAIL'}`);
console.log(`  ${accDetail}`);
console.log();
results.push({ id: 'RC-013', name: 'Escalation Accuracy non-default', pass: rc013Pass, detail: accDetail });

// ── RC-014: No regression to WS1/WS5 trusted slices ──
const devQuery = await kpiPool.query(`
  SELECT TOP 1 ${valCol} AS val
  FROM ${tbl}
  WHERE ${kpiCol} = 'Number of Tickets in Development'
  ORDER BY ${dateCol} DESC
`);
let rc014Pass = false;
let rc014Detail = '';
if (devQuery.recordset.length === 0) {
  rc014Detail = 'No Development ticket count rows found';
} else {
  const devVal = devQuery.recordset[0].val;
  rc014Pass = devVal > 100;
  rc014Detail = `Development backlog: ${devVal} (threshold: >100)`;
}
console.log(`RC-014: WS1/WS5 cross-regression guard .. ${rc014Pass ? 'PASS' : 'FAIL'}`);
console.log(`  ${rc014Detail}`);
console.log();
results.push({ id: 'RC-014', name: 'WS1/WS5 cross-regression guard', pass: rc014Pass, detail: rc014Detail });

// ── Summary data for report ──
const escKpiQuery = await kpiPool.query(`
  SELECT ${kpiCol} AS kpi, ${valCol} AS val, CAST(${dateCol} AS DATE) AS snap_date
  FROM ${tbl}
  WHERE (${kpiCol} LIKE '%escalat%' OR ${kpiCol} LIKE '%reject%' OR ${kpiCol} LIKE '%accuracy%')
    AND CAST(${dateCol} AS DATE) = (
      SELECT MAX(CAST(${dateCol} AS DATE)) FROM ${tbl} WHERE ${kpiCol} LIKE '%escalat%'
    )
  ORDER BY ${kpiCol}
`);
console.log('--- Latest escalation KPI snapshot ---');
for (const r of escKpiQuery.recordset) {
  const d = typeof r.snap_date === 'object' ? r.snap_date.toISOString().slice(0,10) : String(r.snap_date).slice(0,10);
  console.log(`  ${r.kpi}: ${r.val} (${d})`);
}
console.log();

const srcQuery = await nova.query(`
  SELECT source, COUNT(*) AS cnt FROM escalation_log GROUP BY source ORDER BY cnt DESC
`);
console.log('--- Escalation log source breakdown ---');
for (const r of srcQuery.recordset) {
  console.log(`  ${r.source}: ${r.cnt}`);
}
console.log();

// OVERALL
const allPass = results.every(r => r.pass);
console.log('='.repeat(60));
console.log(`OVERALL: ${allPass ? 'PASS' : 'FAIL'} (${results.filter(r => r.pass).length}/${results.length} checks passed)`);
console.log('='.repeat(60));

await kpiPool.close();
await nova.close();
process.exit(allPass ? 0 : 1);
