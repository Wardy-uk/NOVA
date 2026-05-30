/**
 * KPI Recovery — Clean-Sheet Foundation Schema (P1-WP1)
 *
 * Idempotent DDL for the new `kpi_*` tables. Everything here is NEW and lives in
 * the NOVA database (main MSSQL pool via services/database.ts). The legacy KPI
 * system (techservicesjsm tables, KpiSnapshot, jira_kpi_daily, n8n workflow,
 * /api/kpi-data routes) is untouched and continues to run in parallel.
 *
 * Mirrors the established schema.ts idempotency style:
 *   IF NOT EXISTS (... sys.objects/sys.indexes ...) CREATE ...
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §3.
 */
import { execute, query } from '../database.js';

/** Number of distinct kpi_* base tables the foundation must create (design §3). */
export const KPI_TABLE_COUNT = 11;

/** All kpi_* table + index DDL. Each statement is independently idempotent. */
const KPI_DDL: string[] = [
  // ── 3.1 kpi_spaces ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_spaces') AND type = 'U')
   CREATE TABLE kpi_spaces (
     space_key       VARCHAR(20)  NOT NULL PRIMARY KEY,
     jira_project    VARCHAR(20)  NULL,
     display_name    VARCHAR(100) NOT NULL,
     owner_name      VARCHAR(100) NULL,
     timezone        VARCHAR(50)  NOT NULL DEFAULT 'Europe/London',
     biz_hours_start TIME         NOT NULL DEFAULT '08:30',
     biz_hours_end   TIME         NOT NULL DEFAULT '17:30',
     weekend_days    VARCHAR(20)  NOT NULL DEFAULT '0,6',
     pause_statuses  NVARCHAR(MAX) NULL,
     has_tiers       BIT          NOT NULL DEFAULT 0,
     is_jira_space   BIT          NOT NULL DEFAULT 1,
     is_active       BIT          NOT NULL DEFAULT 1,
     created_at      DATETIME2    NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 3.2 kpi_holidays ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_holidays') AND type = 'U')
   CREATE TABLE kpi_holidays (
     id           INT IDENTITY PRIMARY KEY,
     space_key    VARCHAR(20) NOT NULL,
     holiday_date DATE        NOT NULL,
     description  VARCHAR(200) NULL,
     CONSTRAINT UQ_kpi_holidays UNIQUE (space_key, holiday_date)
   );`,

  // ── 3.3 kpi_metric_definitions ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_metric_definitions') AND type = 'U')
   CREATE TABLE kpi_metric_definitions (
     metric_key      VARCHAR(80)  NOT NULL PRIMARY KEY,
     display_name    VARCHAR(200) NOT NULL,
     description     NVARCHAR(MAX) NULL,
     category        VARCHAR(50)  NOT NULL,
     value_type      VARCHAR(20)  NOT NULL,
     direction       VARCHAR(10)  NOT NULL DEFAULT 'higher',
     aggregation     VARCHAR(20)  NOT NULL DEFAULT 'snapshot',
     source          VARCHAR(20)  NOT NULL DEFAULT 'computed',
     computation_key VARCHAR(80)  NULL,
     requires_tiers  BIT          NOT NULL DEFAULT 0,
     is_agent_level  BIT          NOT NULL DEFAULT 0,
     is_active       BIT          NOT NULL DEFAULT 1
   );`,

  // ── 3.4 kpi_space_metrics ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_space_metrics') AND type = 'U')
   CREATE TABLE kpi_space_metrics (
     id                INT IDENTITY PRIMARY KEY,
     space_key         VARCHAR(20) NOT NULL,
     metric_key        VARCHAR(80) NOT NULL,
     is_enabled        BIT          NOT NULL DEFAULT 1,
     target_value      DECIMAL(18,4) NULL,
     amber_band        DECIMAL(5,2) DEFAULT 10.0,
     display_order     INT          DEFAULT 0,
     show_on_wallboard BIT          NOT NULL DEFAULT 0,
     show_on_slt_view  BIT          NOT NULL DEFAULT 0,
     CONSTRAINT UQ_kpi_space_metrics UNIQUE (space_key, metric_key)
   );`,

  // ── 3.5 kpi_tier_definitions ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_tier_definitions') AND type = 'U')
   CREATE TABLE kpi_tier_definitions (
     id                        INT IDENTITY PRIMARY KEY,
     space_key                 VARCHAR(20) NOT NULL,
     tier_name                 VARCHAR(50) NOT NULL,
     tier_order                INT         NOT NULL,
     jira_field_value          VARCHAR(100) NULL,
     frt_target_minutes        INT         NULL,
     resolution_target_minutes INT         NULL,
     CONSTRAINT UQ_kpi_tier_definitions UNIQUE (space_key, tier_name)
   );`,

  // ── 3.6 kpi_snapshots ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_snapshots') AND type = 'U')
   CREATE TABLE kpi_snapshots (
     id          BIGINT IDENTITY PRIMARY KEY,
     space_key   VARCHAR(20) NOT NULL,
     metric_key  VARCHAR(80) NOT NULL,
     tier_name   VARCHAR(50) NULL,
     snapshot_at DATETIME2   NOT NULL,
     value       DECIMAL(18,4) NOT NULL
   );`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kpi_snapshots_lookup')
   CREATE INDEX IX_kpi_snapshots_lookup ON kpi_snapshots (space_key, metric_key, snapshot_at DESC);`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kpi_snapshots_time')
   CREATE INDEX IX_kpi_snapshots_time ON kpi_snapshots (snapshot_at DESC);`,

  // ── 3.7 kpi_daily ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_daily') AND type = 'U')
   CREATE TABLE kpi_daily (
     id           BIGINT IDENTITY PRIMARY KEY,
     space_key    VARCHAR(20) NOT NULL,
     metric_key   VARCHAR(80) NOT NULL,
     tier_name    VARCHAR(50) NULL,
     report_date  DATE        NOT NULL,
     value        DECIMAL(18,4) NOT NULL,
     target_value DECIMAL(18,4) NULL,
     rag_status   VARCHAR(10) NULL,
     CONSTRAINT UQ_kpi_daily UNIQUE (space_key, metric_key, tier_name, report_date)
   );`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kpi_daily_date')
   CREATE INDEX IX_kpi_daily_date ON kpi_daily (report_date DESC, space_key);`,

  // ── 3.8 kpi_agent_daily ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_agent_daily') AND type = 'U')
   CREATE TABLE kpi_agent_daily (
     id          BIGINT IDENTITY PRIMARY KEY,
     space_key   VARCHAR(20)  NOT NULL,
     metric_key  VARCHAR(80)  NOT NULL,
     agent_id    VARCHAR(100) NOT NULL,
     agent_name  VARCHAR(200) NULL,
     report_date DATE         NOT NULL,
     value       DECIMAL(18,4) NOT NULL,
     CONSTRAINT UQ_kpi_agent_daily UNIQUE (space_key, metric_key, agent_id, report_date)
   );`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kpi_agent_daily_lookup')
   CREATE INDEX IX_kpi_agent_daily_lookup ON kpi_agent_daily (agent_id, report_date DESC);`,

  // ── 3.9 kpi_eod_snapshot ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_eod_snapshot') AND type = 'U')
   CREATE TABLE kpi_eod_snapshot (
     id             BIGINT IDENTITY PRIMARY KEY,
     space_key      VARCHAR(20) NOT NULL,
     snapshot_date  DATE        NOT NULL,
     snapshot_time  VARCHAR(10) NOT NULL DEFAULT '17:30',
     tier_name      VARCHAR(50) NULL,
     status         VARCHAR(100) NULL,
     request_type   VARCHAR(200) NULL,
     ticket_count   INT         NOT NULL DEFAULT 0,
     over_sla_count INT         NOT NULL DEFAULT 0
   );`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kpi_eod_date')
   CREATE INDEX IX_kpi_eod_date ON kpi_eod_snapshot (snapshot_date DESC, space_key);`,

  // ── 3.10 kpi_manual_entries ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_manual_entries') AND type = 'U')
   CREATE TABLE kpi_manual_entries (
     id          BIGINT IDENTITY PRIMARY KEY,
     space_key   VARCHAR(20)  NOT NULL,
     metric_key  VARCHAR(80)  NOT NULL,
     report_date DATE         NOT NULL,
     value       DECIMAL(18,4) NOT NULL,
     entered_by  VARCHAR(100) NULL,
     entered_at  DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
     source      VARCHAR(50)  DEFAULT 'manual',
     notes       NVARCHAR(MAX) NULL,
     CONSTRAINT UQ_kpi_manual_entries UNIQUE (space_key, metric_key, report_date)
   );`,

  // ── 3.11 kpi_digests ──
  `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_digests') AND type = 'U')
   CREATE TABLE kpi_digests (
     id           BIGINT IDENTITY PRIMARY KEY,
     space_key    VARCHAR(20) NULL,
     report_date  DATE        NOT NULL,
     digest_type  VARCHAR(20) NOT NULL DEFAULT 'daily',
     summary      NVARCHAR(MAX) NULL,
     generated_at DATETIME2   NOT NULL DEFAULT GETUTCDATE()
   );`,
];

let ensured = false;
let lastResult = { statements: KPI_DDL.length, failed: 0 };

/**
 * Create all kpi_* tables and indexes if they do not already exist.
 * Safe to call repeatedly (idempotent). Runs once per process by default.
 *
 * Returns the statement/failure counts so the caller (initKpiFoundation) can
 * verify activation and surface a clear error instead of silently claiming
 * success when DDL did not actually run.
 */
export async function ensureKpiSchema(force = false): Promise<{ statements: number; failed: number }> {
  if (ensured && !force) return lastResult;
  let failed = 0;
  for (const ddl of KPI_DDL) {
    try {
      await execute(ddl);
    } catch (err) {
      // Keep going — a partial pre-existing schema should not block the rest —
      // but COUNT the failure so init does not pretend the schema is live.
      // Foreign keys are intentionally omitted (design references them, but soft
      // FKs keep backfill ordering flexible).
      failed++;
      console.warn('[kpi-engine] schema DDL failed:', err instanceof Error ? err.message : err);
    }
  }
  ensured = true;
  lastResult = { statements: KPI_DDL.length, failed };
  if (failed > 0) {
    console.error(`[kpi-engine] kpi_* schema ensure: ${failed}/${KPI_DDL.length} DDL statements FAILED — foundation may be inert.`);
  } else {
    console.log(`[kpi-engine] kpi_* schema ensured (${KPI_DDL.length} statements, 0 failures).`);
  }
  return lastResult;
}

/** Live count of created kpi_* base tables in the NOVA pool (activation proof). */
export async function countKpiTables(): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sys.objects WHERE type = 'U' AND name LIKE 'kpi[_]%'`,
  );
  return rows[0]?.n ?? 0;
}
