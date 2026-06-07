// Persistence for per-agent daily KPIs. One row per (date, agent) holding the
// full metric set as JSON — the scorecard/wallboard reads the whole row anyway,
// so a blob keeps the schema simple (vs ~35 columns).

import { query, execute } from '../database.js';
import type { AgentKpiRow } from './compute.js';

let ensured = false;

export async function ensureAgentTable(): Promise<void> {
  if (ensured) return;
  await execute(
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kpi_agent_daily') AND type = 'U')
     CREATE TABLE kpi_agent_daily (
       kpi_date          DATE          NOT NULL,
       agent_account_id  NVARCHAR(200) NOT NULL,
       agent_name        NVARCHAR(200) NULL,
       metrics_json      NVARCHAR(MAX) NOT NULL,
       captured_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT PK_kpi_agent_daily PRIMARY KEY (kpi_date, agent_account_id)
     );`,
  );
  ensured = true;
}

export async function saveDay(day: string, rows: AgentKpiRow[]): Promise<void> {
  await ensureAgentTable();
  for (const r of rows) {
    const json = JSON.stringify(r);
    const upd = await execute(
      `UPDATE kpi_agent_daily SET agent_name = ?, metrics_json = ?, captured_at = GETUTCDATE()
       WHERE kpi_date = ? AND agent_account_id = ?`,
      [r.agentName, json, day, r.accountId],
    );
    if (upd.rowsAffected === 0) {
      await execute(
        `INSERT INTO kpi_agent_daily (kpi_date, agent_account_id, agent_name, metrics_json) VALUES (?, ?, ?, ?)`,
        [day, r.accountId, r.agentName, json],
      );
    }
  }
}

function parseRows(rows: Array<{ metrics_json: string; kpi_date: string; captured_at: string }>): Array<AgentKpiRow & { date: string; capturedAt: string }> {
  const out: Array<AgentKpiRow & { date: string; capturedAt: string }> = [];
  for (const r of rows) {
    try { out.push({ ...(JSON.parse(r.metrics_json) as AgentKpiRow), date: r.kpi_date, capturedAt: r.captured_at }); }
    catch { /* skip corrupt row */ }
  }
  return out;
}

export async function getLatestDay(): Promise<Array<AgentKpiRow & { date: string; capturedAt: string }>> {
  await ensureAgentTable();
  const rows = await query<{ metrics_json: string; kpi_date: string; captured_at: string }>(
    `WITH d AS (SELECT MAX(kpi_date) AS mx FROM kpi_agent_daily)
     SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, metrics_json,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM kpi_agent_daily WHERE kpi_date = (SELECT mx FROM d)`,
  );
  return parseRows(rows);
}

export async function getDay(day: string): Promise<Array<AgentKpiRow & { date: string; capturedAt: string }>> {
  await ensureAgentTable();
  const rows = await query<{ metrics_json: string; kpi_date: string; captured_at: string }>(
    `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, metrics_json,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM kpi_agent_daily WHERE kpi_date = ?`,
    [day],
  );
  return parseRows(rows);
}

/** All agent rows across a date range — used by period rollups. */
export async function getAllInRange(fromDay: string, toDay: string): Promise<Array<AgentKpiRow & { date: string; capturedAt: string }>> {
  await ensureAgentTable();
  const rows = await query<{ metrics_json: string; kpi_date: string; captured_at: string }>(
    `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, metrics_json,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM kpi_agent_daily WHERE kpi_date >= ? AND kpi_date <= ? ORDER BY agent_account_id, kpi_date`,
    [fromDay, toDay],
  );
  return parseRows(rows);
}

export async function getAgentHistory(accountId: string, fromDay: string, toDay: string): Promise<Array<AgentKpiRow & { date: string; capturedAt: string }>> {
  await ensureAgentTable();
  const rows = await query<{ metrics_json: string; kpi_date: string; captured_at: string }>(
    `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, metrics_json,
            CONVERT(varchar(33), captured_at, 126) AS captured_at
     FROM kpi_agent_daily WHERE agent_account_id = ? AND kpi_date >= ? AND kpi_date <= ? ORDER BY kpi_date`,
    [accountId, fromDay, toDay],
  );
  return parseRows(rows);
}
