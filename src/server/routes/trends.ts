import { Router } from 'express';
import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';
import type { FileUserQueries } from '../db/user-store.js';

const VALID_ENVS = ['live', 'uat'] as const;
type Env = (typeof VALID_ENVS)[number];

function suffix(env: Env): string {
  return env === 'uat' ? 'UAT' : '';
}

/** Active support team members — used to filter agent dropdowns across KPI/QA views */
export const TEAM_AGENTS = [
  'Naomi Wentworth', 'Nick Ward', 'Heidi Power', 'Sebastian Broome',
  'Nathan Rutland', 'Isabel Busk', 'Arman Shazad', 'Zoe Rees',
  'Kayleigh Russell', 'Hope Goodall', 'Abdi Mohamed', 'Willem Kruger',
  'Stephen Mitchell', 'Luke Scaife',
] as const;

// Checkpoint dates for the 90-day framework
const CHECKPOINTS = [
  { label: 'Day 0', date: '2026-03-09' },
  { label: 'Day 1', date: '2026-03-16' },
  { label: 'Day 15', date: '2026-03-31' },
  { label: 'Day 30', date: '2026-04-15' },
  { label: 'Day 45', date: '2026-04-30' },
  { label: 'Day 60', date: '2026-05-15' },
  { label: 'Day 90', date: '2026-06-14' },
] as const;

// Core metrics tracked in checkpoint evidence panel
interface CheckpointMetric {
  key: string;
  label: string;
  kpiPattern?: string;
  source?: 'qa' | 'golden';
  target: number | null;
  direction: string;
}

const CHECKPOINT_METRICS: CheckpointMetric[] = [
  { key: 'frt_compliance', label: 'FRT Compliance %', kpiPattern: 'FRT Compliance%Open Queue%', target: 95, direction: 'higher' },
  { key: 'resolution_compliance', label: 'Resolution Compliance %', kpiPattern: 'Resolution Compliance%Open Queue%', target: 95, direction: 'higher' },
  { key: 'escalation_accuracy', label: 'Escalation Accuracy %', kpiPattern: 'Escalation Accuracy%', target: 90, direction: 'higher' },
  { key: 'team_qa_avg', label: 'Team QA Avg (V5)', source: 'qa', target: 8.0, direction: 'higher' },
  { key: 'golden_rules_avg', label: 'Golden Rules Avg %', source: 'golden', target: 80, direction: 'higher' },
  { key: 'dev_queue_size', label: 'Dev Queue Size', kpiPattern: 'Number of Tickets in Development', target: 125, direction: 'lower' },
  { key: 'oldest_dev_ticket', label: 'Oldest Dev Ticket (days)', kpiPattern: 'Oldest actionable ticket (days) in Development', target: 31, direction: 'lower' },
  { key: 'csat', label: 'CSAT %', kpiPattern: 'CSAT%', target: null, direction: 'higher' },
  { key: 'fcr', label: 'FCR Rate %', kpiPattern: 'FCR%', target: null, direction: 'higher' },
];

