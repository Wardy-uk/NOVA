#!/usr/bin/env node
/**
 * Backfill jira_agent_kpi_daily for the Apr 17-22 gap.
 *
 * The NOVA KPI pipeline was writing to UAT tables instead of live due to a
 * missing kpi_pipeline_target setting. This script reconstructs what it can:
 *
 * - Agent roster (AgentId, Name, Tier, Team) from the Agent table
 * - SolvedTickets_Today from Jira resolved dates
 * - QA/GR columns are enriched at query time so don't need backfilling
 * - Open ticket counts are point-in-time and unrecoverable (set to 0)
 *
 * Run: node scripts/backfill-agent-kpi-gap.mjs [--dry-run]
 */

import sql from 'mssql';

const DRY_RUN = process.argv.includes('--dry-run');
const GAP_START = '2026-04-17';
const GAP_END = '2026-04-22'; // inclusive

const KPI_CONFIG = {
  server: process.env.KPI_SQL_SERVER || 'bym-asqlep01.database.windows.net',
  database: process.env.KPI_SQL_DATABASE || 'TechSupportJSM',
  user: process.env.KPI_SQL_USER,
  password: process.env.KPI_SQL_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 30000,
};

// Jira via Cloud ID (new /search/jql GET endpoint)
// Set env vars: JIRA_CLOUD_ID, JIRA_EMAIL, JIRA_TOKEN
const JIRA_CLOUD_ID = process.env.JIRA_CLOUD_ID;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_TOKEN;
if (!JIRA_CLOUD_ID || !JIRA_EMAIL || !JIRA_TOKEN) {
  console.error('Required env vars: JIRA_CLOUD_ID, JIRA_EMAIL, JIRA_TOKEN');
  process.exit(1);
}
const JIRA_BASE = `https://api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}`;
const JIRA_AUTH = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

async function jqlAssigneeCounts(jql) {
  const all = [];
  let startAt = 0;
  while (true) {
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=200&startAt=${startAt}&fields=assignee`;
    const res = await fetch(url, {
      headers: { Authorization: JIRA_AUTH, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`  JQL failed (${res.status}): ${text.slice(0, 100)}`);
      return {};
    }
    const json = await res.json();
    const issues = json.issues ?? [];
    all.push(...issues);
    if (json.isLast !== false || issues.length === 0) break;
    startAt += issues.length;
  }
  const counts = {};
  for (const issue of all) {
    const name = issue.fields?.assignee?.displayName ?? 'Unassigned';
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function dateRange(start, end) {
  const dates = [];
  const d = new Date(start);
  const e = new Date(end);
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function nextDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`=== Agent KPI Gap Backfill (${GAP_START} to ${GAP_END}) ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log();

  const pool = await new sql.ConnectionPool(KPI_CONFIG).connect();

  // Get active agents (full name = AgentName + AgentSurname)
  const agentResult = await pool.request().query(
    "SELECT AgentId, RTRIM(AgentName + ' ' + ISNULL(AgentSurname, '')) AS AgentName, TierCode, Team FROM dbo.Agent WHERE IsActive = 1"
  );
  const agents = agentResult.recordset;
  console.log(`Found ${agents.length} active agents`);

  // Check which dates already have data
  const existingResult = await pool.request().query(`
    SELECT DISTINCT CONVERT(VARCHAR(10), ReportDate, 120) as d
    FROM dbo.jira_agent_kpi_daily
    WHERE ReportDate >= '${GAP_START}' AND ReportDate <= '${GAP_END}'
  `);
  const existingDates = new Set(existingResult.recordset.map(r => r.d));
  console.log(`Existing data for dates: ${existingDates.size > 0 ? [...existingDates].join(', ') : 'none'}`);

  const dates = dateRange(GAP_START, GAP_END);
  let totalInserted = 0;

  for (const date of dates) {
    if (existingDates.has(date)) {
      console.log(`\n${date}: already has data, skipping`);
      continue;
    }

    console.log(`\n${date}: backfilling...`);

    // Get resolved ticket counts per agent from Jira
    const jql = `project = NT AND resolved >= "${date}" AND resolved < "${nextDay(date)}"`;
    const resolvedCounts = await jqlAssigneeCounts(jql);
    const total = Object.values(resolvedCounts).reduce((a, b) => a + b, 0);
    console.log(`  Jira: ${total} tickets resolved by ${Object.keys(resolvedCounts).length} agents`);

    for (const agent of agents) {
      const solved = resolvedCounts[agent.AgentName] ?? 0;

      if (DRY_RUN) {
        if (solved > 0) console.log(`  [DRY] Would insert ${agent.AgentName}: solved=${solved}`);
        totalInserted++;
        continue;
      }

      const req = pool.request();
      req.input('reportDate', sql.Date, date);
      req.input('agentId', sql.Int, agent.AgentId);
      req.input('agentName', sql.NVarChar, agent.AgentName);
      req.input('tierCode', sql.NVarChar, agent.TierCode || '');
      req.input('team', sql.NVarChar, agent.Team || '');
      req.input('solvedToday', sql.Int, solved);

      await req.query(`
        INSERT INTO dbo.jira_agent_kpi_daily
          (ReportDate, AgentId, AgentName, TierCode, Team,
           OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
           SolvedTickets_Today, SolvedTickets_ThisWeek, CreatedAt)
        VALUES (@reportDate, @agentId, @agentName, @tierCode, @team,
                0, 0, 0, @solvedToday, 0, GETUTCDATE())
      `);
      totalInserted++;
    }

    if (!DRY_RUN) {
      console.log(`  Inserted ${agents.length} rows`);
    }
  }

  console.log(`\n=== Done: ${totalInserted} rows ${DRY_RUN ? 'would be inserted' : 'inserted'} ===`);

  // Verify
  if (!DRY_RUN) {
    const verify = await pool.request().query(`
      SELECT CONVERT(VARCHAR(10), ReportDate, 120) as day, COUNT(*) as agents,
             SUM(SolvedTickets_Today) as totalSolved
      FROM dbo.jira_agent_kpi_daily
      WHERE ReportDate >= '${GAP_START}' AND ReportDate <= '${GAP_END}'
      GROUP BY CONVERT(VARCHAR(10), ReportDate, 120)
      ORDER BY day
    `);
    console.log('\nVerification:');
    console.table(verify.recordset);
  }

  await pool.close();
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
