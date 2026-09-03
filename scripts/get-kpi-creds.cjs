const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');
  const r = await p.query("SELECT [key], value FROM settings WHERE [key] IN ('kpi_sql_server','kpi_sql_database','kpi_sql_user','kpi_sql_password')");
  r.recordset.forEach(x => {
    const v = x.key === 'kpi_sql_password' ? '***' : x.value;
    console.log(`${x.key} = ${v}`);
  });
  await p.close();
})().catch(e => console.error(e.message));
