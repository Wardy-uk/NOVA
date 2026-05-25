// WS2-C 1st Line Resolution Rate % Regression Check — RC-013a through RC-013e
// Protects against regression from tier-based formula back to request-type-based formula
// Source code checks run locally; DB checks query KPI Azure SQL directly
import sql from 'mssql';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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

console.log(`\nWS2-C 1ST LINE RESOLUTION REGRESSION CHECK — ${today}`);
console.log('='.repeat(60) + '\n');

// ── RC-013b & RC-013c: Source code checks (no DB needed) ──
const pipelinePath = path.resolve('src/server/services/kpi-pipeline.ts');
let pipelineSource = '';
try {
  pipelineSource = fs.readFileSync(pipelinePath, 'utf-8');
} catch (e) {
  console.error(`ERROR: Cannot read ${pipelinePath}: ${e.message}`);
  process.exit(2);
}

// RC-013b: 1st Line numerator uses classifyTier, not ccRequestTypes
const firstLineAssignmentMatch = pipelineSource.match(/const firstLineResolved\s*=\s*(.+)/);
let rc013bPass = false;
let rc013bDetail = '';
if (!firstLineAssignmentMatch) {
  rc013bDetail = 'Cannot find firstLineResolved assignment in kpi-pipeline.ts';
} else {
  const line = firstLineAssignmentMatch[1];
  const usesClassifyTier = line.includes('classifyTier');
  const usesCcRequestTypes = line.includes('ccRequestTypes');
  if (usesClassifyTier && !usesCcRequestTypes) {
    rc013bPass = true;
    rc013bDetail = 'Formula uses classifyTier(), not ccRequestTypes — correct';
  } else if (usesCcRequestTypes) {
    rc013bDetail = `REGRESSION: firstLineResolved uses ccRequestTypes — reverted to old formula`;
  } else {
    rc013bDetail = `Unexpected formula: ${line.slice(0, 80)}`;
  }
}
console.log(`RC-013b: Tier-based formula in code ...... ${rc013bPass ? 'PASS' : 'FAIL'}`);
console.log(`  ${rc013bDetail}`);
console.log();
results.push({ id: 'RC-013b', name: 'Tier-based formula in code', pass: rc013bPass, detail: rc013bDetail });

// RC-013c: classifyTier function exists and maps customer care correctly
const classifyTierMatch = pipelineSource.match(/function classifyTier\(.*?\)\s*(?::\s*\w+\s*)?\{[\s\S]*?\}/);
const tierMapMatch = pipelineSource.match(/const TIER_MAP[^=]*=\s*\{([\s\S]*?)\}/);
let rc013cPass = false;
let rc013cDetail = '';
if (!classifyTierMatch) {
  rc013cDetail = 'classifyTier() function not found in kpi-pipeline.ts';
} else if (!tierMapMatch) {
  rc013cDetail = 'TIER_MAP constant not found in kpi-pipeline.ts';
} else {
  const tierMapBody = tierMapMatch[1];
  const hasCustomerCare = tierMapBody.includes("'customer care'") && tierMapBody.includes("'Customer Care'");
  if (hasCustomerCare) {
    rc013cPass = true;
    rc013cDetail = 'classifyTier() exists, TIER_MAP maps customer care → Customer Care';
  } else {
    rc013cDetail = 'TIER_MAP found but missing customer care mapping';
  }
}
console.log(`RC-013c: classifyTier exists & correct ... ${rc013cPass ? 'PASS' : 'FAIL'}`);
console.log(`  ${rc013cDetail}`);
console.log();
results.push({ id: 'RC-013c', name: 'classifyTier exists & correct', pass: rc013cPass, detail: rc013cDetail });

// ── DB checks: connect to NOVA (settings) then KPI DB ──
const nova = await sql.connect({
  ...parseCS(process.env.NOVA_SQL_CONNECTION),
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 120000
});

