// Persistence for org KPI daily values. One row per (date, team, kpi).
// Stocks store the 18:00 freeze; flows store the day's total. Manual KPIs are
// written via setManualValue and are never overwritten by the capture job.

import { query, execute } from '../database.js';
import { getKpi, computeRag, type OrgKpi } from './registry.js';

export interface OrgKpiDailyRow {
  kpi_date: string;        // YYYY-MM-DD
  team_key: string;
  kpi_key: string;
  value: number | null;
  target: number | null;
  rag: 'green' | 'amber' | 'red' | null;
  source: string;          // 'jira' | 'manual' | 'escalation_log'
  captured_at: string;
}

let ensured = false;

/** Idempotent table creation. Safe to call on every boot. */
export async function ensureOrgKpiTable(): Promise<void> {
  if (ensured) return;
  await execute(
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_org_daily') AND type = 'U')
     CREATE TABLE kpi_org_daily (
       kpi_date    DATE          NOT NULL,
       team_key    NVARCHAR(50)  NOT NULL,
       kpi_key     NVARCHAR(80)  NOT NULL,
       value       FLOAT         NULL,
       target      FLOAT         NULL,
       rag         NVARCHAR(10)  NULL,
       source      NVARCHAR(20)  NOT NULL,
       captured_at DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT PK_kpi_org_daily PRIMARY KEY (kpi_date, team_key, kpi_key)
     );`,
  );
  ensured = true;
}

/** Upsert a single (date, team, kpi) value. */
export async function upsertDaily(
  day: string,
  teamKey: string,
  kpiKey: string,
  value: number | null,
  target: number | null,
  rag: 'green' | 'amber' | 'red' | null,
  source: string,
): Promise<void> {
  const upd = await execute(
    `UPDATE kpi_org_daily SET value = ?, target = ?, rag = ?, source = ?, captured_at = GETUTCDATE()
     WHERE kpi_date = ? AND team_key = ? AND kpi_key = ?`,
    [value, target, rag, source, day, teamKey, kpiKey],
  );
  if (upd.rowsAffected === 0) {
    await execute(
      `INSERT INTO kpi_org_daily (kpi_date, team_key, kpi_key, value, target, rag, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [day, teamKey, kpiKey, value, target, rag, source],
    );
  }
}

/** Persist a computed value for a registered KPI (derives target + RAG from the registry). */
export async function saveComputed(kpi: OrgKpi, day: string, value: number | null, source: string): Promise<void> {
  await ensureOrgKpiTable();
  await upsertDaily(day, kpi.team, kpi.key, value, kpi.dailyTarget, computeRag(kpi, value), source);
}

/** Set a manual KPI value (e.g. #18 Failed Jobs, #19 CI). */
export async function setManualValue(kpiKey: string, day: string, value: number | null): Promise<OrgKpi> {
  const kpi = getKpi(kpiKey);
  if (!kpi) throw new Error(`Unknown KPI: ${kpiKey}`);
  await ensureOrgKpiTable();
  await upsertDaily(day, kpi.team, kpi.key, value, kpi.dailyTarget, computeRag(kpi, value), 'manual');
  return kpi;
}

/** All rows for a team on a given day. */
export async function getDay(teamKey: string, day: string): Promise<OrgKpiDailyRow[]> {
  await ensureOrgKpiTable();
  return query<OrgKpiDailyRow>(
    `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, team_key, kpi_key, value, target, rag, source,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM kpi_org_daily WHERE team_key = ? AND kpi_date = ? ORDER BY kpi_key`,
    [teamKey, day],
  );
}

/** Most recent stored row per KPI for a team (the current scorecard). */
export async function getLatest(teamKey: string): Promise<OrgKpiDailyRow[]> {
  await ensureOrgKpiTable();
  return query<OrgKpiDailyRow>(
    `WITH ranked AS (
       SELECT kpi_date, team_key, kpi_key, value, target, rag, source, captured_at,
              ROW_NUMBER() OVER (PARTITION BY kpi_key ORDER BY kpi_date DESC) AS rn
       FROM kpi_org_daily WHERE team_key = ?
     )
     SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, team_key, kpi_key, value, target, rag, source,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM ranked WHERE rn = 1 ORDER BY kpi_key`,
    [teamKey],
  );
}

/** Daily history for one KPI over a date range (inclusive). */
export async function getRange(teamKey: string, kpiKey: string, fromDay: string, toDay: string): Promise<OrgKpiDailyRow[]> {
  await ensureOrgKpiTable();
  return query<OrgKpiDailyRow>(
    `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, team_key, kpi_key, value, target, rag, source,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM kpi_org_daily WHERE team_key = ? AND kpi_key = ? AND kpi_date >= ? AND kpi_date <= ?
     ORDER BY kpi_date`,
    [teamKey, kpiKey, fromDay, toDay],
  );
}
