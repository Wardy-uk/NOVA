const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=TechSupportJSM;User Id=azureadmin;Password=Bl45t3r!;Encrypt=true;TrustServerCertificate=true;');

  try {
    const r = await p.query("SELECT TOP 3 LogId, TicketKey, ErrorStage, ProcessedBy FROM dbo.AbuseReportAutomationLog ORDER BY LogId DESC");
    console.log('FOUND AbuseReportAutomationLog in TechSupportJSM!');
    r.recordset.forEach(x => console.log(`  LogId=${x.LogId} Ticket=${x.TicketKey} Stage=${x.ErrorStage} By=${x.ProcessedBy}`));
  } catch (e) {
    console.log('Not found: ' + e.message.substring(0, 150));
  }

  // Also list columns
  try {
    const r = await p.query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AbuseReportAutomationLog' ORDER BY ORDINAL_POSITION");
    if (r.recordset.length > 0) {
      console.log('\nColumns:');
      r.recordset.forEach(x => console.log(`  ${x.COLUMN_NAME} (${x.DATA_TYPE})`));
    }
  } catch (e) {}

  await p.close();
})().catch(e => console.error(e.message));