const credRows = await nova.query(`
  SELECT [key], value FROM settings
  WHERE [key] IN ('kpi_sql_server','kpi_sql_database','kpi_sql_user','kpi_sql_password')
`);
const kpiConf = {};
credRows.recordset.forEach(r => kpiConf[r.key] = r.value);
const kpiServer = kpiConf.kpi_sql_server || 'bym-asqlep01.database.windows.net';
const kpiDatabase = kpiConf.kpi_sql_database || 'TechSupportJSM';
const kpiUser = kpiConf.kpi_sql_user || 'azureadmin';

// Password: try settings DB → KPI_SQL_PASSWORD env → SSH-fetched value
let kpiPassword = kpiConf.kpi_sql_password || process.env.KPI_SQL_PASSWORD;
if (!kpiPassword) {
  // Attempt to read from prod settings via SSH (grep for the password line)
  try {
    const { execSync } = await import('child_process');
    const sshOut = execSync(
      `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 claude-debug@100.118.199.1 "findstr kpi_sql_password C:\\ProgramData\\NOVA\\settings.json"`,
      { timeout: 15000, encoding: 'utf-8' }
    ).trim();
    const match = sshOut.match(/"kpi_sql_password"\s*:\s*"([^"]+)"/);
    if (match) kpiPassword = match[1];
  } catch { /* SSH unavailable */ }
}
if (!kpiPassword) { console.error('ERROR: No KPI SQL password available (settings DB, env, or SSH)'); process.exit(2); }

const kpiPool = await new sql.ConnectionPool({
  server: kpiServer, database: kpiDatabase, user: kpiUser, password: kpiPassword,
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 120000
}).connect();
console.log(`KPI DB: ${kpiServer} / ${kpiDatabase}`);

// Discover KPI table/column names
const tblResult = await kpiPool.query(`
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'jira_kpi_daily%'
`);
const tblNames = tblResult.recordset.map(r => r.TABLE_NAME);
const tbl = tblNames.includes('jira_kpi_daily') ? 'jira_kpi_daily' : tblNames[0] || 'jira_kpi_daily';

const colResult = await kpiPool.query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tbl}'
`);
const cols = colResult.recordset.map(r => r.COLUMN_NAME);
const kpiCol = cols.includes('kpi') ? 'kpi' : 'kpi_name';
const valCol = cols.includes('count') ? 'count' : cols.includes('value') ? 'value' : 'kpi_value';
const dateCol = cols.includes('createdAt') ? 'createdAt' : cols.includes('CreatedAt') ? 'CreatedAt' : 'createdAt';
const grpCol = cols.includes('kpiGroup') ? 'kpiGroup' : cols.includes('kpi_group') ? 'kpi_group' : 'kpiGroup';
console.log(`KPI table: ${tbl}, columns: kpi=${kpiCol}, val=${valCol}, date=${dateCol}, grp=${grpCol}\n`);

// Get latest date in KPI DB
const todayResult = await kpiPool.query(`
  SELECT MAX(CAST(${dateCol} AS DATE)) AS latest FROM ${tbl}
`);
const latestDate = todayResult.recordset[0].latest;
const latestStr = typeof latestDate === 'object' ? latestDate.toISOString().slice(0,10) : String(latestDate).slice(0,10);
console.log(`Latest KPI date in DB: ${latestStr}\n`);

// ── RC-013a: 1st Line Resolution Rate % exists in Derived group ──
const firstLineQuery = await kpiPool.query(`
  SELECT ${kpiCol} AS kpi, ${valCol} AS val, ${grpCol} AS grp
  FROM ${tbl}
  WHERE CAST(${dateCol} AS DATE) = '${latestStr}'
    AND ${kpiCol} LIKE '%1st Line%'
