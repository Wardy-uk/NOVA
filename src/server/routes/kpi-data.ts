import { Router } from 'express';
import sql from 'mssql';

import type { SettingsQueries } from '../db/settings-store.js';
import type { FileUserQueries } from '../db/user-store.js';
import { isAdmin } from '../utils/role-helpers.js';
import { ssoLogger } from '../services/sso-logger.js';
import { TEAM_AGENTS } from './trends.js';

// Expected future KPI names in dbo.KpiSnapshot (will render automatically once data flows):
// - "CSAT" or "Customer Satisfaction" — CSAT score, direction: higher is better
// - "FCR Rate" or "First Contact Resolution" — FCR %, direction: higher is better, target: 15% improvement

const VALID_ENVS = ['live', 'uat'] as const;
type Env = (typeof VALID_ENVS)[number];

function suffix(env: Env): string {
  return env === 'uat' ? 'UAT' : '';
}

export function createKpiDataRoutes(settingsQueries: SettingsQueries, userQueries: FileUserQueries): Router {
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

  /**
   * For non-admin users: look up their email from the local user store,
   * then find the matching AgentName in dbo.Agent (AgentKey stores the email).
   * Returns null if the user is admin or no match is found.
   */
  async function resolveAgentScope(req: any): Promise<string | null> {
    if (!req.user || isAdmin(req.user.role)) return null;
    const user = userQueries.getById(req.user.id);
    if (!user?.email) {
      ssoLogger.warn('agent_scope', `No email on user — cannot scope QA`, { userId: req.user.id, username: req.user.username });
      return null;
    }
    const p = await getPool();
    const r = p.request();
    r.input('email', sql.NVarChar, user.email.toLowerCase());
    const result = await r.query(`
      SELECT TOP 1
        LTRIM(RTRIM(AgentName)) + ' ' + LTRIM(RTRIM(AgentSurname)) AS FullName,
        LTRIM(RTRIM(AgentName)) AS FirstName
      FROM dbo.Agent
      WHERE LOWER(LTRIM(RTRIM(AgentKey))) = @email
    `);
    const row = result.recordset[0];
    const agentName = row ? (row.FullName?.trim() || row.FirstName?.trim() || null) : null;
    ssoLogger.log('agent_scope', `Resolved agent scope`, { userId: req.user.id, email: user.email, agentName: agentName ?? '(no match — showing all)' });
    return agentName;
  }

  // GET /api/admin/kpi-data/team-snapshot?env=live|uat
  router.get('/team-snapshot', async (req, res) => {
    try {
      const env = parseEnv(req);
      const s = suffix(env);
      const p = await getPool();
      // Fallback targets for KPIs where n8n writes 0/null as the target
      // Keys are lowercase for case-insensitive matching
      const TARGET_FALLBACKS: Record<string, { target: number; direction: string }> = {
        'frt compliance % (open queue)': { target: 95, direction: 'higher is better' },
        'frt compliance % (resolved today)': { target: 95, direction: 'higher is better' },
        'resolution compliance % (open queue)': { target: 95, direction: 'higher is better' },
        'resolution compliance % (resolved today)': { target: 95, direction: 'higher is better' },
        'cc incidents over sla (actionable)': { target: 0, direction: 'lower is better' },
        'cc service requests over sla (actionable)': { target: 0, direction: 'lower is better' },
        'cc tpj over sla (actionable)': { target: 0, direction: 'lower is better' },
        'cc (tpj) over sla (actionable)': { target: 0, direction: 'lower is better' },
        'production over sla (actionable)': { target: 0, direction: 'lower is better' },
        'tier 2 over sla (actionable)': { target: 0, direction: 'lower is better' },
        'tier 3 over sla (actionable)': { target: 0, direction: 'lower is better' },
        'development over sla (actionable)': { target: 0, direction: 'lower is better' },
      };
      // Also match any KPI containing these patterns (catch name variants)
      const PATTERN_FALLBACKS: { pattern: RegExp; target: number; direction: string }[] = [
        { pattern: /frt compliance/i, target: 95, direction: 'higher is better' },
        { pattern: /resolution compliance/i, target: 95, direction: 'higher is better' },
        { pattern: /over sla \(actionable\)/i, target: 0, direction: 'lower is better' },
      ];
      const result = await p.request().query(`
        SELECT KPI, KPIGroup, [Count], KPITarget, KPIDirection, RAG, CreatedAt
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
          FROM dbo.KpiSnapshot${s}
        ) t WHERE rn = 1
        ORDER BY KPIGroup, KPI
      `);
      // Apply target fallbacks where KPITarget is 0 or null
      for (const row of result.recordset) {
        if (row.KPITarget && row.KPITarget !== 0) continue;
        const fb = TARGET_FALLBACKS[row.KPI.toLowerCase().trim()];
        if (fb) {
          row.KPITarget = fb.target;
          if (!row.KPIDirection) row.KPIDirection = fb.direction;
        } else {
          // Try pattern matching as fallback
          const pf = PATTERN_FALLBACKS.find(p => p.pattern.test(row.KPI));
          if (pf) {
            row.KPITarget = pf.target;
            if (!row.KPIDirection) row.KPIDirection = pf.direction;
          }
        }
      }
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
      // Check both Agent and AgentUAT for Department column
      const hasDept = await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent${s}') AND name = 'Department'`);
      const hasDeptLive = s ? await p.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`) : hasDept;
      const oldestKeySelect = hasOldestKey.recordset.length > 0 ? ', a.OldestTicketKey' : '';
      const deptSelect = hasDept.recordset.length > 0 ? ', a.Department' : '';
      const deptWhere = hasDept.recordset.length > 0
        ? "AND a.Department = 'NT'"
        : hasDeptLive.recordset.length > 0 && s
          ? `AND a.AgentName IN (SELECT AgentName FROM dbo.Agent WHERE Department = 'NT')`
          : '';
      const result = await p.request().query(`
        SELECT a.AgentId, a.AgentKey, a.AgentName, a.AgentSurname, a.TierCode, a.Team,
               a.IsActive, a.IsAvailable, a.AccountId,
               a.OpenTickets_Total, a.OpenTickets_Over2Hours, a.OpenTickets_NoUpdateToday,
               ${oldestCol} AS OldestTicketDays${oldestKeySelect},
               a.SolvedTickets_Today, a.SolvedTickets_ThisWeek, a.TicketsSnapshotAt${deptSelect},
               qa.QAAvgScore, qa.QACount
        FROM dbo.Agent${s} a
        LEFT JOIN (
          SELECT assigneeName,
                 CAST(AVG(CAST(overallScore AS FLOAT)) AS DECIMAL(3,2)) AS QAAvgScore,
                 COUNT(*) AS QACount
          FROM dbo.jira_qa_results${s}
          WHERE CAST(CreatedAt AS DATE) >= DATEADD(DAY, -30, CAST(GETUTCDATE() AS DATE))
            AND ISNULL(qaType, '') <> 'excluded'
          GROUP BY assigneeName
        ) qa ON qa.assigneeName = LTRIM(RTRIM(a.AgentName)) + ' ' + LTRIM(RTRIM(a.AgentSurname))
        WHERE a.IsActive = 1 ${deptWhere}
        ORDER BY a.Team, a.AgentName
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
        deptJoin = `INNER JOIN dbo.Agent${s} a ON LTRIM(RTRIM(a.AgentName)) + ' ' + LTRIM(RTRIM(ISNULL(a.AgentSurname,''))) = d.AgentName OR a.AgentName = d.AgentName`;
        deptWhere = "AND a.Department = 'NT'";
      } else if (hasDeptLive.recordset.length > 0) {
        deptJoin = `INNER JOIN dbo.Agent a ON LTRIM(RTRIM(a.AgentName)) + ' ' + LTRIM(RTRIM(ISNULL(a.AgentSurname,''))) = d.AgentName OR a.AgentName = d.AgentName`;
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
      const agentName = await resolveAgentScope(req);
      const agentFilter = agentName ? `AND assigneeName = '${agentName.replace(/'/g, "''")}'` : '';
      const p = await getPool();
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND ISNULL(qaType, '') <> 'excluded' ${agentFilter}) AS fullQA,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND qaType = 'excluded' ${agentFilter})   AS excluded,
          ISNULL((SELECT CAST(AVG(CAST(overallScore AS FLOAT)) AS DECIMAL(4,2)) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND ISNULL(qaType, '') <> 'excluded' ${agentFilter}), 0) AS avgScore,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND ISNULL(qaType, '') <> 'excluded' AND grade = 'GREEN' ${agentFilter}) AS green,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND ISNULL(qaType, '') <> 'excluded' AND grade = 'AMBER' ${agentFilter}) AS amber,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND ISNULL(qaType, '') <> 'excluded' AND grade = 'RED' ${agentFilter})   AS red,
          (SELECT COUNT(*) FROM dbo.jira_qa_results${s} WHERE CAST(CreatedAt AS DATE) >= @start AND isConcerning = 1 ${agentFilter})     AS concerning
      `);
      const jiraBaseUrl = settingsQueries.getAll().jira_url ?? null;
      res.json({ ok: true, data: { ...(result.recordset[0] ?? {}), jiraBaseUrl }, env });
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
      const concerning = req.query.concerning === '1' || req.query.concerning === 'true';
      const gradeFilter     = ['GREEN','AMBER','RED'].includes(grade) ? `AND r.grade = '${grade}'` : '';
      const concerningFilter = concerning ? 'AND r.isConcerning = 1' : '';
      // Non-admin: scope to own results; admin: honour ?agent= param
      const scopedAgent = await resolveAgentScope(req);
      const agent = scopedAgent ?? safeStr(req.query.agent);
      const agentFilter     = agent ? `AND r.assigneeName = '${agent}'` : '';
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
               CONVERT(VARCHAR(23), r.CreatedAt, 126) AS processedAt
        FROM dbo.jira_qa_results${s} r
        WHERE CAST(r.CreatedAt AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          AND ISNULL(r.qaType, '') <> 'excluded'
          ${gradeFilter} ${agentFilter} ${concerningFilter}
        ORDER BY r.CreatedAt DESC
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
      const agentName = await resolveAgentScope(req);
      const agentFilter = agentName ? `AND q.assigneeName = '${agentName.replace(/'/g, "''")}'` : '';
      const p = await getPool();
      const result = await p.request().query(`
        SELECT q.assigneeName,
               COUNT(*) AS total,
               SUM(CASE WHEN q.grade = 'GREEN' THEN 1 ELSE 0 END) AS green,
               SUM(CASE WHEN q.grade = 'AMBER' THEN 1 ELSE 0 END) AS amber,
               SUM(CASE WHEN q.grade = 'RED'   THEN 1 ELSE 0 END) AS red,
               CAST(AVG(CAST(q.overallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore,
               SUM(CAST(q.isConcerning AS INT)) AS concerning
        FROM dbo.jira_qa_results${s} q
        WHERE CAST(q.CreatedAt AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          AND ISNULL(q.qaType, '') <> 'excluded'
          AND q.assigneeName IN (${TEAM_AGENTS.map(n => `'${n}'`).join(',')})
          ${agentFilter}
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
      const agentName = await resolveAgentScope(req);
      const agentFilter = agentName ? `AND ISNULL(Updater, '') = '${agentName.replace(/'/g, "''")}'` : '';
      const p = await getPool();
      // Detect which columns exist — live table may have different schema
      const cols = await p.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Jira_QA_GoldenRules${s}')`);
      const colSet = new Set(cols.recordset.map((r: any) => r.name.toLowerCase()));
      const has = (c: string) => colSet.has(c.toLowerCase());
      const hasProcessedAt = has('processedAt');
      const dateCol = hasProcessedAt ? 'processedAt' : 'CreatedAt';
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          COUNT(*) AS total,
          ${has('rule1Pass') ? 'SUM(CAST(rule1Pass AS INT))' : '0'} AS rule1Pass,
          ${has('rule2Pass') ? 'SUM(CAST(rule2Pass AS INT))' : '0'} AS rule2Pass,
          ${has('rule3Pass') ? 'SUM(CAST(rule3Pass AS INT))' : '0'} AS rule3Pass,
          CAST(AVG(CAST(OverallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore,
          ${has('Rule1Score') ? 'CAST(AVG(CAST(Rule1Score AS FLOAT)) AS DECIMAL(4,2))' : '0'} AS avgRule1,
          ${has('Rule2Score') ? 'CAST(AVG(CAST(Rule2Score AS FLOAT)) AS DECIMAL(4,2))' : '0'} AS avgRule2,
          ${has('Rule3Score') ? 'CAST(AVG(CAST(Rule3Score AS FLOAT)) AS DECIMAL(4,2))' : '0'} AS avgRule3
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE CAST(${dateCol} AS DATE) >= @start
          ${agentFilter}
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
      // Non-admin: scope to own results; admin: honour ?agent= param
      const scopedAgent = await resolveAgentScope(req);
      const agent = scopedAgent ?? safeStr(req.query.agent);
      const agentFilter = agent ? `AND ISNULL(Updater, '') = '${agent}'` : '';
      const p = await getPool();
      // Detect columns — live table may differ from UAT
      const cols = await p.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Jira_QA_GoldenRules${s}')`);
      const colSet = new Set(cols.recordset.map((r: any) => r.name.toLowerCase()));
      const has = (c: string) => colSet.has(c.toLowerCase());
      const hasProcessedAt = has('processedAt');
      const dateCol = hasProcessedAt ? 'processedAt' : 'CreatedAt';
      // Build pass filter only for columns that exist
      const passFailParts: string[] = [];
      const passAllParts: string[] = [];
      for (const rc of ['rule1Pass', 'rule2Pass', 'rule3Pass']) {
        if (has(rc)) { passFailParts.push(`${rc} = 0`); passAllParts.push(`${rc} = 1`); }
      }
      const passFilter = req.query.pass === '0' && passFailParts.length ? `AND (${passFailParts.join(' OR ')})`
                       : req.query.pass === '1' && passAllParts.length ? `AND ${passAllParts.join(' AND ')}`
                       : '';
      // Build SELECT columns dynamically
      const selCols = ['IssueKey', 'CommentId', 'OverallScore'];
      for (const c of ['Rule1Score', 'Rule2Score', 'Rule3Score', 'rule1Pass', 'rule2Pass', 'rule3Pass',
                        'Summary', 'SuggestedRewrite', 'Assignee', 'Updater', 'ticketPriority', 'ticketType']) {
        if (has(c)) selCols.push(c);
      }
      const result = await p.request().query(`
        SELECT ${selCols.join(', ')},
               CONVERT(VARCHAR(23), ${dateCol}, 126) AS processedAt
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE CAST(${dateCol} AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          ${agentFilter} ${passFilter}
        ORDER BY ${dateCol} DESC
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
      const agentName = await resolveAgentScope(req);
      const agentFilter = agentName ? `AND ISNULL(g.Updater, '') = '${agentName.replace(/'/g, "''")}'` : '';
      const p = await getPool();
      // Detect columns — live table may differ from UAT
      const cols = await p.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Jira_QA_GoldenRules${s}')`);
      const colSet = new Set(cols.recordset.map((r: any) => r.name.toLowerCase()));
      const has = (c: string) => colSet.has(c.toLowerCase());
      const hasProcessedAt = has('processedAt');
      const dateCol = hasProcessedAt ? 'g.processedAt' : 'g.CreatedAt';
      const result = await p.request().query(`
        SELECT g.Updater AS agentName,
               COUNT(*) AS total,
               ${has('rule1Pass') ? 'SUM(CAST(g.rule1Pass AS INT))' : '0'} AS rule1Pass,
               ${has('rule2Pass') ? 'SUM(CAST(g.rule2Pass AS INT))' : '0'} AS rule2Pass,
               ${has('rule3Pass') ? 'SUM(CAST(g.rule3Pass AS INT))' : '0'} AS rule3Pass,
               CAST(AVG(CAST(g.OverallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore
        FROM dbo.Jira_QA_GoldenRules${s} g
        WHERE CAST(${dateCol} AS DATE) >= DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE))
          AND g.Updater IN (${TEAM_AGENTS.map(n => `'${n}'`).join(',')})
          AND g.IssueKey LIKE 'NT-%'
          ${agentFilter}
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

  // ------------------------------------------------------------------ //
  //  Call QA  (n8n.dbo.SupportCallAnalysis — same SQL Server)          //
  // ------------------------------------------------------------------ //

  // GET /api/kpi-data/call-qa-summary?days=7
  router.get('/call-qa-summary', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days as string) || 7, 365);
      const agentName = await resolveAgentScope(req);
      const agentFilter = agentName ? `AND AgentName = '${agentName.replace(/'/g, "''")}'` : '';
      const p = await getPool();
      // Check if n8n.dbo.SupportCallAnalysis exists — may not be on live
      const tblCheck = await p.request().query(`SELECT OBJECT_ID('n8n.dbo.SupportCallAnalysis') AS oid`);
      if (!tblCheck.recordset[0]?.oid) {
        return res.json({ ok: true, data: { total: 0, avgOverall: null, avgTone: null, avgConfidence: null, avgKnowledge: null, avgFlow: null, avgSatisfaction: null, green: 0, amber: 0, red: 0 }, notice: 'Call QA table not available' });
      }
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          COUNT(*)                                                                      AS total,
          CAST(AVG(CAST(OverallScore      AS FLOAT)) AS DECIMAL(4,2))                 AS avgOverall,
          CAST(AVG(CAST(ToneScore         AS FLOAT)) AS DECIMAL(4,2))                 AS avgTone,
          CAST(AVG(CAST(ConfidenceScore   AS FLOAT)) AS DECIMAL(4,2))                 AS avgConfidence,
          CAST(AVG(CAST(KnowledgeScore    AS FLOAT)) AS DECIMAL(4,2))                 AS avgKnowledge,
          CAST(AVG(CAST(FlowScore         AS FLOAT)) AS DECIMAL(4,2))                 AS avgFlow,
          CAST(AVG(CAST(SatisfactionScore AS FLOAT)) AS DECIMAL(4,2))                 AS avgSatisfaction,
          SUM(CASE WHEN OverallScore >= 7.5 THEN 1 ELSE 0 END)                        AS green,
          SUM(CASE WHEN OverallScore >= 5.5 AND OverallScore < 7.5 THEN 1 ELSE 0 END) AS amber,
          SUM(CASE WHEN OverallScore < 5.5  THEN 1 ELSE 0 END)                        AS red
        FROM n8n.dbo.SupportCallAnalysis
        WHERE CAST(CallEndTime AS DATE) >= @start
          ${agentFilter}
      `);
      res.json({ ok: true, data: result.recordset[0] ?? {} });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/call-qa-agents?days=7
  router.get('/call-qa-agents', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days as string) || 7, 365);
      const agentName = await resolveAgentScope(req);
      const agentFilter = agentName ? `AND AgentName = '${agentName.replace(/'/g, "''")}'` : '';
      const p = await getPool();
      const tblCheck = await p.request().query(`SELECT OBJECT_ID('n8n.dbo.SupportCallAnalysis') AS oid`);
      if (!tblCheck.recordset[0]?.oid) {
        return res.json({ ok: true, data: [], notice: 'Call QA table not available' });
      }
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          AgentName,
          COUNT(*)                                                                      AS total,
          CAST(AVG(CAST(OverallScore      AS FLOAT)) AS DECIMAL(4,2))                 AS avgOverall,
          CAST(AVG(CAST(ToneScore         AS FLOAT)) AS DECIMAL(4,2))                 AS avgTone,
          CAST(AVG(CAST(ConfidenceScore   AS FLOAT)) AS DECIMAL(4,2))                 AS avgConfidence,
          CAST(AVG(CAST(KnowledgeScore    AS FLOAT)) AS DECIMAL(4,2))                 AS avgKnowledge,
          CAST(AVG(CAST(FlowScore         AS FLOAT)) AS DECIMAL(4,2))                 AS avgFlow,
          CAST(AVG(CAST(SatisfactionScore AS FLOAT)) AS DECIMAL(4,2))                 AS avgSatisfaction,
          SUM(CASE WHEN OverallScore >= 7.5 THEN 1 ELSE 0 END)                        AS green,
          SUM(CASE WHEN OverallScore >= 5.5 AND OverallScore < 7.5 THEN 1 ELSE 0 END) AS amber,
          SUM(CASE WHEN OverallScore < 5.5  THEN 1 ELSE 0 END)                        AS red
        FROM n8n.dbo.SupportCallAnalysis
        WHERE CAST(CallEndTime AS DATE) >= @start
          AND AgentName IS NOT NULL AND AgentName <> ''
          ${agentFilter}
        GROUP BY AgentName
        ORDER BY avgOverall ASC
      `);
      res.json({ ok: true, data: result.recordset });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // GET /api/kpi-data/call-qa-results?days=7&page=1&limit=25&agent=X&grade=GREEN
  router.get('/call-qa-results', async (req, res) => {
    try {
      const days  = Math.min(parseInt(req.query.days  as string) || 7, 365);
      const page  = Math.max(parseInt(req.query.page  as string) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const offset = (page - 1) * limit;
      const safeStr = (v: unknown) => String(v ?? '').replace(/[^a-zA-Z0-9 \-_@.]/g, '').slice(0, 100);
      const gradeParam = safeStr(req.query.grade).toUpperCase();
      // Non-admin: scope to own results; admin: honour ?agent= param
      const scopedAgent = await resolveAgentScope(req);
      const agent = scopedAgent ?? safeStr(req.query.agent);
      const agentFilter = agent ? `AND AgentName = '${agent}'` : '';
      const gradeFilter = gradeParam === 'GREEN'
        ? 'AND OverallScore >= 7.5'
        : gradeParam === 'AMBER'
          ? 'AND OverallScore >= 5.5 AND OverallScore < 7.5'
          : gradeParam === 'RED'
            ? 'AND OverallScore < 5.5'
            : '';
      const p = await getPool();
      const tblCheck = await p.request().query(`SELECT OBJECT_ID('n8n.dbo.SupportCallAnalysis') AS oid`);
      if (!tblCheck.recordset[0]?.oid) {
        return res.json({ ok: true, data: [], notice: 'Call QA table not available' });
      }
      const result = await p.request().query(`
        DECLARE @start DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          CallId, AgentName, CallEndTime, CallSummary,
          CAST(OverallScore      AS FLOAT) AS OverallScore,
          CAST(ToneScore         AS FLOAT) AS ToneScore,         ToneReason,
          CAST(ConfidenceScore   AS FLOAT) AS ConfidenceScore,   ConfidenceReason,
          CAST(KnowledgeScore    AS FLOAT) AS KnowledgeScore,    KnowledgeReason,
          CAST(FlowScore         AS FLOAT) AS FlowScore,         FlowReason,
          CAST(SatisfactionScore AS FLOAT) AS SatisfactionScore, SatisfactionReason,
          Strengths, Improvements, Recommendations
        FROM n8n.dbo.SupportCallAnalysis
        WHERE CAST(CallEndTime AS DATE) >= @start
          ${agentFilter}
          ${gradeFilter}
        ORDER BY CallEndTime DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `);
      res.json({ ok: true, data: result.recordset });
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
