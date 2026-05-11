/**
 * One-off backfill: assign all Open + Unassigned tickets via round-robin.
 *
 * Usage:
 *   node scripts/backfill-unassigned.cjs --dry-run                # preview only
 *   node scripts/backfill-unassigned.cjs --project NT             # assign NT tickets
 *   node scripts/backfill-unassigned.cjs --project NTPJ           # assign NTPJ tickets
 *   node scripts/backfill-unassigned.cjs --project NT --limit 10  # cap at 10
 *
 * Reads creds from settings.json (DATA_DIR or project root).
 * Queries jira_issue_cache for unassigned tickets, then calls Jira REST to assign.
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const settingsPath = path.join(DATA_DIR, 'settings.json');

const DRY_RUN = process.argv.includes('--dry-run');
const projectIdx = process.argv.indexOf('--project');
const PROJECT = projectIdx !== -1 ? process.argv[projectIdx + 1] : 'NT';
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 100;

const POOL_MAP = { NT: 'cc', NTPJ: 'tpj' };

async function main() {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    console.error('Failed to read settings.json:', err.message);
    process.exit(1);
  }

  const server = settings.mssql_server || process.env.MSSQL_SERVER;
  const database = settings.mssql_database || process.env.MSSQL_DATABASE;
  const user = settings.mssql_user || process.env.MSSQL_USER;
  const password = settings.mssql_password || process.env.MSSQL_PASSWORD;
  if (!server || !database || !user || !password) {
    console.error('Missing MSSQL connection details in settings.json or env');
    process.exit(1);
  }

  // Jira creds (same as agent/onboarding client)
  const jiraCloudId = settings.jira_ob_cloud_id;
  const jiraEmail = settings.jira_ob_email;
  const jiraToken = settings.jira_ob_token;
  if (!jiraCloudId || !jiraEmail || !jiraToken) {
    console.error('Missing Jira credentials (jira_ob_cloud_id, jira_ob_email, jira_ob_token) in settings.json');
    process.exit(1);
  }
  const jiraBase = `https://api.atlassian.com/ex/jira/${jiraCloudId}/rest/api/3`;
  const jiraAuth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

  const pool = await sql.connect({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  });

  console.log(`Connected to ${database}`);
  console.log(`Project: ${PROJECT} | Limit: ${LIMIT} | Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // 1. Get unassigned open tickets from cache
  const unassigned = await pool.request()
    .input('project', sql.NVarChar, PROJECT)
    .input('limit', sql.Int, LIMIT)
    .query(`
      SELECT TOP (@limit) c.issue_key, c.summary, c.status_name, c.request_type, c.current_tier,
             c.reporter_display, c.jira_created
      FROM jira_issue_cache c
      WHERE c.assignee_account_id IS NULL
        AND c.status_category != 'done'
        AND (c.current_tier IS NULL OR c.current_tier != 'Development')
        AND c.project_key = @project
      ORDER BY c.jira_created ASC
    `);

  if (unassigned.recordset.length === 0) {
    console.log('No unassigned tickets found. Nothing to do.');
    await pool.close();
    return;
  }
  console.log(`Found ${unassigned.recordset.length} unassigned tickets:\n`);

  // 2. Get agent roster for the target pool
  const targetPool = POOL_MAP[PROJECT] || 'cc';
  const roster = await pool.request()
    .input('pool', sql.NVarChar, targetPool)
    .query(`
      SELECT r.id, r.jira_account_id, r.display_name, r.max_capacity, r.active
      FROM agent_roster r
      WHERE r.pool = @pool AND r.active = 1
      ORDER BY r.display_name
    `);

  if (roster.recordset.length === 0) {
    console.error(`No active agents in pool '${targetPool}'. Cannot assign.`);
    await pool.close();
    process.exit(1);
  }
  console.log(`Agent roster (${targetPool}): ${roster.recordset.map(a => a.display_name).join(', ')}\n`);

  // 3. Get current open ticket counts per agent (for capacity ranking)
  const agents = roster.recordset;
  const agentLoads = new Map();
  for (const agent of agents) {
    try {
      const jql = `project = ${PROJECT} AND assignee = "${agent.jira_account_id}" AND resolution = EMPTY`;
      const countRes = await jiraSearch(jiraBase, jiraAuth, jql, 0);
      agentLoads.set(agent.jira_account_id, countRes.total || 0);
    } catch {
      agentLoads.set(agent.jira_account_id, 0);
    }
  }

  // Sort by load (least loaded first)
  agents.sort((a, b) => {
    const loadA = (agentLoads.get(a.jira_account_id) || 0) / (a.max_capacity || 15);
    const loadB = (agentLoads.get(b.jira_account_id) || 0) / (b.max_capacity || 15);
    return loadA - loadB;
  });

  console.log('Agent loads:');
  for (const a of agents) {
    const load = agentLoads.get(a.jira_account_id) || 0;
    console.log(`  ${a.display_name}: ${load}/${a.max_capacity} tickets (${Math.round(load / (a.max_capacity || 15) * 100)}%)`);
  }
  console.log('');

  // 4. Round-robin assign
  let assignIdx = 0;
  let assigned = 0;
  let failed = 0;

  for (const ticket of unassigned.recordset) {
    const agent = agents[assignIdx % agents.length];
    const load = agentLoads.get(agent.jira_account_id) || 0;

    if (DRY_RUN) {
      console.log(`[DRY RUN] ${ticket.issue_key} → ${agent.display_name} (${load}/${agent.max_capacity})`);
    } else {
      try {
        await jiraAssign(jiraBase, jiraAuth, ticket.issue_key, agent.jira_account_id);
        await jiraComment(jiraBase, jiraAuth, ticket.issue_key,
          `[NOVA Backfill] Auto-assigned to ${agent.display_name} (round-robin backfill, pool: ${targetPool})`);

        // Log in assignment table
        await pool.request()
          .input('ticket', sql.NVarChar, ticket.issue_key)
          .input('pool', sql.NVarChar, targetPool)
          .input('assignedTo', sql.NVarChar, agent.display_name)
          .input('reason', sql.NVarChar, `backfill | ${load}/${agent.max_capacity} tickets`)
          .input('openCount', sql.Int, load)
          .input('project', sql.NVarChar, PROJECT)
          .input('assignReason', sql.NVarChar, 'backfill_sweep')
          .query(`
            INSERT INTO agent_assignment_log (ticket_key, pool, assigned_to, reason, open_ticket_count, project_key, assignment_reason)
            VALUES (@ticket, @pool, @assignedTo, @reason, @openCount, @project, @assignReason)
          `);

        console.log(`✓ ${ticket.issue_key} → ${agent.display_name}`);
        agentLoads.set(agent.jira_account_id, load + 1);
        assigned++;
      } catch (err) {
        console.error(`✗ ${ticket.issue_key} → ${agent.display_name}: ${err.message}`);
        failed++;
      }
    }
    assignIdx++;
  }

  console.log(`\n${DRY_RUN ? 'Would assign' : 'Assigned'}: ${DRY_RUN ? unassigned.recordset.length : assigned}`);
  if (failed > 0) console.log(`Failed: ${failed}`);
  if (DRY_RUN) console.log('\nRe-run without --dry-run to execute.');

  await pool.close();
}

async function jiraSearch(baseUrl, auth, jql, maxResults = 0) {
  const url = `${baseUrl}/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);
  return res.json();
}

async function jiraAssign(baseUrl, auth, issueKey, accountId) {
  const url = `${baseUrl}/issue/${issueKey}/assignee`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira assign ${issueKey} failed: ${res.status} ${text}`);
  }
}

async function jiraComment(baseUrl, auth, issueKey, body) {
  const url = `${baseUrl}/issue/${issueKey}/comment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] },
      properties: [{ key: 'sd.public.comment', value: { internal: true } }],
    }),
  });
  if (!res.ok) {
    console.warn(`  Warning: comment on ${issueKey} failed (${res.status}) — assignment still succeeded`);
  }
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