`);
let rc013aPass = false;
let rc013aDetail = '';
if (firstLineQuery.recordset.length === 0) {
  rc013aDetail = 'No 1st Line Resolution Rate % row found for latest date';
} else {
  const row = firstLineQuery.recordset[0];
  const inDerived = (row.grp || '').toLowerCase().includes('derived');
  if (inDerived) {
    rc013aPass = true;
    rc013aDetail = `1st Line Resolution Rate % = ${row.val} in group '${row.grp}'`;
  } else {
    rc013aDetail = `1st Line exists but in wrong group: '${row.grp}' (expected Derived)`;
  }
}
console.log(`RC-013a: 1st Line exists in Derived ...... ${rc013aPass ? 'PASS' : 'FAIL'}`);
console.log(`  ${rc013aDetail}`);
console.log();
results.push({ id: 'RC-013a', name: '1st Line exists in Derived group', pass: rc013aPass, detail: rc013aDetail });

// ── RC-013d: All 4 derived KPIs present ──
const derivedQuery = await kpiPool.query(`
  SELECT ${kpiCol} AS kpi, ${valCol} AS val
  FROM ${tbl}
  WHERE CAST(${dateCol} AS DATE) = '${latestStr}'
    AND ${grpCol} = 'Derived'
  ORDER BY ${kpiCol}
`);
const derivedKpis = derivedQuery.recordset.map(r => r.kpi);
const expectedPrefixes = ['1st Line', 'Bug Escalation', 'CSAT', 'FCR'];
const missingDerived = expectedPrefixes.filter(prefix => !derivedKpis.some(k => k.includes(prefix)));
let rc013dPass = derivedKpis.length >= 4 && missingDerived.length === 0;
let rc013dDetail = '';
if (rc013dPass) {
  rc013dDetail = `All 4 derived KPIs present: ${derivedKpis.join(', ')}`;
} else {
  rc013dDetail = `Found ${derivedKpis.length} derived KPIs. Missing: ${missingDerived.join(', ') || 'none — but count < 4'}`;
}
console.log(`RC-013d: All 4 derived KPIs present ...... ${rc013dPass ? 'PASS' : 'FAIL'}`);
console.log(`  ${rc013dDetail}`);
console.log();
results.push({ id: 'RC-013d', name: 'All 4 derived KPIs present', pass: rc013dPass, detail: rc013dDetail });

console.log('--- Derived KPI snapshot ---');
for (const r of derivedQuery.recordset) {
  console.log(`  ${r.kpi}: ${r.val}`);
}
console.log();

// ── RC-013e: No regression to trusted WS1/WS2-A/WS5 families ──
const trustedQuery = await kpiPool.query(`
  SELECT ${kpiCol} AS kpi, ${valCol} AS val, ${grpCol} AS grp
  FROM ${tbl}
  WHERE CAST(${dateCol} AS DATE) = '${latestStr}'
    AND (
      ${kpiCol} IN ('Open Tickets', 'Unassigned', 'New Tickets Today', 'Tickets Solved Today', 'Waiting on Requestor')
      OR ${kpiCol} LIKE '%escalated to%'
      OR ${kpiCol} LIKE 'SLA Breached%'
      OR ${kpiCol} LIKE 'FRT Compliance%'
      OR ${kpiCol} LIKE 'Resolution Compliance%'
    )
  ORDER BY ${grpCol}, ${kpiCol}
`);

const ws1Count = trustedQuery.recordset.filter(r => ['Open Tickets', 'Unassigned', 'New Tickets Today', 'Tickets Solved Today', 'Waiting on Requestor'].includes(r.kpi)).length;
const escCount = trustedQuery.recordset.filter(r => r.kpi.includes('escalated to')).length;
const slaCount = trustedQuery.recordset.filter(r => r.kpi.includes('SLA Breached') || r.kpi.includes('Compliance')).length;

let rc013ePass = ws1Count >= 5 && escCount >= 3 && slaCount >= 3;
let rc013eDetail = `WS1: ${ws1Count}/5, Escalation: ${escCount}/3, SLA: ${slaCount}/3`;
console.log(`RC-013e: Trusted family cross-check ..... ${rc013ePass ? 'PASS' : 'FAIL'}`);
console.log(`  ${rc013eDetail}`);
console.log();
results.push({ id: 'RC-013e', name: 'Trusted family cross-check', pass: rc013ePass, detail: rc013eDetail });

console.log('--- Trusted family snapshot ---');
for (const r of trustedQuery.recordset) {
  console.log(`  [${r.grp}] ${r.kpi}: ${r.val}`);
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
