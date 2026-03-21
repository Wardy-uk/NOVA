import { Router } from 'express';
import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';

export function createBackfillRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();

  let pool: sql.ConnectionPool | null = null;

  async function getPool(): Promise<sql.ConnectionPool> {
    if (pool?.connected) return pool;

    const settings = settingsQueries.getAll();
    const server = settings.kpi_sql_server;
    const database = settings.kpi_sql_database;
    const user = settings.kpi_sql_user;
    const password = settings.kpi_sql_password;

    if (!server || !database || !user || !password) {
      throw new Error('SQL Server not configured. Set kpi_sql_server, kpi_sql_database, kpi_sql_user, kpi_sql_password in Admin > Settings.');
    }

    pool = await new sql.ConnectionPool({
      server,
      database,
      user,
      password,
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
      requestTimeout: 30000,
    }).connect();

    return pool;
  }

  // GET /api/backfill/status
  router.get('/status', async (_req, res) => {
    try {
      const p = await getPool();

      const result = await p.request().query(`
        SELECT
          COUNT(*)                                                          AS totalWindows,
          SUM(CASE WHEN Status = 'complete' THEN 1 ELSE 0 END)            AS completeCount,
          SUM(CASE WHEN Status = 'pending'  THEN 1 ELSE 0 END)            AS pendingCount,
          SUM(CASE WHEN Status = 'failed'   THEN 1 ELSE 0 END)            AS failedCount,
          SUM(CASE WHEN Status = 'running'  THEN 1 ELSE 0 END)            AS runningCount,
          MAX(CASE WHEN Status = 'complete' THEN CompletedAt END)          AS lastCompletedAt,
          MIN(StartedAt)                                                    AS firstStartedAt,
          ISNULL(SUM(TicketsProcessed), 0)                                 AS ticketsProcessed,
          ISNULL(SUM(TicketsSkipped), 0)                                   AS ticketsSkipped
        FROM dbo.QA_Backfill_Progress
      `);

      const row = result.recordset[0];

      // Get most recent error message from latest failed window
      const errResult = await p.request().query(`
        SELECT TOP 1 ErrorMessage, BackfillDate, QAType
        FROM dbo.QA_Backfill_Progress
        WHERE Status = 'failed' AND ErrorMessage IS NOT NULL
        ORDER BY CompletedAt DESC, Id DESC
      `);

      const lastError = errResult.recordset.length > 0
        ? {
            message: errResult.recordset[0].ErrorMessage,
            date: errResult.recordset[0].BackfillDate,
            qaType: errResult.recordset[0].QAType,
          }
        : null;

      res.json({
        ok: true,
        data: {
          totalWindows: row.totalWindows ?? 0,
          completeCount: row.completeCount ?? 0,
          pendingCount: row.pendingCount ?? 0,
          failedCount: row.failedCount ?? 0,
          runningCount: row.runningCount ?? 0,
          lastCompletedAt: row.lastCompletedAt ?? null,
          firstStartedAt: row.firstStartedAt ?? null,
          ticketsProcessed: row.ticketsProcessed ?? 0,
          ticketsSkipped: row.ticketsSkipped ?? 0,
          lastError,
        },
      });
    } catch (err) {
      console.error('[Backfill] Status query failed:', err instanceof Error ? err.message : err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to query backfill status',
      });
    }
  });

  return router;
}
