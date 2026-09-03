const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');

  // abuse_report_db_connection → TechSupportJSM on Azure SQL (same server as KPIs)
  await p.query(`UPDATE settings SET value = 'Server=bym-asqlep01.database.windows.net;Database=TechSupportJSM;User Id=azureadmin;Password=Bl45t3r!;Encrypt=true;TrustServerCertificate=true' WHERE [key] = 'abuse_report_db_connection'`);
  console.log('Updated abuse_report_db_connection → TechSupportJSM on Azure SQL');

  // abuse_report_admin_db_connection → Admin on BYM-ASQLConfig (on-prem)
  await p.query(`UPDATE settings SET value = 'Server=BYM-ASQLConfig.bym.local;Database=Admin;User Id=ReportRunner;Password=R3d Bull;Encrypt=false;TrustServerCertificate=true' WHERE [key] = 'abuse_report_admin_db_connection'`);
  console.log('Updated abuse_report_admin_db_connection → Admin on BYM-ASQLConfig');

  // Verify
  const r = await p.query("SELECT [key], LEFT(value, 100) v FROM settings WHERE [key] LIKE 'abuse_report%'");
  console.log('\nVerification:');
  r.recordset.forEach(x => console.log(`  ${x.key} = ${x.v}`));

  await p.close();
})().catch(e => console.error(e.message));
