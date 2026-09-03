const sql = require('mssql');
(async () => {
  const p = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');
  const r = await p.query("SELECT [key], LEFT(ISNULL(value, 'NULL'), 120) v FROM settings WHERE [key] LIKE 'agent[_]%' OR [key] LIKE 'abuse[_]%' ORDER BY [key]");
  r.recordset.forEach(x => console.log(x.key.padEnd(50) + x.v));
  await p.close();
})().catch(e => console.error(e.message));
