const sql = require('mssql');

// Ratios from 15/05 (last good n8n day): Incidents=34, SRs=40, TPJ=20, Total=94
const INC_RATIO = 34 / 94;  // 36.2%
const SR_RATIO  = 40 / 94;  // 42.6%
const TPJ_RATIO = 20 / 94;  // 21.3%

// Corrections to apply — derived from the inflated totals
const CORRECTIONS = [
  // 16/05 — different naming convention (orphaned "— Volume" / "— No Reply" rows)
  { date: '2026-05-16', kpi: 'CC (Incidents) — Volume',          was: 153, inc: 55, sr: 65, tpj: 33 },
  { date: '2026-05-16', kpi: 'CC (Incidents) — No Reply',        was: 25,  inc: 9,  sr: 11, tpj: 5  },
  // 17/05
  { date: '2026-05-17', kpi: 'Number of Tickets in CC (Incidents)',          was: 158, inc: 57, sr: 67, tpj: 34 },
  { date: '2026-05-17', kpi: 'Number of Tickets With No Reply in CC (Incidents)', was: 30, inc: 11, sr: 13, tpj: 6 },
  // 18/05
  { date: '2026-05-18', kpi: 'Number of Tickets in CC (Incidents)',          was: 161, inc: 58, sr: 69, tpj: 34 },
  { date: '2026-05-18', kpi: 'Number of Tickets With No Reply in CC (Incidents)', was: 22, inc: 8, sr: 9, tpj: 5 },
];

// Build the full UPDATE list from corrections
function buildUpdates() {
  const updates = [];
  for (const c of CORRECTIONS) {
    const isVolume = c.kpi.includes('Volume');
    const isNoReply = c.kpi.includes('No Reply');

    let incKpi, srKpi, tpjKpi;
    if (c.date === '2026-05-16') {
      // 16/05 uses "— Volume" / "— No Reply" naming
      if (isVolume) {
        incKpi = 'CC (Incidents) — Volume';
        srKpi  = 'CC (Service Requests) — Volume';
        tpjKpi = 'CC (TPJ) — Volume';
      } else {
        incKpi = 'CC (Incidents) — No Reply';
        srKpi  = 'CC (Service Requests) — No Reply';
        tpjKpi = 'CC (TPJ) — No Reply';
      }
    } else {
      // 17-18/05 uses standard naming
      if (isNoReply) {
        incKpi = 'Number of Tickets With No Reply in CC (Incidents)';
        srKpi  = 'Number of Tickets With No Reply in CC (Service Requests)';
        tpjKpi = 'Number of Tickets With No Reply in CC (TPJ)';
      } else {
        incKpi = 'Number of Tickets in CC (Incidents)';
        srKpi  = 'Number of Tickets in CC (Service Requests)';
        tpjKpi = 'Number of Tickets in CC (TPJ)';
      }
    }

    updates.push({ date: c.date, kpi: incKpi, newCount: c.inc, oldCount: c.was });
    updates.push({ date: c.date, kpi: srKpi,  newCount: c.sr,  oldCount: 0 });
    updates.push({ date: c.date, kpi: tpjKpi, newCount: c.tpj, oldCount: 0 });
  }
  return updates;
}

(async () => {
  // Get KPI DB creds
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

  const updates = buildUpdates();
  const dryRun = process.argv.includes('--dry-run');

  console.log(dryRun ? '=== DRY RUN ===' : '=== APPLYING CORRECTIONS ===');
  console.log(`${updates.length} updates to apply\n`);

  let applied = 0;
  for (const u of updates) {
    console.log(`  ${u.date} | ${u.kpi}: ${u.oldCount} → ${u.newCount}`);
    if (!dryRun) {
      const req = kpi.request();
      req.input('date', sql.Date, u.date);
      req.input('kpi', sql.NVarChar(100), u.kpi);
      req.input('newCount', sql.Float, u.newCount);
      const result = await req.query(`
        UPDATE dbo.jira_kpi_daily
        SET [count] = @newCount
        WHERE CAST(CreatedAt AS DATE) = @date AND kpi = @kpi
      `);
      if (result.rowsAffected[0] > 0) {
        applied++;
      } else {
        console.log(`    ⚠ no row matched — skipped`);
      }
    }
  }

  if (!dryRun) {
    console.log(`\n✓ ${applied}/${updates.length} rows updated`);
  } else {
    console.log(`\nRe-run without --dry-run to apply.`);
  }

  // Verify
  if (!dryRun) {
    console.log('\n=== Verification ===');
    const verify = await kpi.query(`
      SELECT CAST(CreatedAt AS DATE) as dt, kpi, [count]
      FROM dbo.jira_kpi_daily
      WHERE CAST(CreatedAt AS DATE) IN ('2026-05-16', '2026-05-17', '2026-05-18')
        AND (kpi LIKE 'Number of Tickets in CC%' OR kpi LIKE 'Number of Tickets With No Reply in CC%'
          OR kpi LIKE 'CC%Volume%' OR kpi LIKE 'CC%No Reply%')
      ORDER BY dt, kpi
    `);
    let d = '';
    for (const r of verify.recordset) {
      const dd = r.dt.toISOString().slice(0, 10);
      if (dd !== d) { d = dd; console.log(`\n--- ${dd} ---`); }
      console.log(`  ${r.kpi}: ${r.count}`);
    }
  }

  await kpi.close();
})().catch(e => console.error('Error:', e.message));
