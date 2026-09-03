const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');

  // Check abuse_reports table structure
  try {
    const r = await p.query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'abuse_reports' ORDER BY ORDINAL_POSITION");
    console.log('abuse_reports columns:');
    r.recordset.forEach(x => console.log(`  ${x.COLUMN_NAME} (${x.DATA_TYPE})`));
  } catch (e) {
    console.log('Error: ' + e.message);
  }

  // Check all tables with 'abuse' or 'log' in name
  try {
    const r = await p.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%abuse%' OR TABLE_NAME LIKE '%Abuse%' OR TABLE_NAME LIKE '%AutomationLog%' ORDER BY TABLE_NAME");
    console.log('\nAll matching tables:');
    r.recordset.forEach(x => console.log('  ' + x.TABLE_NAME));
  } catch (e) {
    console.log('Error: ' + e.message);
  }

  // Also check techservicesjsm database if it exists
  try {
    const p2 = await new sql.ConnectionPool('Server=bym-asqlep01.database.windows.net;Database=techservicesjsm;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;').connect();
    const r = await p2.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%abuse%' OR TABLE_NAME LIKE '%Abuse%' OR TABLE_NAME LIKE '%AutomationLog%' ORDER BY TABLE_NAME");
    console.log('\ntechservicesjsm matching tables:');
    r.recordset.forEach(x => console.log('  ' + x.TABLE_NAME));

    // Also check if AbuseReportAutomationLog exists
    try {
      const r2 = await p2.query("SELECT TOP 1 LogId FROM dbo.AbuseReportAutomationLog");
      console.log('FOUND AbuseReportAutomationLog in techservicesjsm! LogId=' + r2.recordset[0]?.LogId);
    } catch (e2) {
      console.log('AbuseReportAutomationLog in techservicesjsm: ' + e2.message.substring(0, 100));
    }
    await p2.close();
  } catch (e) {
    console.log('\ntechservicesjsm: ' + e.message.substring(0, 120));
  }

  await p.close();
})().catch(e => console.error(e.message));
