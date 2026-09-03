const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');
  const r = await p.query("SELECT [key], LEFT(ISNULL(value, 'NULL'), 120) v FROM settings WHERE [key] LIKE 'kpi%' OR [key] LIKE 'abuse%' OR [key] LIKE '%sql%' ORDER BY [key]");
  r.recordset.forEach(x => console.log(x.key.padEnd(50) + x.v));
  if (r.recordset.length === 0) console.log('(no matching settings found)');
  await p.close();
})().catch(e => console.error(e.message));
