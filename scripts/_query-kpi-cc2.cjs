const sql = require('mssql');

(async () => {
  const nova = await sql.connect('Server=bym-asqlep01.database.windows.net;Database=NOVA;User Id=nova_app;Password=Alchemy123/;Encrypt=true;TrustServerCertificate=true;');
  const creds = await nova.query("SELECT [key], value FROM settings WHERE [key] LIKE 'kpi_sql%'");
  const cfg = {};
  creds.recordset.forEach(r => cfg[r.key] = r.value);
  await nova.close();
  cfg.kpi_sql_password = cfg.kpi_sql_password || 'Bl45t3r!';

  const kpi = await new sql.ConnectionPool({
    server: cfg.kpi_sql_server, database: cfg.kpi_sql_database,
    user: cfg.kpi_sql_user, password: cfg.kpi_sql_password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();

  // Get the 15/05 ratios (last good day from n8n)
  const baseline = await kpi.query(`
    SELECT kpi, [count] FROM dbo.jira_kpi_daily
    WHERE CAST(CreatedAt AS DATE) = '2026-05-15'
    AND kpi IN (
      'Number of Tickets in CC (Incidents)',
      'Number of Tickets in CC (Service Requests)',
      'Number of Tickets in CC (TPJ)',
      'Number of Tickets With No Reply in CC (Incidents)',
      'Number of Tickets With No Reply in CC (Service Requests)',
      'Number of Tickets With No Reply in CC (TPJ)'
    )
  `);
  console.log('=== 15/05 Baseline (last n8n day) ===');
  baseline.recordset.forEach(r => console.log(`  ${r.kpi}: ${r.count}`));

  // Get the bad days data
  const bad = await kpi.query(`
    SELECT CAST(CreatedAt AS DATE) as dt, kpi, [count] FROM dbo.jira_kpi_daily
    WHERE CAST(CreatedAt AS DATE) IN ('2026-05-16', '2026-05-17', '2026-05-18')
    AND (kpi LIKE 'Number of Tickets in CC%' OR kpi LIKE 'Number of Tickets With No Reply in CC%'
      OR kpi LIKE 'CC%Volume%' OR kpi LIKE 'CC%No Reply%')
    ORDER BY dt, kpi
  `);
  console.log('\n=== Bad days (16-18 May) ===');
  let d = '';
  for (const r of bad.recordset) {
    const dd = r.dt.toISOString().slice(0, 10);
    if (dd !== d) { d = dd; console.log(`\n--- ${dd} ---`); }
    console.log(`  ${r.kpi}: ${r.count}`);
  }

  // Calculate ratios from 15/05
  const b = {};
  baseline.recordset.forEach(r => b[r.kpi] = r.count);
  const totalVol = (b['Number of Tickets in CC (Incidents)'] || 0) +
    (b['Number of Tickets in CC (Service Requests)'] || 0) +
    (b['Number of Tickets in CC (TPJ)'] || 0);
  const incRatio = (b['Number of Tickets in CC (Incidents)'] || 0) / totalVol;
  const srRatio = (b['Number of Tickets in CC (Service Requests)'] || 0) / totalVol;
  const tpjRatio = (b['Number of Tickets in CC (TPJ)'] || 0) / totalVol;

  console.log(`\n=== 15/05 Ratios ===`);
  console.log(`  Incidents: ${(incRatio * 100).toFixed(1)}%`);
  console.log(`  Service Requests: ${(srRatio * 100).toFixed(1)}%`);
  console.log(`  TPJ: ${(tpjRatio * 100).toFixed(1)}%`);
  console.log(`  Total: ${totalVol}`);

  // Estimate corrections for 17/05 and 18/05
  for (const date of ['2026-05-17', '2026-05-18']) {
    const row = bad.recordset.find(r => r.dt.toISOString().slice(0, 10) === date && r.kpi === 'Number of Tickets in CC (Incidents)');
    if (row) {
      const total = row.count;
      console.log(`\n=== Estimated correction for ${date} (total CC = ${total}) ===`);
      console.log(`  CC (Incidents): ${Math.round(total * incRatio)} (was ${total})`);
      console.log(`  CC (Service Requests): ${Math.round(total * srRatio)} (was 0)`);
      console.log(`  CC (TPJ): ${Math.round(total * tpjRatio)} (was 0)`);
    }
  }

  // 16/05 uses different KPI names
  const vol16 = bad.recordset.find(r => r.dt.toISOString().slice(0, 10) === '2026-05-16' && r.kpi.includes('Volume') && r.kpi.includes('Incidents'));
  if (vol16) {
    const total = vol16.count;
    console.log(`\n=== Estimated correction for 2026-05-16 (total CC = ${total}, from "Volume" naming) ===`);
    console.log(`  CC (Incidents): ${Math.round(total * incRatio)} (was ${total})`);
    console.log(`  CC (Service Requests): ${Math.round(total * srRatio)} (was 0)`);
    console.log(`  CC (TPJ): ${Math.round(total * tpjRatio)} (was 0)`);
  }

  await kpi.close();
})().catch(e => console.error('Error:', e.message));
