const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=techservicesjsm;User Id=claude_readonly;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');

  // Search for abuse/automation tables
  const r = await p.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%abuse%' OR TABLE_NAME LIKE '%Abuse%' OR TABLE_NAME LIKE '%AutomationLog%' ORDER BY TABLE_NAME");
  console.log('techservicesjsm tables matching abuse/AutomationLog:');
  r.recordset.forEach(x => console.log('  ' + x.TABLE_NAME));
  if (r.recordset.length === 0) console.log('  (none)');

  // Try direct query
  try {
    const r2 = await p.query("SELECT TOP 3 LogId, TicketKey, ErrorStage FROM dbo.AbuseReportAutomationLog ORDER BY LogId DESC");
    console.log('\nAbuseReportAutomationLog rows:');
    r2.recordset.forEach(x => console.log(`  LogId=${x.LogId} Ticket=${x.TicketKey} Stage=${x.ErrorStage}`));
  } catch (e) {
    console.log('\nDirect query: ' + e.message.substring(0, 120));
  }

  await p.close();
})().catch(e => console.error(e.message));
