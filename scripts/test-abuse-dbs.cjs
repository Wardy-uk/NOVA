const sql = require('mssql');
(async () => {
  // Test 1: Abuse Report Log DB (TechSupportJSM on Azure SQL)
  console.log('=== Testing abuse_report_db_connection ===');
  try {
    const p1 = await new sql.ConnectionPool('Server=bym-asqlep01.database.windows.net;Database=TechSupportJSM;User Id=azureadmin;Password=Bl45t3r!;Encrypt=true;TrustServerCertificate=true;').connect();
    const r1 = await p1.query("SELECT COUNT(*) as cnt FROM dbo.AbuseReportAutomationLog");
    console.log(`OK - AbuseReportAutomationLog has ${r1.recordset[0].cnt} rows`);
    // Test INSERT would work (dry run via column check)
    const cols = await p1.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='AbuseReportAutomationLog' AND COLUMN_NAME IN ('TicketKey','AbuseEmail','InstanceId','ContactId','InstanceUrl','ProcessedBy','ErrorStage')");
    console.log(`INSERT columns available: ${cols.recordset.map(c => c.COLUMN_NAME).join(', ')}`);
    await p1.close();
  } catch (e) {
    console.log('FAILED:', e.message);
  }

  // Test 2: Admin DB (BYM-ASQLConfig on-prem)
  console.log('\n=== Testing abuse_report_admin_db_connection ===');
  try {
    const p2 = await new sql.ConnectionPool({
      server: 'BYM-ASQLConfig.bym.local',
      database: 'Admin',
      user: 'ReportRunner',
      password: 'R3d Bull',
      options: { encrypt: false, trustServerCertificate: true },
      requestTimeout: 15000,
    }).connect();
    // Check ProcessAbuseReport SP exists and we can call it
    const r2 = await p2.query("SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_NAME='ProcessAbuseReport'");
    console.log(`OK - ProcessAbuseReport SP: ${r2.recordset.length > 0 ? 'EXISTS' : 'NOT FOUND'}`);
    // Check SP parameters
    const params = await p2.query("SELECT PARAMETER_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_NAME='ProcessAbuseReport' ORDER BY ORDINAL_POSITION");
    console.log(`SP params: ${params.recordset.map(p => `${p.PARAMETER_NAME} (${p.DATA_TYPE})`).join(', ')}`);
    await p2.close();
  } catch (e) {
    console.log('FAILED:', e.message);
  }
})().catch(e => console.error(e.message));
