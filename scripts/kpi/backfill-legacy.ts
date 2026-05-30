#!/usr/bin/env tsx
/**
 * KPI Recovery — Backfill from legacy KPI tables → new kpi_* schema (P1-WP1)
 *
 * Reads the LEGACY KPI pipeline database (techservicesjsm, read-only) and writes
 * into the NEW kpi_* tables in the NOVA main database. The legacy system is NEVER
 * modified — this only SELECTs from it. Idempotent (upsert on the kpi_* unique
 * keys) and supports --dry-run.
 *
 * Covered sources (design §8.1, known schemas):
 *   jira_kpi_daily            → kpi_daily          (NT, name→metric_key mapping)
 *   JiraEodTicketStatusSnapshot → kpi_eod_snapshot (all projects → space_key)
 *
 * Forbidden tables (JiraSlaRaw*, JiraTickets*) are NEVER referenced.
 *
 * Env:
 *   NOVA_SQL_CONNECTION | NOVA_SQL_SERVER/DATABASE/USER/PASSWORD  (target)
 *   KPI_SQL_SERVER (default bym-asqlep01.database.windows.net)
 *   KPI_SQL_DATABASE (default TechSupportJSM)
 *   KPI_SQL_USER / KPI_SQL_PASSWORD                               (legacy source)
 *
 * Run: tsx scripts/kpi/backfill-legacy.ts [--dry-run]
 */
import 'dotenv/config';
import sql from 'mssql';
import { initPool, execute, query, closePool } from '../../src/server/services/database.js';
import { ensureKpiSchema } from '../../src/server/services/kpi-engine/kpi-schema.js';
import { seedKpiFoundation } from '../../src/server/services/kpi-engine/kpi-seed.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Legacy jira_kpi_daily.kpi (n8n-style names) → clean-sheet metric_key (NT).
// Only unit-compatible, catalogue-backed mappings are included; anything else is
// reported as "unmapped" rather than guessed.
const DAILY_NAME_MAP: Record<string, string> = {
  'Open Tickets': 'queue_total',
  'SLA Breached': 'sla_breach_count',
  'Tickets Solved Today': 'resolved_today',
  'New Tickets Today': 'opened_today',
  'FRT Compliance % (Resolved Today)': 'frt_compliance',
  'Resolution Compliance % (Resolved Today)': 'resolution_compliance',
  '1st Line Resolution Rate %': 'first_line_resolution',
  'FCR Rate %': 'fcr_rate',
  'Bug Escalation-to-Ack (hours)': 'bug_escalation_ack_hrs',
};

function ragWord(rag: number | null): string | null {
  if (rag === 1) return 'green';
  if (rag === 2) return 'amber';
  if (rag === 3) return 'red';
  return null;
}

async function legacyPool(): Promise<sql.ConnectionPool> {
  const cfg: sql.config = {
    server: process.env.KPI_SQL_SERVER || 'bym-asqlep01.database.windows.net',
    database: process.env.KPI_SQL_DATABASE || 'TechSupportJSM',
    user: process.env.KPI_SQL_USER,
    password: process.env.KPI_SQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 60000,
  };
  if (!cfg.user || !cfg.password) {
    throw new Error('Set KPI_SQL_USER and KPI_SQL_PASSWORD for the legacy source DB.');
  }
  return new sql.ConnectionPool(cfg).connect();
}

async function tableExists(pool: sql.ConnectionPool, name: string): Promise<boolean> {
  const r = await pool.request().query(
    `SELECT 1 AS n FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.${name}') AND type = 'U'`,
  );
  return r.recordset.length > 0;
}

