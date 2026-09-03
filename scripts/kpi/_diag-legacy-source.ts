#!/usr/bin/env tsx
/**
 * KPX-WP11 diagnostic — READ-ONLY probe of legacy techservicesjsm history tables
 * that are honest backfill sources for the clean-sheet stores. Touches ONLY the
 * n8n-populated, non-forbidden tables jira_kpi_daily and JiraEodTicketStatusSnapshot.
 * Writes nothing anywhere. Reads KPI pool creds from the NOVA `settings` table.
 */
import 'dotenv/config';
import sql from 'mssql';
import { initPool, query, closePool } from '../../src/server/services/database.js';

async function main(): Promise<void> {
  await initPool();
  const rows = await query<{ key: string; value: string }>(
    `SELECT [key], value FROM settings WHERE [key] IN ('kpi_sql_server','kpi_sql_database','kpi_sql_user','kpi_sql_password')`,
  );
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value;
  if (!s.kpi_sql_user || !s.kpi_sql_password) { console.log('No KPI creds in settings table — cannot probe legacy source.'); await closePool(); return; }

  const legacy = await new sql.ConnectionPool({
    server: s.kpi_sql_server, database: s.kpi_sql_database,
    user: s.kpi_sql_user, password: s.kpi_sql_password,
    options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 60000,
  }).connect();

  async function probe(label: string, q: string): Promise<void> {
    try { const r = await legacy.request().query(q); console.log(`  ${label}:`, JSON.stringify(r.recordset)); }
    catch (err) { console.log(`  ${label}: ERROR ${err instanceof Error ? err.message : err}`); }
  }

  console.log('\n=== LEGACY jira_kpi_daily ===');
  await probe('exists?', `SELECT COUNT(*) AS tbl FROM sys.objects WHERE object_id=OBJECT_ID(N'dbo.jira_kpi_daily') AND type='U'`);
  await probe('span', `SELECT COUNT(*) AS n, MIN(CAST(CreatedAt AS DATE)) AS min_d, MAX(CAST(CreatedAt AS DATE)) AS max_d, COUNT(DISTINCT CAST(CreatedAt AS DATE)) AS days FROM dbo.jira_kpi_daily`);
  await probe('distinct kpi names', `SELECT kpi, COUNT(*) AS n FROM dbo.jira_kpi_daily GROUP BY kpi ORDER BY n DESC`);

  console.log('\n=== LEGACY JiraEodTicketStatusSnapshot ===');
  await probe('exists?', `SELECT COUNT(*) AS tbl FROM sys.objects WHERE object_id=OBJECT_ID(N'dbo.JiraEodTicketStatusSnapshot') AND type='U'`);
  await probe('span', `SELECT COUNT(*) AS n, MIN(CAST(SnapshotDate AS DATE)) AS min_d, MAX(CAST(SnapshotDate AS DATE)) AS max_d, COUNT(DISTINCT CAST(SnapshotDate AS DATE)) AS days FROM dbo.JiraEodTicketStatusSnapshot`);
  await probe('by project', `SELECT ProjectKey, COUNT(*) AS n, COUNT(DISTINCT CAST(SnapshotDate AS DATE)) AS days, MIN(CAST(SnapshotDate AS DATE)) AS min_d, MAX(CAST(SnapshotDate AS DATE)) AS max_d FROM dbo.JiraEodTicketStatusSnapshot GROUP BY ProjectKey ORDER BY n DESC`);

  await legacy.close();
  await closePool();
}

main().catch((err) => { console.error('PROBE FAILED:', err instanceof Error ? err.stack : err); process.exit(1); });
