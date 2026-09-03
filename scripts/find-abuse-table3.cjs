const sql = require('mssql');
(async () => {
  // Try the Azure SQL server (NOVA's DB server)
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');

  // Check if it's in NOVA database
  try {
    const r = await p.query("SELECT TOP 1 LogId FROM dbo.AbuseReportAutomationLog");
    console.log('FOUND in NOVA! LogId=' + r.recordset[0]?.LogId);
  } catch (e) {
    console.log('Not in NOVA: ' + e.message.substring(0, 120));
  }

  // List all tables containing 'abuse' (case insensitive)
  try {
    const r = await p.query("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%abuse%' OR TABLE_NAME LIKE '%Abuse%'");
    console.log('\nTables matching "abuse" in NOVA:');
    r.recordset.forEach(x => console.log(`  ${x.TABLE_SCHEMA}.${x.TABLE_NAME}`));
    if (r.recordset.length === 0) console.log('  (none)');
  } catch (e) {
    console.log('Search error: ' + e.message);
  }

  // Also check what other databases exist on this Azure server
  try {
    const r = await p.query("SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb') ORDER BY name");
    console.log('\nDatabases on bym-asqlep01:');
    r.recordset.forEach(x => console.log('  ' + x.name));
  } catch (e) {
    console.log('Cannot list databases: ' + e.message.substring(0, 100));
  }

  await p.close();
})().catch(e => console.error(e.message));
