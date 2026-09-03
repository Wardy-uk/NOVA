const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=BYM-ASQLConfig.bym.local;Database=master;User Id=ReportRunner;Password=R3d Bull;Encrypt=false;TrustServerCertificate=true;');

  const dbs = ['Admin', 'BYMConfiguration', 'BYMSupport', 'BYMcountrywidePreChange'];

  for (const db of dbs) {
    try {
      const r = await p.query(`SELECT TOP 1 LogId FROM [${db}].dbo.AbuseReportAutomationLog`);
      console.log(`FOUND in ${db}! LogId=${r.recordset[0]?.LogId}`);
    } catch (e) {
      console.log(`${db}: ${e.message.substring(0, 100)}`);
    }
  }

  // Also try sys.objects approach
  for (const db of dbs) {
    try {
      const r = await p.query(`SELECT name FROM [${db}].sys.objects WHERE name = 'AbuseReportAutomationLog' AND type = 'U'`);
      if (r.recordset.length > 0) console.log(`sys.objects FOUND in ${db}`);
    } catch (e) {
      // skip
    }
  }

  await p.close();
})().catch(e => console.error(e.message));
