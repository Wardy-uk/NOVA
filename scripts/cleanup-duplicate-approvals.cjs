/**
 * One-time cleanup: remove duplicate pending approval_queue entries.
 * For each ticket_id with multiple pending rows, keeps the lowest ID and deletes the rest.
 *
 * Usage: node scripts/cleanup-duplicate-approvals.cjs
 * Requires: NOVA settings.json with MSSQL connection details (reads from DATA_DIR or project root)
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const settingsPath = path.join(DATA_DIR, 'settings.json');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) console.log('🔍 DRY RUN — no rows will be deleted\n');
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

  const pool = await sql.connect({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  });

  console.log('Connected to', database);

  // Find tickets with duplicate pending approval_queue entries
  const dupes = await pool.request().query(`
    SELECT ticket_id, COUNT(*) as cnt, MIN(id) as keep_id
    FROM approval_queue
    WHERE status = 'pending'
    GROUP BY ticket_id
    HAVING COUNT(*) > 1
  `);

  if (dupes.recordset.length === 0) {
    console.log('No duplicate pending approvals found. Nothing to clean up.');
    await pool.close();
    return;
  }

  console.log(`Found ${dupes.recordset.length} tickets with duplicate pending approvals:`);
  for (const row of dupes.recordset) {
    console.log(`  ${row.ticket_id}: ${row.cnt} entries (keeping id=${row.keep_id})`);
  }

  if (DRY_RUN) {
    // Show which rows would be deleted
    const toDelete = await pool.request().query(`
      SELECT q.id, q.ticket_id, q.created_at
      FROM approval_queue q
      INNER JOIN (
        SELECT ticket_id, MIN(id) as keep_id
        FROM approval_queue
        WHERE status = 'pending'
        GROUP BY ticket_id
        HAVING COUNT(*) > 1
      ) d ON q.ticket_id = d.ticket_id AND q.id > d.keep_id
      WHERE q.status = 'pending'
    `);
    console.log(`Would delete ${toDelete.recordset.length} rows:`);
    for (const row of toDelete.recordset) {
      console.log(`  id=${row.id}  ticket=${row.ticket_id}  created=${row.created_at}`);
    }
    console.log('\nRe-run without --dry-run to execute.');
  } else {
    // Delete duplicates — keep lowest ID per ticket
    const result = await pool.request().query(`
      DELETE q
      FROM approval_queue q
      INNER JOIN (
        SELECT ticket_id, MIN(id) as keep_id
        FROM approval_queue
        WHERE status = 'pending'
        GROUP BY ticket_id
        HAVING COUNT(*) > 1
      ) d ON q.ticket_id = d.ticket_id AND q.id > d.keep_id
      WHERE q.status = 'pending'
    `);
    console.log(`Deleted ${result.rowsAffected[0]} duplicate pending approval rows.`);
  }
  await pool.close();
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
