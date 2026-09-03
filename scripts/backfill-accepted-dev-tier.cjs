/**
 * One-off identifier: list tickets that were accepted into development but were
 * never shifted off Tier 3 (pre-fix bug), so they can be moved to
 * CurrentTier = Development.
 *
 * "Was accepted" = dev_review_state.accepted_at IS NOT NULL (set by markAccepted,
 * never cleared — survives the reopen-to-pending side effect of the old bug).
 * Joined against jira_issue_cache for the (near-live) current tier + status so
 * we only flag those still at Tier 3 and not Done.
 *
 * Reads NOVA_SQL_CONNECTION from .env. Read-only — prints the candidate list as
 * JSON; the actual Jira tier change is applied separately via the Atlassian MCP.
 *
 * Usage:  node scripts/backfill-accepted-dev-tier.cjs
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

function loadEnvConn() {
  if (process.env.NOVA_SQL_CONNECTION) return process.env.NOVA_SQL_CONNECTION;
  const envPath = path.join(__dirname, '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^NOVA_SQL_CONNECTION=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error('NOVA_SQL_CONNECTION not found in env or .env');
}

function parseConn(str) {
  const parts = {};
  for (const seg of str.split(';')) {
    const i = seg.indexOf('=');
    if (i === -1) continue;
    parts[seg.slice(0, i).trim().toLowerCase()] = seg.slice(i + 1).trim();
  }
  return {
    server: parts['server'] || parts['data source'],
    database: parts['database'] || parts['initial catalog'],
    user: parts['user id'] || parts['uid'],
    password: parts['password'] || parts['pwd'],
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  };
}

async function main() {
  const pool = await sql.connect(parseConn(loadEnvConn()));

  const rows = await pool.request().query(`
    SELECT s.jira_key, s.status AS nova_status, s.work_item_key, s.accepted_at,
           c.current_tier, c.status_name, c.status_category
    FROM dev_review_state s
    LEFT JOIN jira_issue_cache c ON c.issue_key = s.jira_key
    WHERE s.accepted_at IS NOT NULL
    ORDER BY s.accepted_at ASC
  `);
  await pool.close();

  const all = rows.recordset;
  const candidates = all.filter(r =>
    r.current_tier === 'Tier 3' && (r.status_category || '') !== 'done'
  );

  console.error(`${all.length} accepted ticket(s) in NOVA; ${candidates.length} still at Tier 3 (per cache) and not Done.\n`);
  for (const r of all) {
    const flag = candidates.includes(r) ? 'MOVE ' : 'skip ';
    console.error(`  ${flag}${r.jira_key} | tier=${r.current_tier || '(none)'} | status=${r.status_name || '?'} | wi=${r.work_item_key || '-'}`);
  }
  // Machine-readable list of keys to move, on stdout
  console.log(JSON.stringify(candidates.map(r => r.jira_key)));
}

main().catch((err) => { console.error(err); process.exit(1); });