/** jira_kpi_daily → kpi_daily (NT). Upsert on (space_key, metric_key, tier, date). */
async function backfillDaily(pool: sql.ConnectionPool): Promise<void> {
  if (!(await tableExists(pool, 'jira_kpi_daily'))) {
    console.log('[backfill] jira_kpi_daily not found — skipping daily backfill.');
    return;
  }
  const rows = (await pool.request().query(
    `SELECT kpi, [count] AS value, target, rag, CAST(CreatedAt AS DATE) AS report_date
     FROM dbo.jira_kpi_daily`,
  )).recordset as Array<{ kpi: string; value: number; target: number | null; rag: number | null; report_date: Date }>;

  let written = 0;
  const unmapped = new Map<string, number>();
  for (const r of rows) {
    const metricKey = DAILY_NAME_MAP[r.kpi];
    if (!metricKey) { unmapped.set(r.kpi, (unmapped.get(r.kpi) || 0) + 1); continue; }
    const reportDate = new Date(r.report_date).toISOString().slice(0, 10);
    if (DRY_RUN) { written++; continue; }
    await execute(
      `MERGE kpi_daily AS t
       USING (SELECT ? AS space_key, ? AS metric_key, CAST(NULL AS VARCHAR(50)) AS tier_name, ? AS report_date) AS s
       ON t.space_key = s.space_key AND t.metric_key = s.metric_key
          AND t.tier_name IS NULL AND t.report_date = s.report_date
       WHEN MATCHED THEN UPDATE SET value = ?, target_value = ?, rag_status = ?
       WHEN NOT MATCHED THEN INSERT (space_key, metric_key, tier_name, report_date, value, target_value, rag_status)
         VALUES (?, ?, NULL, ?, ?, ?, ?);`,
      [
        'NT', metricKey, reportDate,
        r.value ?? 0, r.target ?? null, ragWord(r.rag),
        'NT', metricKey, reportDate, r.value ?? 0, r.target ?? null, ragWord(r.rag),
      ],
    );
    written++;
  }
  console.log(`[backfill] kpi_daily: ${written} rows ${DRY_RUN ? '(dry-run)' : 'written'} from jira_kpi_daily.`);
  if (unmapped.size) {
    const top = [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log(`[backfill] kpi_daily: ${unmapped.size} unmapped legacy KPI name(s) skipped (no catalogue match):`);
    for (const [name, n] of top) console.log(`            • ${name} (${n})`);
  }
}

/** JiraEodTicketStatusSnapshot → kpi_eod_snapshot (all projects). */
async function backfillEod(pool: sql.ConnectionPool): Promise<void> {
  if (!(await tableExists(pool, 'JiraEodTicketStatusSnapshot'))) {
    console.log('[backfill] JiraEodTicketStatusSnapshot not found — skipping EOD backfill.');
    return;
  }
  const rows = (await pool.request().query(
    `SELECT SnapshotDate, ProjectKey, CurrentTier, RequestTypeName, StatusName, TicketCount
     FROM dbo.JiraEodTicketStatusSnapshot`,
  )).recordset as Array<{ SnapshotDate: Date; ProjectKey: string; CurrentTier: string | null; RequestTypeName: string | null; StatusName: string | null; TicketCount: number }>;

  // Map only project keys that correspond to a known space.
  const spaces = new Set((await query<{ space_key: string }>(`SELECT space_key FROM kpi_spaces`)).map((s) => s.space_key));
  let written = 0, skipped = 0;
  for (const r of rows) {
    if (!spaces.has(r.ProjectKey)) { skipped++; continue; }
    const date = new Date(r.SnapshotDate).toISOString().slice(0, 10);
    if (DRY_RUN) { written++; continue; }
    // kpi_eod_snapshot has no natural unique key; clear the day/space once then insert.
    await execute(
      `DELETE FROM kpi_eod_snapshot WHERE space_key = ? AND snapshot_date = ?
         AND ISNULL(tier_name,'') = ISNULL(?, '') AND ISNULL(status,'') = ISNULL(?, '')
         AND ISNULL(request_type,'') = ISNULL(?, '')`,
      [r.ProjectKey, date, r.CurrentTier, r.StatusName, r.RequestTypeName],
    );
    await execute(
      `INSERT INTO kpi_eod_snapshot (space_key, snapshot_date, tier_name, status, request_type, ticket_count, over_sla_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [r.ProjectKey, date, r.CurrentTier, r.StatusName, r.RequestTypeName, r.TicketCount ?? 0],
    );
    written++;
  }
  console.log(`[backfill] kpi_eod_snapshot: ${written} rows ${DRY_RUN ? '(dry-run)' : 'written'}, ${skipped} skipped (unknown project).`);
}

async function main(): Promise<void> {
  console.log(`[backfill] Legacy → kpi_* backfill ${DRY_RUN ? '(DRY RUN)' : ''}`);
  await initPool();
  await ensureKpiSchema();
  await seedKpiFoundation();

  const pool = await legacyPool();
  try {
    await backfillDaily(pool);
    await backfillEod(pool);
  } finally {
    await pool.close();
  }
  await closePool();
  console.log('[backfill] Done.');
}

main().catch((err) => {
  console.error('[backfill] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