export function createTrendsRoutes(settingsQueries: SettingsQueries, _userQueries: FileUserQueries): Router {
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
      throw new Error('KPI SQL Server not configured.');
    }

    pool = await new sql.ConnectionPool({
      server, database, user, password,
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
    }).connect();
    return pool;
  }

  function parseEnv(req: any): Env {
    const env = req.query.env as string;
    if (VALID_ENVS.includes(env as Env)) return env as Env;
    return 'live';
  }

  // ─── GET /api/trends/checkpoint ───
  // Returns checkpoint evidence panel data
  router.get('/checkpoint', async (req, res) => {
    try {
      const p = await getPool();
      const env = parseEnv(req);

      const metrics: any[] = [];

      for (const metric of CHECKPOINT_METRICS) {
        const row: any = {
          key: metric.key,
          label: metric.label,
          target: metric.target,
          direction: metric.direction,
          checkpoints: {},
          current: null,
        };

        if (metric.source === 'qa') {
          // QA avg from jira_qa_results — V5 rows only (CreatedAt >= 2026-03-22)
          const tbl = `dbo.jira_qa_results${suffix(env)}`;
          for (const cp of CHECKPOINTS) {
            const r = p.request();
            r.input('cpDate', sql.Date, cp.date);
            const result = await r.query(`
              SELECT AVG(CAST(overallScore AS FLOAT)) AS avg_score
              FROM ${tbl}
              WHERE CAST(CreatedAt AS DATE) = @cpDate
                AND qaType != 'excluded'
                AND CreatedAt >= '2026-03-22'
            `);
            row.checkpoints[cp.label] = result.recordset[0]?.avg_score ?? null;
          }
          // Current: latest 7 days, V5 only
          const cr = p.request();
          const currentResult = await cr.query(`
            SELECT AVG(CAST(overallScore AS FLOAT)) AS avg_score
            FROM ${tbl}
            WHERE CreatedAt >= DATEADD(DAY, -7, GETUTCDATE())
              AND qaType != 'excluded'
              AND CreatedAt >= '2026-03-22'
          `);
          row.current = currentResult.recordset[0]?.avg_score ?? null;

        } else if (metric.source === 'golden') {
          // Golden rules from Jira_QA_GoldenRules — use commentTimestamp (actual comment date)
          const tbl = `dbo.Jira_QA_GoldenRules${suffix(env)}`;
          for (const cp of CHECKPOINTS) {
            const r = p.request();
            r.input('cpDate', sql.Date, cp.date);
            const result = await r.query(`
              SELECT
                AVG(CASE WHEN rule1Pass = 1 THEN 100.0 ELSE 0 END +
                    CASE WHEN rule2Pass = 1 THEN 100.0 ELSE 0 END +
                    CASE WHEN rule3Pass = 1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
              FROM ${tbl}
              WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE) = @cpDate
            `);
            row.checkpoints[cp.label] = result.recordset[0]?.avg_pct ?? null;
          }
          const cr = p.request();
          const currentResult = await cr.query(`
            SELECT
              AVG(CASE WHEN rule1Pass = 1 THEN 100.0 ELSE 0 END +
                  CASE WHEN rule2Pass = 1 THEN 100.0 ELSE 0 END +
                  CASE WHEN rule3Pass = 1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
            FROM ${tbl}
            WHERE COALESCE(commentTimestamp, CreatedAt) >= DATEADD(DAY, -7, GETUTCDATE())
          `);
          row.current = currentResult.recordset[0]?.avg_pct ?? null;

        } else {
          // KPI from jira_kpi_daily
          for (const cp of CHECKPOINTS) {
            const r = p.request();
            r.input('cpDate', sql.Date, cp.date);
            r.input('pattern', sql.NVarChar, metric.kpiPattern as string);
            const result = await r.query(`
              SELECT TOP 1 [Count] AS val
              FROM dbo.jira_kpi_daily
              WHERE kpi LIKE @pattern
                AND CAST(CreatedAt AS DATE) = @cpDate
              ORDER BY CreatedAt DESC
            `);
            row.checkpoints[cp.label] = result.recordset[0]?.val ?? null;
          }
          // Current: most recent value
          const cr = p.request();
          cr.input('pattern', sql.NVarChar, metric.kpiPattern as string);
          const currentResult = await cr.query(`
            SELECT TOP 1 [Count] AS val
            FROM dbo.jira_kpi_daily
            WHERE kpi LIKE @pattern
            ORDER BY CreatedAt DESC
          `);
          row.current = currentResult.recordset[0]?.val ?? null;
        }

        metrics.push(row);
      }

      res.json({ ok: true, data: { checkpoints: CHECKPOINTS, metrics } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/trends/sla ───
  // SLA compliance trends over time
  router.get('/sla', async (req, res) => {
    try {
      const p = await getPool();
      const days = Math.min(Number(req.query.days) || 90, 365);
      const granularity = req.query.granularity === 'daily' ? 'daily' : 'weekly';

      const dateGroup = granularity === 'weekly'
        ? 'DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, CreatedAt)), 1)'
        : 'CAST(CreatedAt AS DATE)';

      const r = p.request();
      r.input('days', sql.Int, days);
      const result = await r.query(`
        SELECT
          ${dateGroup} AS period,
          kpi,
          AVG([Count]) AS avg_value
        FROM dbo.jira_kpi_daily
        WHERE CreatedAt >= DATEADD(DAY, -@days, GETUTCDATE())
          AND (
            kpi LIKE 'FRT Compliance%'
            OR kpi LIKE 'Resolution Compliance%'
          )
          AND kpi NOT LIKE '%Dev%'
          AND kpi NOT LIKE '%Development%'
        GROUP BY ${dateGroup}, kpi
        ORDER BY period
      `);

      res.json({ ok: true, data: result.recordset });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/trends/queue ───
  // Queue health trends: volume + age
  router.get('/queue', async (req, res) => {
    try {
      const p = await getPool();
      const days = Math.min(Number(req.query.days) || 90, 365);
      const granularity = req.query.granularity === 'daily' ? 'daily' : 'weekly';

      const dateGroup = granularity === 'weekly'
        ? 'DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, CreatedAt)), 1)'
        : 'CAST(CreatedAt AS DATE)';

      const r = p.request();
      r.input('days', sql.Int, days);
      const result = await r.query(`
        SELECT
          ${dateGroup} AS period,
          kpi,
          AVG([Count]) AS avg_value
        FROM dbo.jira_kpi_daily
        WHERE CreatedAt >= DATEADD(DAY, -@days, GETUTCDATE())
          AND (
            KPIGroup = 'Volume'
            OR KPIGroup = 'Age'
          )
          AND kpi NOT LIKE '%Dev%'
          AND kpi NOT LIKE '%Development%'
        GROUP BY ${dateGroup}, kpi
        ORDER BY period
      `);

      res.json({ ok: true, data: result.recordset });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/trends/escalation ───
  // Escalation trends
  router.get('/escalation', async (req, res) => {
    try {
      const p = await getPool();
      const days = Math.min(Number(req.query.days) || 90, 365);
      const granularity = req.query.granularity === 'daily' ? 'daily' : 'weekly';

      const dateGroup = granularity === 'weekly'
        ? 'DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, CreatedAt)), 1)'
        : 'CAST(CreatedAt AS DATE)';

      const r = p.request();
      r.input('days', sql.Int, days);
      const result = await r.query(`
        SELECT
          ${dateGroup} AS period,
          kpi,
          AVG([Count]) AS avg_value
        FROM dbo.jira_kpi_daily
        WHERE CreatedAt >= DATEADD(DAY, -@days, GETUTCDATE())
          AND (
            KPIGroup = 'Escalations'
            OR KPIGroup = 'Rejections'
            OR kpi LIKE 'Escalation Accuracy%'
          )
        GROUP BY ${dateGroup}, kpi
        ORDER BY period
      `);

      res.json({ ok: true, data: result.recordset });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/trends/qa ───
  // QA & Golden Rules trends
  router.get('/qa', async (req, res) => {
    try {
      const p = await getPool();
      const env = parseEnv(req);
      const days = Math.min(Number(req.query.days) || 90, 365);
      const agent = (req.query.agent as string) || 'all';
      const granularity = req.query.granularity === 'daily' ? 'daily' : 'weekly';

      const qaTbl = `dbo.jira_qa_results${suffix(env)}`;
      const grTbl = `dbo.Jira_QA_GoldenRules${suffix(env)}`;

      const dateGroup = granularity === 'weekly'
        ? 'DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, CreatedAt)), 1)'
        : 'CAST(CreatedAt AS DATE)';

      const agentFilter = agent !== 'all' ? `AND assigneeName = @agent` : '';

      // QA scores
      const qaReq = p.request();
      qaReq.input('days', sql.Int, days);
      if (agent !== 'all') qaReq.input('agent', sql.NVarChar, agent);
      const qaResult = await qaReq.query(`
        SELECT
          ${dateGroup} AS period,
          AVG(CAST(overallScore AS FLOAT)) AS avg_score,
          COUNT(*) AS ticket_count
        FROM ${qaTbl}
        WHERE CreatedAt >= DATEADD(DAY, -@days, GETUTCDATE())
          AND qaType != 'excluded'
          ${agentFilter}
        GROUP BY ${dateGroup}
        ORDER BY period
      `);

      // Golden Rules — use commentTimestamp (actual comment date) instead of CreatedAt (insert date)
      const grAgentFilter = agent !== 'all' ? `AND Updater = @agent` : '';
      const grDateGroup = granularity === 'weekly'
        ? 'DATEADD(WEEK, DATEDIFF(WEEK, 0, DATEADD(DAY, -1, COALESCE(commentTimestamp, CreatedAt))), 1)'
        : 'CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)';
      const grReq = p.request();
      grReq.input('days', sql.Int, days);
      if (agent !== 'all') grReq.input('agent', sql.NVarChar, agent);
      const grResult = await grReq.query(`
        SELECT
          ${grDateGroup} AS period,
          AVG(CASE WHEN rule1Pass = 1 THEN 100.0 ELSE 0 END) AS ownership_pct,
          AVG(CASE WHEN rule2Pass = 1 THEN 100.0 ELSE 0 END) AS next_action_pct,
          AVG(CASE WHEN rule3Pass = 1 THEN 100.0 ELSE 0 END) AS timeframe_pct,
          COUNT(*) AS comment_count
        FROM ${grTbl}
        WHERE COALESCE(commentTimestamp, CreatedAt) >= DATEADD(DAY, -@days, GETUTCDATE())
          ${grAgentFilter}
        GROUP BY ${grDateGroup}
        ORDER BY period
      `);

      // Agent list for dropdown — scoped to active team members
      const teamIn = TEAM_AGENTS.map(n => `'${n}'`).join(',');
      const agentReq = p.request();
      agentReq.input('days', sql.Int, days);
      const agentResult = await agentReq.query(`
        SELECT DISTINCT assigneeName
        FROM ${qaTbl}
        WHERE CreatedAt >= DATEADD(DAY, -@days, GETUTCDATE())
          AND qaType != 'excluded'
          AND assigneeName IN (${teamIn})
        ORDER BY assigneeName
      `);

      res.json({
        ok: true,
        data: {
          qaScores: qaResult.recordset,
          goldenRules: grResult.recordset,
          agents: agentResult.recordset.map((r: any) => r.assigneeName),
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
