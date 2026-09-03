// Check agent_availability table for today's entries via NOVA's main MSSQL database
// We need the NOVA SQL connection details from environment or settings
const sql = require('mssql');
const fs = require('fs');

async function main() {
  // Read NOVA settings to get SQL connection
  // Try local settings first, fall back to prod DATA_DIR
  let settings;
  for (const path of ['./settings.json', 'C:\\ProgramData\\NOVA\\settings.json']) {
    try {
      const raw = fs.readFileSync(path, 'utf8');
      settings = JSON.parse(raw).settings || JSON.parse(raw);
      console.log(`Read settings from ${path}`);
      break;
    } catch {}
  }

  // NOVA main DB uses env vars: NOVA_SQL_SERVER, NOVA_SQL_DATABASE, NOVA_SQL_USER, NOVA_SQL_PASSWORD
  // or NOVA_SQL_CONNECTION string
  // Since we don't have those, let's check what the prod env might be
  // For now, let's just check environment
  const server = process.env.NOVA_SQL_SERVER;
  const database = process.env.NOVA_SQL_DATABASE;
  const user = process.env.NOVA_SQL_USER;
  const password = process.env.NOVA_SQL_PASSWORD;

  if (!server) {
    console.log('NOVA_SQL_* env vars not set. Checking if agent_availability is in the KPI database...');
    // Maybe the table is actually in the same KPI database?
    // Let's check the KPI database for this table
    const kpiPool = await sql.connect({
      server: 'bym-asqlep01.database.windows.net',
      database: 'TechSupportJSM',
      user: 'azureadmin',
      password: 'Bl45t3r!',
      options: { encrypt: true, trustServerCertificate: true },
    });

    try {
      const tables = await kpiPool.request().query(`
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE '%availab%' OR TABLE_NAME LIKE '%agent_a%'
      `);
      console.log('Tables matching "availab" or "agent_a" in KPI DB:', tables.recordset);
    } catch (e) {
      console.log('Query failed:', e.message);
    }

    // Also check: what database does NOVA actually use?
    console.log('\nNOVA main database is configured via NOVA_SQL_* env vars on the server.');
    console.log('Without those, we cannot query agent_availability directly.');
    console.log('\nLet me check if there are any rows anyway...');

    try {
      const rows = await kpiPool.request().query(`
        SELECT TOP 5 * FROM agent_availability ORDER BY updated_at DESC
      `);
      console.log('agent_availability rows in KPI DB:', rows.recordset);
    } catch (e) {
      console.log('agent_availability not in KPI DB:', e.message);
    }

    await kpiPool.close();
    return;
  }

  const pool = await sql.connect({ server, database, user, password, options: { encrypt: true, trustServerCertificate: true } });
  const rows = await pool.request().query(`
    SELECT * FROM agent_availability WHERE available_date = '2026-05-13' ORDER BY roster_id
  `);
  console.log(`agent_availability entries for today: ${rows.recordset.length}`);
  for (const r of rows.recordset) {
    console.log(`  roster_id=${r.roster_id} status=${r.status} reason=${r.reason}`);
  }
  await pool.close();
}

main().catch(console.error);
