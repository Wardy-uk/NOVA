import { Router } from 'express';
import sql from 'mssql';

import type { SettingsQueries } from '../db/settings-store.js';
import type { EscalationLogService } from '../services/escalation-log-service.js';
import { applyTargetFallbacks } from '../services/kpi-targets.js';
import { bridgeAuth } from './neuro-bridge.js';

/**
 * KPI half of the NEURO bridge — read-only.
 *
 * NEURO builds Nick's Weekly Risk & Anomaly Summary (a PIP competency-2
 * deliverable, due to Chris by midday every Monday). Every number in it comes
 * from `jira_kpi_daily`, which lives in the techservicesjsm database — reachable
 * only with the credentials in NOVA's admin settings. NEURO cannot read that
 * table directly, and `/api/kpi-data/*` sits behind requireAreaAccess JWT
 * middleware that the bridge secret does not satisfy. So the data crosses here.
 *
 * Strictly SELECT. Nothing on this router writes.
 */
export function createNeuroBridgeKpiRoutes(
  settingsQueries: SettingsQueries,
  getEscalationLog: () => EscalationLogService | null,
): Router {
  const router = Router();

  let pool: sql.ConnectionPool | null = null;

  /** Same KPI pool the dashboard uses — credentials live in admin settings. */
  async function getPool(): Promise<sql.ConnectionPool> {
    if (pool?.connected) return pool;
    const settings = settingsQueries.getAll();
    const server = settings.kpi_sql_server;
    const database = settings.kpi_sql_database;
    const user = settings.kpi_sql_user;
    const password = settings.kpi_sql_password;
    if (!server || !database || !user || !password) {
      throw new Error('KPI SQL Server not configured. Set kpi_sql_* in Admin > Settings.');
    }
    pool = await new sql.ConnectionPool({
      server, database, user, password,
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
    }).connect();
    return pool;
  }

  /**
   * GET /kpi-snapshot?date=YYYY-MM-DD
   *
   * Defaults to the most recent date that HAS rows, not to today. The report is
   * generated on a Monday morning, and n8n may not have run yet — asking for
   * "today" on a quiet morning returns an empty set, which renders as a team
   * with no KPIs rather than as a pipeline that has not run. The date actually
   * used and its age are returned so the report can say which it is.
   */
  router.get('/kpi-snapshot', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    try {
      const p = await getPool();
      const asked = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : null;

      let date = asked;
      if (!date) {
        const latest = await p.request().query(
          `SELECT MAX(CAST(CreatedAt AS DATE)) AS d FROM dbo.jira_kpi_daily`,
        );
        const d = latest.recordset[0]?.d;
        if (!d) { res.json({ ok: true, data: { date: null, ageDays: null, rows: [] } }); return; }
        date = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      }

      const r = p.request();
      r.input('date', sql.Date, date);
      const result = await r.query(`
        SELECT kpi AS KPI, kpiGroup AS KPIGroup, [count] AS [Count],
               target AS KPITarget, direction AS KPIDirection, rag AS RAG, CreatedAt
        FROM dbo.jira_kpi_daily
        WHERE CAST(CreatedAt AS DATE) = @date
        ORDER BY kpiGroup, kpi
      `);

      const ageDays = Math.round(
        (Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`))
        / 86_400_000,
      );

      res.json({
        ok: true,
        data: { date, ageDays, requestedDate: asked, rows: applyTargetFallbacks(result.recordset) },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  /**
   * GET /kpi-trend?weeks=6
   *
   * Week-on-week averages per KPI — Chris asked for a trend at the 12 Aug 1:1,
   * because a single week's snapshot cannot distinguish "bad" from "getting
   * worse". Week buckets match the dashboard's (Monday-start), so a figure here
   * and a figure on the trends board are the same figure.
   */
  router.get('/kpi-trend', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    try {
      const p = await getPool();
      const weeks = Math.min(Math.max(Number(req.query.weeks) || 6, 1), 52);
      const r = p.request();
      r.input('days', sql.Int, weeks * 7);
      const result = await r.query(`
        SELECT
          DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, CreatedAt)), 1) AS period,
          kpi AS KPI,
          kpiGroup AS KPIGroup,
          AVG(CAST([Count] AS FLOAT)) AS avgValue,
          COUNT(*) AS samples
        FROM dbo.jira_kpi_daily
        WHERE CreatedAt >= DATEADD(DAY, -@days, GETDATE())
        GROUP BY DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, CreatedAt)), 1), kpi, kpiGroup
        ORDER BY period, kpi
      `);
      res.json({ ok: true, data: { weeks, rows: result.recordset } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  /**
   * GET /escalation-stats?days=30
   *
   * Reason-code breakdown. This is what surfaced the reporting defect in the
   * first edition of the report — 1,285 of 1,337 escalations logged as reason
   * `unknown` — so it is pulled as data rather than retyped each week.
   */
  router.get('/escalation-stats', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const log = getEscalationLog();
    if (!log) { res.status(503).json({ ok: false, error: 'Escalation log not available' }); return; }
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 30, 1), 365);
      res.json({ ok: true, data: await log.getStats(days) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  return router;
}
