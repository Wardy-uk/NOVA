const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: 'bym-asqlep01.database.windows.net',
    database: 'NOVA',
    user: 'nova_app',
    password: 'Alchemy123/',
    options: { encrypt: true, trustServerCertificate: false },
  });

  // Check if table exists
  const tables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'agent_availability'
  `);
  console.log('Table exists:', tables.recordset.length > 0);

  // Check today's entries
  const rows = await pool.request().query(`
    SELECT * FROM agent_availability WHERE available_date = '2026-05-13' ORDER BY roster_id
  `);
  console.log(`\nEntries for today: ${rows.recordset.length}`);
  for (const r of rows.recordset) {
    console.log(`  roster_id=${r.roster_id} status=${r.status} reason=${r.reason} updated=${r.updated_at}`);
  }

  // Check all entries
  const all = await pool.request().query(`
    SELECT COUNT(*) as total FROM agent_availability
  `);
  console.log(`\nTotal entries in table: ${all.recordset[0].total}`);

  // Recent entries
  const recent = await pool.request().query(`
    SELECT TOP 10 * FROM agent_availability ORDER BY updated_at DESC
  `);
  console.log('\nMost recent entries:');
  for (const r of recent.recordset) {
    console.log(`  roster_id=${r.roster_id} date=${r.available_date?.toISOString().slice(0,10)} status=${r.status} reason=${r.reason} updated=${r.updated_at}`);
  }

  await pool.close();
}

main().catch(console.error);
