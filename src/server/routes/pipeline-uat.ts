import { Router } from 'express';
import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';

let pool: sql.ConnectionPool | null = null;

async function getKpiPool(settings: SettingsQueries): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  const all = settings.getAll();
  const { kpi_sql_server: server, kpi_sql_database: database, kpi_sql_user: user, kpi_sql_password: password } = all;
  if (!server || !database || !user || !password) throw new Error('KPI SQL Server not configured');
  pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();
  return pool;
}

const TABLE_MAP: Record<string, { table: string; dateCol: string }> = {
  kpi_daily: { table: 'dbo.jira_kpi_dailyUAT', dateCol: 'CreatedAt' },
  agent_kpi_daily: { table: 'dbo.jira_agent_kpi_dailyUAT', dateCol: 'ReportDate' },
  qa_results: { table: 'dbo.jira_qa_resultsUAT', dateCol: 'CreatedAt' },
  golden_rules: { table: 'dbo.Jira_QA_GoldenRulesUAT', dateCol: 'CreatedAt' },
  kpi_digest: { table: 'dbo.jira_kpi_digestUAT', dateCol: 'CreatedAt' },
};

const VALID_TABLES = Object.keys(TABLE_MAP);

export function createPipelineUatRoutes(deps: { settings: SettingsQueries }): Router {
  const router = Router();

  router.get('/uat-query', async (req, res) => {
    try {
      const tableKey = req.query.table as string;
      if (!tableKey || !VALID_TABLES.includes(tableKey)) {
        res.status(400).json({ ok: false, error: `Invalid table. Valid: ${VALID_TABLES.join(', ')}` });
        return;
      }
      const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 7, 1), 90);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 100, 1), 500);
      const { table, dateCol } = TABLE_MAP[tableKey];

      const p = await getKpiPool(deps.settings);
      const request = p.request();
      request.input('limit', sql.Int, limit);
      request.input('days', sql.Int, days);
      const result = await request.query(
        `SELECT TOP (@limit) * FROM ${table} WHERE ${dateCol} >= DATEADD(day, -@days, CAST(GETUTCDATE() AS DATE)) ORDER BY ${dateCol} DESC`
      );

      res.json({ ok: true, data: { rows: result.recordset, rowCount: result.recordset.length, table, days } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  router.get('/uat-schema', async (req, res) => {
    try {
      const tableKey = req.query.table as string;
      if (!tableKey || !VALID_TABLES.includes(tableKey)) {
        res.status(400).json({ ok: false, error: `Invalid table. Valid: ${VALID_TABLES.join(', ')}` });
        return;
      }
      const tableName = TABLE_MAP[tableKey].table.replace('dbo.', '');

      const p = await getKpiPool(deps.settings);
      const request = p.request();
      request.input('tableName', sql.NVarChar, tableName);
      const result = await request.query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tableName
        ORDER BY ORDINAL_POSITION
      `);

      res.json({ ok: true, data: { table: tableName, columns: result.recordset } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Schema query failed' });
    }
  });

  router.get('/uat-stats', async (req, res) => {
    try {
      const tableKey = req.query.table as string;
      if (!tableKey || !VALID_TABLES.includes(tableKey)) {
        res.status(400).json({ ok: false, error: `Invalid table. Valid: ${VALID_TABLES.join(', ')}` });
        return;
      }

      const p = await getKpiPool(deps.settings);
      const stats = await queryStats(p, tableKey);
      res.json({ ok: true, data: { table: TABLE_MAP[tableKey].table, stats } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stats query failed';
      if (msg.includes('Invalid object name')) {
        res.json({ ok: true, data: { table: req.query.table, error: 'Table does not exist' } });
      } else {
        res.status(500).json({ ok: false, error: msg });
      }
    }
  });

  return router;
}

async function queryStats(p: sql.ConnectionPool, tableKey: string): Promise<any> {
  switch (tableKey) {
    case 'qa_results': {
      const r = await p.request().query(`
        SELECT
          COUNT(*) AS totalRows,
          SUM(CASE WHEN CreatedAt >= DATEADD(day, -1, GETUTCDATE()) THEN 1 ELSE 0 END) AS rowsToday,
          SUM(CASE WHEN CreatedAt >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) AS rowsThisWeek,
          SUM(CASE WHEN grade = 'Green' THEN 1 ELSE 0 END) AS greenCount,
          SUM(CASE WHEN grade = 'Amber' THEN 1 ELSE 0 END) AS amberCount,
          SUM(CASE WHEN grade = 'Red' THEN 1 ELSE 0 END) AS redCount,
          SUM(CASE WHEN grade = 'EXCLUDED' THEN 1 ELSE 0 END) AS excludedCount,
          SUM(CASE WHEN isConcerning = 1 THEN 1 ELSE 0 END) AS concerningCount,
          CAST(AVG(CAST(overallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgScore,
          CAST(AVG(CAST(closureScore AS FLOAT)) AS DECIMAL(4,2)) AS avgClosureScore,
          SUM(CASE WHEN closureScore IS NULL THEN 1 ELSE 0 END) AS nullClosureScore,
          SUM(CASE WHEN coachingPoints IS NULL THEN 1 ELSE 0 END) AS nullCoachingPoints,
          SUM(CASE WHEN suggestedReply IS NULL THEN 1 ELSE 0 END) AS nullSuggestedReply,
          SUM(CASE WHEN customerSentiment IS NULL THEN 1 ELSE 0 END) AS nullCustomerSentiment,
          SUM(CASE WHEN processedAt IS NULL THEN 1 ELSE 0 END) AS nullProcessedAt,
          MIN(CreatedAt) AS earliestRow,
          MAX(CreatedAt) AS latestRow
        FROM dbo.jira_qa_resultsUAT
      `);
      return r.recordset[0];
    }
    case 'golden_rules': {
      const r = await p.request().query(`
        SELECT
          COUNT(*) AS totalRows,
          SUM(CASE WHEN CreatedAt >= DATEADD(day, -1, GETUTCDATE()) THEN 1 ELSE 0 END) AS rowsToday,
          SUM(CASE WHEN CreatedAt >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) AS rowsThisWeek,
          CAST(AVG(CAST(OverallScore AS FLOAT)) AS DECIMAL(4,2)) AS avgOverallScore,
          CAST(AVG(CAST(rule1Pass AS FLOAT)) * 100 AS DECIMAL(5,1)) AS rule1PassPct,
          CAST(AVG(CAST(rule2Pass AS FLOAT)) * 100 AS DECIMAL(5,1)) AS rule2PassPct,
          CAST(AVG(CAST(rule3Pass AS FLOAT)) * 100 AS DECIMAL(5,1)) AS rule3PassPct,
          SUM(CASE WHEN CommentId IS NULL THEN 1 ELSE 0 END) AS nullCommentId,
          SUM(CASE WHEN SuggestedRewrite IS NULL THEN 1 ELSE 0 END) AS nullSuggestedRewrite,
          SUM(CASE WHEN agentEmail IS NULL THEN 1 ELSE 0 END) AS nullAgentEmail,
          SUM(CASE WHEN CommentBody IS NULL THEN 1 ELSE 0 END) AS nullCommentBody,
          COUNT(DISTINCT IssueKey) AS distinctIssues,
          COUNT(DISTINCT CommentId) AS distinctComments,
          MIN(CreatedAt) AS earliestRow,
          MAX(CreatedAt) AS latestRow
        FROM dbo.Jira_QA_GoldenRulesUAT
      `);
      return r.recordset[0];
    }
    case 'kpi_daily': {
      const r = await p.request().query(`
        SELECT
          COUNT(*) AS totalRows,
          SUM(CASE WHEN CreatedAt >= DATEADD(day, -1, GETUTCDATE()) THEN 1 ELSE 0 END) AS rowsToday,
          COUNT(DISTINCT kpi) AS distinctKpis,
          COUNT(DISTINCT CAST(CreatedAt AS DATE)) AS distinctDays,
          SUM(CASE WHEN kpiGroup IS NULL THEN 1 ELSE 0 END) AS nullKpiGroup,
          SUM(CASE WHEN target IS NULL THEN 1 ELSE 0 END) AS nullTarget,
          SUM(CASE WHEN direction IS NULL THEN 1 ELSE 0 END) AS nullDirection,
          SUM(CASE WHEN rag IS NULL THEN 1 ELSE 0 END) AS nullRag,
          MIN(CreatedAt) AS earliestRow,
          MAX(CreatedAt) AS latestRow
        FROM dbo.jira_kpi_dailyUAT
      `);
      return r.recordset[0];
    }
    case 'agent_kpi_daily': {
      const r = await p.request().query(`
        SELECT
          COUNT(*) AS totalRows,
          SUM(CASE WHEN ReportDate >= DATEADD(day, -1, GETUTCDATE()) THEN 1 ELSE 0 END) AS rowsToday,
          COUNT(DISTINCT AgentName) AS distinctAgents,
          COUNT(DISTINCT ReportDate) AS distinctDays,
          MIN(ReportDate) AS earliestRow,
          MAX(ReportDate) AS latestRow
        FROM dbo.jira_agent_kpi_dailyUAT
      `);
      return r.recordset[0];
    }
    case 'kpi_digest': {
      const r = await p.request().query(`
        SELECT
          COUNT(*) AS totalRows,
          SUM(CASE WHEN period = 'daily' THEN 1 ELSE 0 END) AS dailyCount,
          SUM(CASE WHEN period = 'weekly' THEN 1 ELSE 0 END) AS weeklyCount,
          MIN(CreatedAt) AS earliestRow,
          MAX(CreatedAt) AS latestRow
        FROM dbo.jira_kpi_digestUAT
      `);
      return r.recordset[0];
    }
    default:
      return { error: 'Unknown table' };
  }
}
