const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=BYM-ASQLConfig.bym.local;Database=master;User Id=ReportRunner;Password=R3d Bull;Encrypt=false;TrustServerCertificate=true;');

  // List all databases
  const dbs = await p.query("SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name");
  console.log('=== Databases ===');
  dbs.recordset.forEach(r => console.log(' ', r.name));

  // Search each database for AbuseReportAutomationLog
  console.log('\n=== Searching for AbuseReportAutomationLog ===');
  for (const db of dbs.recordset) {
    try {
      const r = await p.query(`SELECT TABLE_CATALOG FROM [${db.name}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'AbuseReportAutomationLog'`);
      if (r.recordset.length > 0) {
        console.log(`FOUND in: ${db.name}`);
      }
    } catch (e) {
      // skip inaccessible databases
    }
  }

  // Also check if ProcessAbuseReport SP exists in Admin
  console.log('\n=== Checking ProcessAbuseReport SP ===');
  try {
    const sp = await p.query("SELECT ROUTINE_CATALOG, ROUTINE_NAME FROM [Admin].INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_NAME = 'ProcessAbuseReport'");
    if (sp.recordset.length > 0) console.log('ProcessAbuseReport SP confirmed in: Admin');
    else console.log('ProcessAbuseReport SP NOT found in Admin');
  } catch (e) {
    console.log('Cannot access Admin DB:', e.message);
  }

  await p.close();
})().catch(e => console.error('Connection error:', e.message));
