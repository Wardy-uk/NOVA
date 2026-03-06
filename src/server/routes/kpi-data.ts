import { Router } from 'express';
import sql from 'mssql';
import { requireRole } from '../middleware/auth.js';
import type { SettingsQueries } from '../db/settings-store.js';

const VALID_ENVS = ['live', 'uat'] as const;
type Env = (typeof VALID_ENVS)[number];

function suffix(env: Env): string {
  return env === 'uat' ? 'UAT' : '';
}

export function createKpiDataRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();
  router.use(requireRole('admin'));

  let pool: sql.ConnectionPool | null = null;

  async function getPool(): Promise<sql.ConnectionPool> {
    if (pool?.connected) return pool;

    const settings = settingsQueries.getAll();
    const server = settings.kpi_sql_server;
    const database = settings.kpi_sql_database;
    const user = settings.kpi_sql_user;
    const password = settings.kpi_sql_password;

    if (!server || !database || !user || !password) {
      throw new Error('KPI SQL Server not configured. Set kpi_sql_server, kpi_sql_database, kpi_sql_user, kpi_sql_password in Admin > Settings.');
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

  function parseEnv(req: any): Env {
    const env = req.query.env as string;
    if (VALID_ENVS.includes(env as Env)) return env as Env;
    return 'uat'; // default to UAT for safety
  }

  // GET /api/admin/kpi-data/team-snapshot?env=live|uat
  router.get('/team-snapshot', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();
      const result = await p.request().query(`
        SELECT KPI, KPIGroup, [Count], KPITarget, KPIDirection, RAG, CreatedAt
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
          FROM dbo.KpiSnapshot${s}
        ) t WHERE rn = 1
        ORDER BY KPIGroup, KPI
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/daily-history?env=live|uat&days=7
  router.get('/daily-history', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      const p = await getPool();
      const result = await p.request().query(`
        SELECT kpi, kpiGroup, [count], target, direction, rag, CreatedAt
        FROM dbo.jira_kpi_daily${s}
        WHERE CreatedAt >= DATEADD(day, -${days}, GETDATE())
        ORDER BY CreatedAt DESC, kpiGroup, kpi
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/agents?env=live|uat
  router.get('/agents', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();
      const result = await p.request().query(`
        SELECT AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team,
               IsActive, IsAvailable, AccountId,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               SolvedTickets_Today, SolvedTickets_ThisWeek, TicketsSnapshotAt
        FROM dbo.Agent${s}
        WHERE IsActive = 1
        ORDER BY Team, AgentName
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/agent-daily?env=live|uat&days=7
  router.get('/agent-daily', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      const p = await getPool();
      const result = await p.request().query(`
        SELECT *
        FROM dbo.jira_agent_kpi_daily${s}
        WHERE ReportDate >= DATEADD(day, -${days}, CAST(GETDATE() AS DATE))
        ORDER BY ReportDate DESC, AgentName
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/qa-scores?env=live|uat&days=7
  router.get('/qa-scores', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      const p = await getPool();
      const result = await p.request().query(`
        SELECT assigneeName, qaType, overallScore, accuracyScore, clarityScore,
               toneScore, grade, isConcerning, severity, category, issueKey, CreatedAt
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -${days}, GETDATE())
        ORDER BY CreatedAt DESC
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/digest?env=live|uat&days=7
  router.get('/digest', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 7, 90);
      const p = await getPool();
      const result = await p.request().query(`
        SELECT period, summary, html, CreatedAt
        FROM dbo.jira_kpi_digest${s}
        WHERE CreatedAt >= DATEADD(day, -${days}, GETDATE())
        ORDER BY CreatedAt DESC
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}
