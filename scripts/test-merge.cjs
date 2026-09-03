// Test the MERGE upsert against the NOVA database
const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: 'bym-asqlep01.database.windows.net',
    database: 'NOVA',
    user: 'nova_app',
    password: 'Alchemy123/',
    options: { encrypt: true, trustServerCertificate: false },
  });

  // Test 1: Simple INSERT first
  console.log('Test 1: Direct INSERT...');
  try {
    const r = await pool.request()
      .input('p0', sql.Int, 13)       // Nathan's AgentId
      .input('p1', sql.NVarChar, '2026-05-13')
      .input('p2', sql.NVarChar, 'sick')
      .input('p3', sql.NVarChar, 'Headache')
      .query(`INSERT INTO agent_availability (roster_id, available_date, status, reason)
              VALUES (@p0, @p1, @p2, @p3)`);
    console.log('  INSERT OK, rowsAffected:', r.rowsAffected);
  } catch (e) {
    console.log('  INSERT failed:', e.message);
  }

  // Check
  const check1 = await pool.request().query(`SELECT * FROM agent_availability WHERE roster_id = 13`);
  console.log('  Rows after insert:', check1.recordset);

  // Clean up
  await pool.request().query(`DELETE FROM agent_availability WHERE roster_id = 13`);

  // Test 2: MERGE statement (same as setAvailability uses)
  console.log('\nTest 2: MERGE statement...');
  try {
    const r = await pool.request()
      .input('p0', sql.Int, 13)
      .input('p1', sql.NVarChar, '2026-05-13')
      .input('p2', sql.NVarChar, 'sick')
      .input('p3', sql.NVarChar, 'Headache')
      .input('p4', sql.Int, 13)
      .input('p5', sql.NVarChar, '2026-05-13')
      .input('p6', sql.NVarChar, 'sick')
      .input('p7', sql.NVarChar, 'Headache')
      .query(`
        MERGE agent_availability AS target
        USING (SELECT @p0 AS roster_id, @p1 AS available_date) AS source
        ON target.roster_id = source.roster_id AND target.available_date = source.available_date
        WHEN MATCHED THEN UPDATE SET status = @p2, reason = @p3, updated_at = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (roster_id, available_date, status, reason) VALUES (@p4, @p5, @p6, @p7);
      `);
    console.log('  MERGE OK, rowsAffected:', r.rowsAffected);
  } catch (e) {
    console.log('  MERGE failed:', e.message);
  }

  // Check
  const check2 = await pool.request().query(`SELECT * FROM agent_availability`);
  console.log('  Rows after merge:', check2.recordset);

  // Clean up
  await pool.request().query(`DELETE FROM agent_availability`);
  console.log('  Cleaned up');

  await pool.close();
}

main().catch(console.error);
