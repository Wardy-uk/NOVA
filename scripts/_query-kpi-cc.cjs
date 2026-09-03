const sql = require('mssql');

(async () => {
  // First get KPI creds from NOVA DB
  const nova = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');
  const creds = await nova.query("SELECT [key], value FROM settings WHERE [key] LIKE 'kpi_sql%'");
  const cfg = {};
  creds.recordset.forEach(r => cfg[r.key] = r.value);
  await nova.close();

  cfg.kpi_sql_password = cfg.kpi_sql_password || 'Bl45t3r!';
  console.log('Connecting to KPI DB:', cfg.kpi_sql_server, cfg.kpi_sql_database);

  // Connect to KPI DB
  const kpi = await new sql.ConnectionPool({
    server: cfg.kpi_sql_server,
    database: cfg.kpi_sql_database,
    user: cfg.kpi_sql_user,
    password: cfg.kpi_sql_password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();

  // Query CC-related KPIs since 15/05
  const result = await kpi.query(`
    SELECT
      CAST(CreatedAt AS DATE) as dt,
      kpi,
      [count]
    FROM dbo.jira_kpi_daily
    WHERE kpi LIKE '%CC%'
      AND CreatedAt >= '2026-05-15'
    ORDER BY dt, kpi
  `);

  console.log('\n=== CC KPI data since 15/05 ===');
  let currentDate = '';
  for (const row of result.recordset) {
    const d = row.dt.toISOString().slice(0, 10);
    if (d !== currentDate) {
      currentDate = d;
      console.log(`\n--- ${d} ---`);
    }
    console.log(`  ${row.kpi}: ${row.count}`);
  }

  // Also get total Customer Care for context
  const ccTotal = await kpi.query(`
    SELECT
      CAST(CreatedAt AS DATE) as dt,
      kpi,
      [count]
    FROM dbo.jira_kpi_daily
    WHERE kpi LIKE '%Customer Care%'
      AND CreatedAt >= '2026-05-15'
    ORDER BY dt, kpi
  `);

  console.log('\n\n=== Customer Care totals ===');
  currentDate = '';
  for (const row of ccTotal.recordset) {
    const d = row.dt.toISOString().slice(0, 10);
    if (d !== currentDate) {
      currentDate = d;
      console.log(`\n--- ${d} ---`);
    }
    console.log(`  ${row.kpi}: ${row.count}`);
  }

  await kpi.close();
})().catch(e => console.error('Error:', e.message));
