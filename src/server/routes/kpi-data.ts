import { Router } from 'express';
import sql from 'mssql';

import type { SettingsQueries } from '../db/settings-store.js';

const VALID_ENVS = ['live', 'uat'] as const;
type Env = (typeof VALID_ENVS)[number];

function suffix(env: Env): string {
  return env === 'uat' ? 'UAT' : '';
}

export function createKpiDataRoutes(settingsQueries: SettingsQueries): Router {
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
        SELECT AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team, Department,
               IsActive, IsAvailable, AccountId,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               SolvedTickets_Today, SolvedTickets_ThisWeek, TicketsSnapshotAt
        FROM dbo.Agent${s}
        WHERE IsActive = 1 AND Department = 'NT'
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

  // GET /api/admin/kpi-data/comparison
  router.get('/comparison', async (req, res) => {
    try {
      const p = await getPool();
      const statsQuery = (s: string) => `
        SELECT 'KpiSnapshot' AS tableName, COUNT(*) AS [rowCount], MAX(CreatedAt) AS latestRecord,
               (SELECT COUNT(DISTINCT KPI) FROM dbo.KpiSnapshot${s}) AS distinctKPIs
        FROM dbo.KpiSnapshot${s}
        UNION ALL
        SELECT 'jira_kpi_daily', COUNT(*), MAX(createdAt), COUNT(DISTINCT kpi)
        FROM dbo.jira_kpi_daily${s}
        UNION ALL
        SELECT 'jira_kpi_digest', COUNT(*), MAX(CreatedAt), NULL
        FROM dbo.jira_kpi_digest${s}
        UNION ALL
        SELECT 'Agent', COUNT(*), MAX(TicketsSnapshotAt),
               SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END)
        FROM dbo.Agent${s}
        WHERE Department = 'NT'
        UNION ALL
        SELECT 'JiraEodTicketStatusSnapshot', COUNT(*), MAX(SnapshotAt),
               (SELECT COUNT(DISTINCT CONVERT(varchar(10), SnapshotDate, 23)) FROM dbo.JiraEodTicketStatusSnapshot${s})
        FROM dbo.JiraEodTicketStatusSnapshot${s}`;

      const [liveResult, uatResult] = await Promise.all([
        p.request().query(statsQuery('')),
        p.request().query(statsQuery('UAT')),
      ]);

      const live = liveResult.recordset;
      const uat = uatResult.recordset;

      const comparison = live.map((l, i) => {
        const u = uat[i] || {};
        const diff = (u.rowCount ?? 0) - (l.rowCount ?? 0);
        return {
          table: l.tableName,
          liveRows: l.rowCount,
          uatRows: u.rowCount ?? 0,
          diff,
          liveLatest: l.latestRecord,
          uatLatest: u.latestRecord,
          liveExtra: l.distinctKPIs,
          uatExtra: u.distinctKPIs,
        };
      });

      res.json({ ok: true, data: comparison });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/snapshot-compare?kpi=...
  router.get('/snapshot-compare', async (req, res) => {
    try {
      const p = await getPool();
      const result = await p.request().query(`
        SELECT l.KPI, l.KPIGroup,
               l.[Count] AS liveCount, u.[Count] AS uatCount,
               l.[Count] - u.[Count] AS diff,
               l.KPITarget, l.KPIDirection,
               l.RAG AS liveRAG, u.RAG AS uatRAG,
               l.CreatedAt AS liveUpdated, u.CreatedAt AS uatUpdated
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
          FROM dbo.KpiSnapshot
        ) l
        FULL OUTER JOIN (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
          FROM dbo.KpiSnapshotUAT
        ) u ON l.KPI = u.KPI AND u.rn = 1
        WHERE l.rn = 1
        ORDER BY l.KPIGroup, l.KPI
      `);
      res.json({ ok: true, data: result.recordset });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/agent-admin — all agents, no filters (for admin editing)
  router.get('/agent-admin', async (req, res) => {
    try {
      const p = await getPool();
      const result = await p.request().query(`
        SELECT AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team, Department,
               IsActive, IsAvailable, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3
        FROM dbo.Agent
        ORDER BY Department, Team, AgentName
      `);
      res.json({ ok: true, data: result.recordset });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // PUT /api/admin/kpi-data/agent-admin/:agentId — update a single agent record
  router.put('/agent-admin/:agentId', async (req, res) => {
    try {
      const p = await getPool();
      const { agentId } = req.params;
      const { Department, Team, TierCode, IsActive, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3 } = req.body;

      const request = p.request();
      request.input('agentId', sql.Int, parseInt(agentId));
      request.input('department', sql.NVarChar, Department);
      request.input('team', sql.NVarChar, Team);
      request.input('tierCode', sql.NVarChar, TierCode);
      request.input('isActive', sql.Bit, IsActive ? 1 : 0);
      request.input('maxTickets', sql.Int, MaxTickets);
      request.input('maxTicketsCC', sql.Int, MaxTicketsCustomerCare);
      request.input('maxTicketsT2T3', sql.Int, MaxTicketsT2T3);

      await request.query(`
        UPDATE dbo.Agent SET
          Department = @department,
          Team = @team,
          TierCode = @tierCode,
          IsActive = @isActive,
          MaxTickets = @maxTickets,
          MaxTicketsCustomerCare = @maxTicketsCC,
          MaxTicketsT2T3 = @maxTicketsT2T3,
          UpdatedAt = GETDATE()
        WHERE AgentId = @agentId
      `);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  return router;
}
