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

  // GET /api/admin/kpi-data/daily-history?env=live|uat&days=7&from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/daily-history', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (from && to) {
        const request = p.request();
        request.input('from', sql.Date, from);
        request.input('to', sql.Date, to);
        const result = await request.query(`
          SELECT kpi, kpiGroup, [count], target, direction, rag, CreatedAt
          FROM dbo.jira_kpi_daily${s}
          WHERE CAST(CreatedAt AS DATE) >= @from AND CAST(CreatedAt AS DATE) <= @to
          ORDER BY CreatedAt DESC, kpiGroup, kpi
        `);
        res.json({ ok: true, data: result.recordset, env });
      } else {
        const days = Math.min(parseInt(req.query.days as string) || 7, 90);
        const result = await p.request().query(`
          SELECT kpi, kpiGroup, [count], target, direction, rag, CreatedAt
          FROM dbo.jira_kpi_daily${s}
          WHERE CreatedAt >= DATEADD(day, -${days}, GETDATE())
          ORDER BY CreatedAt DESC, kpiGroup, kpi
        `);
        res.json({ ok: true, data: result.recordset, env });
      }
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
      const hasOldest = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'OldestTicketDays'`);
      const oldestCol = hasOldest.recordset.length > 0 ? 'ISNULL(OldestTicketDays, 0)' : '0';
      const hasOldestKey = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'OldestTicketKey'`);
      const oldestKeyCol = hasOldestKey.recordset.length > 0 ? ', OldestTicketKey' : '';
      // Check both Agent and AgentUAT for Department column
      const hasDept = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'Department'`);
      const hasDeptLive = s ? await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`) : hasDept;
      const deptCol = hasDept.recordset.length > 0 ? ', Department' : '';
      const deptFilter = hasDept.recordset.length > 0
        ? "AND Department = 'NT'"
        : hasDeptLive.recordset.length > 0 && s
          ? `AND AgentName IN (SELECT AgentName FROM dbo.Agent WHERE Department = 'NT')`
          : '';
      const result = await p.request().query(`
        SELECT AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team,
               IsActive, IsAvailable, AccountId,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               ${oldestCol} AS OldestTicketDays${oldestKeyCol},
               SolvedTickets_Today, SolvedTickets_ThisWeek, TicketsSnapshotAt${deptCol}
        FROM dbo.Agent${s}
        WHERE IsActive = 1 ${deptFilter}
        ORDER BY Team, AgentName
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/admin/kpi-data/agent-daily?env=live|uat&days=7&from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/agent-daily', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();
      const hasDept = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'Department'`);
      const hasDeptLive = s ? await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`) : hasDept;
      let deptJoin: string;
      let deptWhere: string;
      if (hasDept.recordset.length > 0) {
        deptJoin = `INNER JOIN dbo.Agent${s} a ON a.AgentName = d.AgentName`;
        deptWhere = "AND a.Department = 'NT'";
      } else if (hasDeptLive.recordset.length > 0) {
        deptJoin = `INNER JOIN dbo.Agent a ON a.AgentName = d.AgentName`;
        deptWhere = "AND a.Department = 'NT'";
      } else {
        deptJoin = '';
        deptWhere = '';
      }
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (from && to) {
        const request = p.request();
        request.input('from', sql.Date, from);
        request.input('to', sql.Date, to);
        const result = await request.query(`
          SELECT d.*
          FROM dbo.jira_agent_kpi_daily${s} d
          ${deptJoin}
          WHERE d.ReportDate >= @from AND d.ReportDate <= @to
            ${deptWhere}
          ORDER BY d.ReportDate DESC, d.AgentName
        `);
        res.json({ ok: true, data: result.recordset, env });
      } else {
        const days = Math.min(parseInt(req.query.days as string) || 7, 90);
        const result = await p.request().query(`
          SELECT d.*
          FROM dbo.jira_agent_kpi_daily${s} d
          ${deptJoin}
          WHERE d.ReportDate >= DATEADD(day, -${days}, CAST(GETDATE() AS DATE))
            ${deptWhere}
          ORDER BY d.ReportDate DESC, d.AgentName
        `);
        res.json({ ok: true, data: result.recordset, env });
      }
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

  // GET /api/kpi-data/qa-summary?env=uat|live&days=7
  router.get('/qa-summary', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 7, 365);
      const p = await getPool();
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND qaType = 'ticket_full') AS fullQA,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND qaType = 'excluded')   AS excluded,
          ISNULL((SELECT CAST(AVG(CAST(overallScore AS FLOAT)) AS DECIMAL(4,2)) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND qaType = 'ticket_full'), 0) AS avgScore,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND qaType = 'ticket_full' AND grade = 'GREEN') AS green,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND qaType = 'ticket_full' AND grade = 'AMBER') AS amber,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND qaType = 'ticket_full' AND grade = 'RED')   AS red,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(processedAt AS DATE) >= @start AND isConcerning = 1)     AS concerning
      `);
      res.json({ ok: true, data: result.recordset[0] ?? {}, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/qa-results?env=uat|live&days=30&page=1&limit=25&grade=GREEN&agent=X&concerning=1
  router.get('/qa-results', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days  = Math.min(parseInt(req.query.days  as string) || 30, 365);
      const page  = Math.max(parseInt(req.query.page  as string) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const offset = (page - 1) * limit;
      const safeStr = (v: unknown) => String(v ?? '').replace(/[^a-zA-Z0-9 \-_@.]/g, '').slice(0, 100);
      const grade = safeStr(req.query.grade).toUpperCase();
      const agent = safeStr(req.query.agent);
      const concerning = req.query.concerning === '1' || req.query.concerning === 'true';
      const gradeFilter     = ['GREEN','AMBER','RED'].includes(grade) ? `AND r.grade = '${grade}'` : '';
      const agentFilter     = agent ? `AND r.assigneeName = '${agent}'` : '';
      const concerningFilter = concerning ? 'AND r.isConcerning = 1' : '';
      const p = await getPool();
      const result = await p.request().query(`
        SELECT r.issueKey, r.assigneeName, r.grade,
               CAST(r.overallScore  AS FLOAT) AS overallScore,
               CAST(r.accuracyScore AS INT)   AS accuracyScore,
               CAST(r.clarityScore  AS INT)   AS clarityScore,
               CAST(r.toneScore     AS INT)   AS toneScore,
               CAST(r.closureScore  AS INT)   AS closureScore,
               r.category, r.issues, r.coachingPoints, r.suggestedReply, r.customerSentiment,
               CAST(r.isConcerning AS INT) AS isConcerning,
               r.ticketType, r.ticketPriority,
               CONVERT(VARCHAR(23), r.processedAt, 126) AS processedAt
        FROM dbo.jira_qa_results${s} r
        WHERE CAST(r.processedAt AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          AND r.qaType = 'ticket_full'
          ${gradeFilter} ${agentFilter} ${concerningFilter}
        ORDER BY r.processedAt DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `);
      res.json({ ok: true, data: result.recordset, page, limit, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/qa-agents?env=uat|live&days=30
  router.get('/qa-agents', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 30, 365);
      const p = await getPool();
      const hasDept = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'Department'`);
      const hasDeptLive = s ? await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`) : hasDept;
      const deptJoin = hasDept.recordset.length > 0
        ? `INNER JOIN dbo.Agent${s} ag ON ag.AgentName = q.assigneeName AND ag.Department = 'NT'`
        : hasDeptLive.recordset.length > 0 && s
          ? `INNER JOIN dbo.Agent ag ON ag.AgentName = q.assigneeName AND ag.Department = 'NT'`
          : '';
      const result = await p.request().query(`
        SELECT q.assigneeName,
               COUNT(*) AS total,
               SUM(CASE WHEN q.grade = 'GREEN' THEN 1 ELSE 0 END) AS green,
               SUM(CASE WHEN q.grade = 'AMBER' THEN 1 ELSE 0 END) AS amber,
               SUM(CASE WHEN q.grade = 'RED'   THEN 1 ELSE 0 END) AS red,
               CAST(AVG(CAST(q.overallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore,
               SUM(CAST(q.isConcerning AS INT)) AS concerning
        FROM dbo.jira_qa_results${s} q
        ${deptJoin}
        WHERE CAST(q.processedAt AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          AND q.qaType = 'ticket_full'
        GROUP BY q.assigneeName
        ORDER BY avgScore ASC
      `);
      res.json({ ok: true, data: result.recordset, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/qa-golden-summary?env=uat|live&days=7
  router.get('/qa-golden-summary', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 7, 365);
      const p = await getPool();
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          COUNT(*) AS total,
          SUM(CAST(rule1Pass AS INT)) AS rule1Pass,
          SUM(CAST(rule2Pass AS INT)) AS rule2Pass,
          SUM(CAST(rule3Pass AS INT)) AS rule3Pass,
          CAST(AVG(CAST(OverallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore,
          CAST(AVG(CAST(Rule1Score AS FLOAT)) AS DECIMAL(4,2)) AS avgRule1,
          CAST(AVG(CAST(Rule2Score AS FLOAT)) AS DECIMAL(4,2)) AS avgRule2,
          CAST(AVG(CAST(Rule3Score AS FLOAT)) AS DECIMAL(4,2)) AS avgRule3
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE CAST(processedAt AS DATE) >= @start
      `);
      res.json({ ok: true, data: result.recordset[0] ?? {}, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/qa-golden-results?env=uat|live&days=30&page=1&limit=25&agent=X&pass=0|1
  router.get('/qa-golden-results', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days  = Math.min(parseInt(req.query.days  as string) || 30, 365);
      const page  = Math.max(parseInt(req.query.page  as string) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const offset = (page - 1) * limit;
      const safeStr = (v: unknown) => String(v ?? '').replace(/[^a-zA-Z0-9 \-_@.]/g, '').slice(0, 100);
      const agent = safeStr(req.query.agent);
      const passFilter = req.query.pass === '0' ? 'AND (rule1Pass = 0 OR rule2Pass = 0 OR rule3Pass = 0)'
                       : req.query.pass === '1' ? 'AND rule1Pass = 1 AND rule2Pass = 1 AND rule3Pass = 1'
                       : '';
      const agentFilter = agent ? `AND ISNULL(Updater, '') = '${agent}'` : '';
      const p = await getPool();
      const result = await p.request().query(`
        SELECT IssueKey, CommentId, OverallScore, Rule1Score, Rule2Score, Rule3Score,
               rule1Pass, rule2Pass, rule3Pass,
               Summary, SuggestedRewrite, Assignee, Updater,
               ticketPriority, ticketType,
               CONVERT(VARCHAR(23), processedAt, 126) AS processedAt
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE CAST(processedAt AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          ${agentFilter} ${passFilter}
        ORDER BY processedAt DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `);
      res.json({ ok: true, data: result.recordset, page, limit, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/qa-golden-agents?env=uat|live&days=30
  router.get('/qa-golden-agents', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const days = Math.min(parseInt(req.query.days as string) || 30, 365);
      const p = await getPool();
      const hasDeptGr = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'Department'`);
      const hasDeptGrLive = s ? await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`) : hasDeptGr;
      const grDeptJoin = hasDeptGr.recordset.length > 0
        ? `INNER JOIN dbo.Agent${s} ag ON ag.AgentName = g.Updater AND ag.Department = 'NT'`
        : hasDeptGrLive.recordset.length > 0 && s
          ? `INNER JOIN dbo.Agent ag ON ag.AgentName = g.Updater AND ag.Department = 'NT'`
          : '';
      const result = await p.request().query(`
        SELECT g.Updater AS agentName,
               COUNT(*) AS total,
               SUM(CAST(g.rule1Pass AS INT)) AS rule1Pass,
               SUM(CAST(g.rule2Pass AS INT)) AS rule2Pass,
               SUM(CAST(g.rule3Pass AS INT)) AS rule3Pass,
               CAST(AVG(CAST(g.OverallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore
        FROM dbo.Jira_QA_GoldenRules${s} g
        ${grDeptJoin}
        WHERE CAST(g.processedAt AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          AND g.Updater IS NOT NULL AND g.Updater <> ''
        GROUP BY g.Updater
        ORDER BY avgScore ASC
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
        WHERE IsActive = 1
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
        SELECT AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team,
               IsActive, IsAvailable,
               ISNULL(MaxTickets, 0) AS MaxTickets,
               ISNULL(MaxTicketsCustomerCare, 0) AS MaxTicketsCustomerCare,
               ISNULL(MaxTicketsT2T3, 0) AS MaxTicketsT2T3
        FROM dbo.Agent
        ORDER BY Team, AgentName
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
      const { Team, TierCode, IsActive, IsAvailable, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3 } = req.body;

      const request = p.request();
      request.input('agentId', sql.Int, parseInt(agentId));
      request.input('team', sql.NVarChar, Team);
      request.input('tierCode', sql.NVarChar, TierCode);
      request.input('isActive', sql.Bit, IsActive ? 1 : 0);
      request.input('isAvailable', sql.Bit, IsAvailable ? 1 : 0);
      request.input('maxTickets', sql.Int, MaxTickets ?? 0);
      request.input('maxTicketsCC', sql.Int, MaxTicketsCustomerCare ?? 0);
      request.input('maxTicketsT2T3', sql.Int, MaxTicketsT2T3 ?? 0);

      await request.query(`
        UPDATE dbo.Agent SET
          Team = @team,
          TierCode = @tierCode,
          IsActive = @isActive,
          IsAvailable = @isAvailable,
          MaxTickets = @maxTickets,
          MaxTicketsCustomerCare = @maxTicketsCC,
          MaxTicketsT2T3 = @maxTicketsT2T3
        WHERE AgentId = @agentId
      `);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  // POST /api/admin/kpi-data/save-agent-daily — snapshot current Agent table → jira_agent_kpi_daily
  router.post('/save-agent-daily', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();

      // Read current Agent state for NT department
      const agents = await p.request().query(`
        SELECT AgentId, AgentName, AgentSurname, TierCode, Team,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               SolvedTickets_Today, SolvedTickets_ThisWeek
        FROM dbo.Agent${s}
        WHERE IsActive = 1
      `);

      if (agents.recordset.length === 0) {
        return res.json({ ok: true, inserted: 0, message: 'No active NT agents found' });
      }

      // Build a VALUES clause for bulk insert
      const today = new Date().toISOString().slice(0, 10);
      let inserted = 0;

      for (const a of agents.recordset) {
        const request = p.request();
        request.input('reportDate', sql.Date, today);
        request.input('agentName', sql.NVarChar, a.AgentName);
        request.input('agentSurname', sql.NVarChar, a.AgentSurname || '');
        request.input('tierCode', sql.NVarChar, a.TierCode || '');
        request.input('team', sql.NVarChar, a.Team || '');
        request.input('openTotal', sql.Int, a.OpenTickets_Total ?? 0);
        request.input('over2h', sql.Int, a.OpenTickets_Over2Hours ?? 0);
        request.input('noUpdate', sql.Int, a.OpenTickets_NoUpdateToday ?? 0);
        request.input('solvedToday', sql.Int, a.SolvedTickets_Today ?? 0);
        request.input('solvedWeek', sql.Int, a.SolvedTickets_ThisWeek ?? 0);

        await request.query(`
          MERGE dbo.jira_agent_kpi_daily${s} AS t
          USING (SELECT @reportDate AS ReportDate, @agentName AS AgentName) AS s
          ON t.ReportDate = s.ReportDate AND t.AgentName = s.AgentName
          WHEN MATCHED THEN UPDATE SET
            TierCode = @tierCode,
            Team = @team,
            OpenTickets_Total = @openTotal,
            OpenTickets_Over2Hours = @over2h,
            OpenTickets_NoUpdateToday = @noUpdate,
            SolvedTickets_Today = @solvedToday,
            SolvedTickets_ThisWeek = @solvedWeek
          WHEN NOT MATCHED THEN INSERT
            (ReportDate, AgentName, TierCode, Team,
             OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
             SolvedTickets_Today, SolvedTickets_ThisWeek)
          VALUES
            (@reportDate, @agentName, @tierCode, @team,
             @openTotal, @over2h, @noUpdate,
             @solvedToday, @solvedWeek);
        `);
        inserted++;
      }

      res.json({ ok: true, inserted, date: today, env });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Save failed' });
    }
  });

  // POST /api/admin/kpi-data/backfill-agent-daily — backfill from JiraEodTicketStatusSnapshot
  router.post('/backfill-agent-daily', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const { startDate, endDate } = req.body;

      if (!startDate || !endDate) {
        return res.status(400).json({ ok: false, error: 'startDate and endDate required (YYYY-MM-DD)' });
      }

      const p = await getPool();
      const request = p.request();
      request.input('startDate', sql.Date, startDate);
      request.input('endDate', sql.Date, endDate);

      // Step 1: Aggregate from JiraEodTicketStatusSnapshot per agent per day
      // Then MERGE into jira_agent_kpi_daily
      const result = await request.query(`
        ;WITH AgentDays AS (
          SELECT
            CAST(SnapshotDate AS DATE) AS ReportDate,
            Assignee AS AgentName,
            COUNT(*) AS OpenTickets_Total,
            SUM(CASE WHEN IsOver2Hours = 1 THEN 1 ELSE 0 END) AS OpenTickets_Over2Hours,
            SUM(CASE WHEN HasNoUpdateToday = 1 THEN 1 ELSE 0 END) AS OpenTickets_NoUpdateToday,
            SUM(CASE WHEN SolvedToday = 1 THEN 1 ELSE 0 END) AS SolvedTickets_Today
          FROM dbo.JiraEodTicketStatusSnapshot${s}
          WHERE CAST(SnapshotDate AS DATE) BETWEEN @startDate AND @endDate
            AND Assignee IS NOT NULL AND Assignee <> ''
            AND ProjectKey = 'NT'
          GROUP BY CAST(SnapshotDate AS DATE), Assignee
        )
        MERGE dbo.jira_agent_kpi_daily${s} AS t
        USING AgentDays AS s
        ON t.ReportDate = s.ReportDate AND t.AgentName = s.AgentName
        WHEN MATCHED THEN UPDATE SET
          OpenTickets_Total = s.OpenTickets_Total,
          OpenTickets_Over2Hours = s.OpenTickets_Over2Hours,
          OpenTickets_NoUpdateToday = s.OpenTickets_NoUpdateToday,
          SolvedTickets_Today = s.SolvedTickets_Today
        WHEN NOT MATCHED THEN INSERT
          (ReportDate, AgentName, OpenTickets_Total, OpenTickets_Over2Hours,
           OpenTickets_NoUpdateToday, SolvedTickets_Today)
        VALUES
          (s.ReportDate, s.AgentName, s.OpenTickets_Total, s.OpenTickets_Over2Hours,
           s.OpenTickets_NoUpdateToday, s.SolvedTickets_Today);

        SELECT @@ROWCOUNT AS [rowsAffected];
      `);

      const ticketRows = result.recordset?.[0]?.rowsAffected ?? 0;

      // Step 2: Backfill QA scores from jira_qa_results
      const qaRequest = p.request();
      qaRequest.input('startDate', sql.Date, startDate);
      qaRequest.input('endDate', sql.Date, endDate);
      const qaResult = await qaRequest.query(`
        ;WITH QaAgg AS (
          SELECT
            CAST(CreatedAt AS DATE) AS ReportDate,
            assigneeName AS AgentName,
            COUNT(*) AS QATicketsScored,
            AVG(CAST(overallScore AS FLOAT)) AS QAOverallAvg,
            AVG(CAST(accuracyScore AS FLOAT)) AS QAAccuracyAvg,
            AVG(CAST(clarityScore AS FLOAT)) AS QAClarityAvg,
            AVG(CAST(toneScore AS FLOAT)) AS QAToneAvg,
            SUM(CASE WHEN grade = 'red' THEN 1 ELSE 0 END) AS QARedCount,
            SUM(CASE WHEN grade = 'amber' THEN 1 ELSE 0 END) AS QAAmberCount,
            SUM(CASE WHEN grade = 'green' THEN 1 ELSE 0 END) AS QAGreenCount,
            SUM(CASE WHEN isConcerning = 1 THEN 1 ELSE 0 END) AS QAConcerningCount
          FROM dbo.jira_qa_results${s}
          WHERE CAST(CreatedAt AS DATE) BETWEEN @startDate AND @endDate
            AND assigneeName IS NOT NULL AND assigneeName <> ''
          GROUP BY CAST(CreatedAt AS DATE), assigneeName
        )
        UPDATE t SET
          t.QATicketsScored = q.QATicketsScored,
          t.QAOverallAvg = ROUND(q.QAOverallAvg, 1),
          t.QAAccuracyAvg = ROUND(q.QAAccuracyAvg, 1),
          t.QAClarityAvg = ROUND(q.QAClarityAvg, 1),
          t.QAToneAvg = ROUND(q.QAToneAvg, 1),
          t.QARedCount = q.QARedCount,
          t.QAAmberCount = q.QAAmberCount,
          t.QAGreenCount = q.QAGreenCount,
          t.QAConcerningCount = q.QAConcerningCount
        FROM dbo.jira_agent_kpi_daily${s} t
        INNER JOIN QaAgg q ON t.ReportDate = q.ReportDate AND t.AgentName = q.AgentName;

        SELECT @@ROWCOUNT AS [rowsAffected];
      `);

      const qaRows = qaResult.recordset?.[0]?.rowsAffected ?? 0;

      res.json({ ok: true, ticketRows, qaRows, startDate, endDate, env,
        note: 'SLA data cannot be backfilled (requires live Jira API). Only populated by v3.1 daily run.' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backfill failed' });
    }
  });

  // GET /api/admin/kpi-data/backfill-status — check what dates have data
  router.get('/backfill-status', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();

      const [dailyStats, eodStats] = await Promise.all([
        p.request().query(`
          SELECT MIN(ReportDate) AS earliest, MAX(ReportDate) AS latest,
                 COUNT(DISTINCT CONVERT(varchar(10), ReportDate, 23)) AS distinctDays,
                 COUNT(*) AS totalRows
          FROM dbo.jira_agent_kpi_daily${s}
        `),
        p.request().query(`
          SELECT MIN(CAST(SnapshotDate AS DATE)) AS earliest,
                 MAX(CAST(SnapshotDate AS DATE)) AS latest,
                 COUNT(DISTINCT CONVERT(varchar(10), SnapshotDate, 23)) AS distinctDays
          FROM dbo.JiraEodTicketStatusSnapshot${s}
        `),
      ]);

      res.json({
        ok: true,
        env,
        agentDaily: dailyStats.recordset[0],
        eodSnapshot: eodStats.recordset[0],
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}

/** Public (no-auth) wallboard endpoint for TV displays */
export function createKpiWallboardRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();

  let pool: sql.ConnectionPool | null = null;

  async function getPool(): Promise<sql.ConnectionPool> {
    if (pool?.connected) return pool;
    const settings = settingsQueries.getAll();
    const { kpi_sql_server: server, kpi_sql_database: database, kpi_sql_user: user, kpi_sql_password: password } = settings;
    if (!server || !database || !user || !password) throw new Error('KPI SQL not configured');
    pool = await new sql.ConnectionPool({
      server, database, user, password,
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
    }).connect();
    return pool;
  }

  // GET /api/public/wallboard/dedup — remove duplicate rows from KPI tables
  router.get('/dedup', async (_req, res) => {
    try {
      const p = await getPool();
      const results: Record<string, number> = {};

      // 1. jira_kpi_daily — keep only the latest row per (kpi, date)
      const r1 = await p.request().query(`
        WITH cte AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY kpi, CAST(CreatedAt AS date)
            ORDER BY CreatedAt DESC
          ) AS rn
          FROM dbo.jira_kpi_daily
        )
        DELETE FROM cte WHERE rn > 1
      `);
      results['jira_kpi_daily'] = r1.rowsAffected[0] ?? 0;

      // 2. jira_kpi_digest — keep only the latest row per (period, date)
      const r2 = await p.request().query(`
        WITH cte AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY period, CAST(CreatedAt AS date)
            ORDER BY CreatedAt DESC
          ) AS rn
          FROM dbo.jira_kpi_digest
        )
        DELETE FROM cte WHERE rn > 1
      `);
      results['jira_kpi_digest'] = r2.rowsAffected[0] ?? 0;

      // 3. JiraEodTicketStatusSnapshot — keep only latest per (SnapshotDate, ProjectKey, CurrentTier, StatusName, RequestTypeId)
      const r3 = await p.request().query(`
        WITH cte AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY SnapshotDate, ProjectKey, CurrentTier, StatusName, ISNULL(RequestTypeId, '')
            ORDER BY SnapshotAt DESC
          ) AS rn
          FROM dbo.JiraEodTicketStatusSnapshot
        )
        DELETE FROM cte WHERE rn > 1
      `);
      results['JiraEodTicketStatusSnapshot'] = r3.rowsAffected[0] ?? 0;

      // 4. KpiSnapshot — keep only latest per KPI (should already be handled by upsert, but just in case)
      const r4 = await p.request().query(`
        WITH cte AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY KPI
            ORDER BY CreatedAt DESC
          ) AS rn
          FROM dbo.KpiSnapshot
        )
        DELETE FROM cte WHERE rn > 1
      `);
      results['KpiSnapshot'] = r4.rowsAffected[0] ?? 0;

      res.json({ ok: true, message: 'Deduplication complete', removed: results });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Dedup failed: ' + (err instanceof Error ? err.message : 'unknown') });
    }
  });

  // GET /api/public/wallboard/team-kpis — team KPI snapshot for TV wallboard
  router.get('/team-kpis', async (_req, res) => {
    try {
      const p = await getPool();
      const result = await p.request().query(`
        SELECT KPI, KPIGroup, [Count], KPITarget, KPIDirection, RAG, CreatedAt
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
          FROM dbo.KpiSnapshot
        ) t WHERE rn = 1
        ORDER BY KPIGroup, KPI
      `);
      res.json({ ok: true, data: result.recordset, ts: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/public/wallboard/breached — agent breach data for TV wallboard
  router.get('/breached', async (_req, res) => {
    try {
      const p = await getPool();
      const hasOldest = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'OldestTicketDays'`);
      const oldestCol = hasOldest.recordset.length > 0 ? 'ISNULL(OldestTicketDays, 0)' : '0';
      const orderCol = hasOldest.recordset.length > 0 ? 'OldestTicketDays DESC,' : '';
      const hasOldestKey = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'OldestTicketKey'`);
      const oldestKeyCol = hasOldestKey.recordset.length > 0 ? ', OldestTicketKey' : '';
      const hasDept = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`);
      const deptFilter = hasDept.recordset.length > 0 ? "AND Department = 'NT'" : '';
      const result = await p.request().query(`
        SELECT AgentName, AgentSurname, TierCode, Team,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               ${oldestCol} AS OldestTicketDays${oldestKeyCol},
               SolvedTickets_Today, TicketsSnapshotAt
        FROM dbo.Agent
        WHERE IsActive = 1 ${deptFilter}
        ORDER BY OpenTickets_Over2Hours DESC, ${orderCol} AgentName
      `);
      res.json({ ok: true, data: result.recordset, ts: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}
