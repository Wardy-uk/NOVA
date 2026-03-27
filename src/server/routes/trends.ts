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
  { label: 'Day 0', date: '2026-03-02' },
  { label: 'Day 1', date: '2026-03-16' },
  { label: 'Day 15', date: '2026-03-31' },
  { label: 'Day 30', date: '2026-04-15' },
  { label: 'Day 45', date: '2026-04-30' },
  { label: 'Day 60', date: '2026-05-15' },
  { label: 'Day 90', date: '2026-06-14' },
] as const;

// Tier definitions for expandable checkpoint rows
const TIERS = [
  { key: 'customer_care', label: 'Customer Care (1st Line)' },
  { key: 'production', label: 'Production' },
  { key: 'tier2', label: 'Tier 2' },
  { key: 'tier3', label: 'Tier 3' },
  { key: 'development', label: 'Development' },
] as const;

// Map jira_agent_kpi_daily.TierCode → our tier keys for QA/GR per-tier JOINs
const TIER_CODE_MAP: Record<string, string> = {
  T1: 'customer_care',
  NTL: 'production',
  TPJM: 'production',   // TPJ managed → rolls into Production
  T2: 'tier2',
  // T3, Development not present as agent TierCodes — agents don't sit in those tiers
  // AI tier excluded — not a support tier
};

// Core metrics tracked in checkpoint evidence panel
interface CheckpointMetric {
  key: string;
  label: string;
  kpiPattern?: string;
  source?: 'qa' | 'golden' | 'derived_compliance' | 'derived_escalation';
  target: number | null;
  direction: string;
  expandable: boolean;
  /** KPI patterns per tier for expandable metrics (key = tier key) */
  tierPatterns?: Record<string, string>;
  /** For derived_compliance: breach pattern per tier */
  tierBreachPatterns?: Record<string, string[]>;
  /** For derived_compliance: volume pattern per tier */
  tierVolumePatterns?: Record<string, string[]>;
  /** For derived_escalation: escalation pattern per tier */
  tierEscPatterns?: Record<string, string>;
  /** For derived_escalation: rejection pattern per tier */
  tierRejPatterns?: Record<string, string>;
}

const CHECKPOINT_METRICS: CheckpointMetric[] = [
  {
    key: 'frt_compliance', label: 'FRT Compliance %',
    kpiPattern: 'FRT Compliance%Open Queue%', target: 95, direction: 'higher',
    expandable: true, source: 'derived_compliance',
    tierBreachPatterns: {
      customer_care: ['CC Incidents FRT breached (actionable)', 'CC Service Requests FRT breached (actionable)', 'CC (TPJ) FRT breached (actionable)'],
      production:    ['Production FRT breached (actionable)'],
      tier2:         ['Tier 2 FRT breached (actionable)'],
      tier3:         ['Tier 3 FRT breached (actionable)'],
      development:   ['Development FRT breached (actionable)'],
    },
    tierVolumePatterns: {
      customer_care: ['Number of Tickets in CC%'],
      production:    ['Number of Tickets in Production%'],
      tier2:         ['Number of Tickets in Tier 2%'],
      tier3:         ['Number of Tickets in Tier 3%'],
      development:   ['Number of Tickets in Development%'],
    },
  },
  {
    key: 'resolution_compliance', label: 'Resolution Compliance %',
    kpiPattern: 'Resolution Compliance%Open Queue%', target: 95, direction: 'higher',
    expandable: true, source: 'derived_compliance',
    tierBreachPatterns: {
      customer_care: ['CC Incidents over SLA (actionable)', 'CC Service Requests over SLA (actionable)', 'CC (TPJ) over SLA (actionable)'],
      production:    ['Production over SLA (actionable)'],
      tier2:         ['Tier 2 over SLA (actionable)'],
      tier3:         ['Tier 3 over SLA (actionable)'],
      development:   ['Development over SLA (actionable)'],
    },
    tierVolumePatterns: {
      customer_care: ['Number of Tickets in CC%'],
      production:    ['Number of Tickets in Production%'],
      tier2:         ['Number of Tickets in Tier 2%'],
      tier3:         ['Number of Tickets in Tier 3%'],
      development:   ['Number of Tickets in Development%'],
    },
  },
  {
    key: 'escalation_accuracy', label: 'Escalation Accuracy %',
    kpiPattern: 'Escalation Accuracy%', target: 90, direction: 'higher',
    expandable: true, source: 'derived_escalation',
    tierEscPatterns: {
      tier2:       'Tickets escalated to Tier 2',
      tier3:       'Tickets escalated to Tier 3',
      development: 'Tickets escalated to Development',
    },
    tierRejPatterns: {
      tier2:       'Tickets rejected by Tier 2',
      tier3:       'Tickets rejected by Tier 3',
      development: 'Tickets rejected by Development',
    },
  },
  { key: 'team_qa_avg', label: 'Team QA Avg (V5)', source: 'qa', target: 8.0, direction: 'higher', expandable: true },
  { key: 'golden_rules_avg', label: 'Golden Rules Avg %', source: 'golden', target: 80, direction: 'higher', expandable: true },
  {
    key: 'total_queue_size', label: 'Total Queue Size',
    kpiPattern: 'Number of Tickets in%',
    target: 125, direction: 'lower', expandable: true,
    tierPatterns: {
      customer_care: 'Number of Tickets in CC%',
      production: 'Number of Tickets in Production%',
      tier2: 'Number of Tickets in Tier 2%',
      tier3: 'Number of Tickets in Tier 3%',
      development: 'Number of Tickets in Development%',
    },
  },
  {
    key: 'oldest_support_ticket', label: 'Oldest Support Ticket (days)',
    kpiPattern: 'Oldest actionable ticket (days)%',
    target: 31, direction: 'lower', expandable: true,
    tierPatterns: {
      customer_care: 'Oldest actionable ticket (days) in CC%',
      production: 'Oldest actionable ticket (days) in Production%',
      tier2: 'Oldest actionable ticket (days) in Tier 2%',
      tier3: 'Oldest actionable ticket (days) in Tier 3%',
      development: 'Oldest actionable ticket (days) in Development%',
    },
  },
  { key: 'csat', label: 'CSAT %', kpiPattern: 'CSAT%', target: null, direction: 'higher', expandable: false },
  { key: 'fcr', label: 'FCR Rate %', kpiPattern: 'FCR%', target: null, direction: 'higher', expandable: false },
  { key: 'l1_resolution', label: '1st Line Resolution Rate %', kpiPattern: '1st Line Resolution Rate%', target: null, direction: 'higher', expandable: false },
  { key: 'bug_ack', label: 'Bug Ack Time (hours)', kpiPattern: 'Bug Escalation-to-Ack%hours%', target: null, direction: 'lower', expandable: false },
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
  // Returns checkpoint evidence panel data with optional tier breakdowns
  router.get('/checkpoint', async (req, res) => {
    try {
      const p = await getPool();
      const env = parseEnv(req);

      const metrics: any[] = [];

      // Helper: fetch KPI value for a pattern at a checkpoint date
      async function fetchKpiAtCheckpoint(pattern: string, cpDate: string): Promise<number | null> {
        const r = p.request();
        r.input('cpDate', sql.Date, cpDate);
        r.input('pattern', sql.NVarChar, pattern);
        const result = await r.query(`
          SELECT TOP 1 [Count] AS val
          FROM dbo.jira_kpi_daily
          WHERE kpi LIKE @pattern
            AND CAST(CreatedAt AS DATE) = @cpDate
          ORDER BY CreatedAt DESC
        `);
        return result.recordset[0]?.val ?? null;
      }

      // Helper: fetch most recent KPI value for a pattern
      async function fetchKpiCurrent(pattern: string): Promise<number | null> {
        const r = p.request();
        r.input('pattern', sql.NVarChar, pattern);
        const result = await r.query(`
          SELECT TOP 1 [Count] AS val
          FROM dbo.jira_kpi_daily
          WHERE kpi LIKE @pattern
          ORDER BY CreatedAt DESC
        `);
        return result.recordset[0]?.val ?? null;
      }

      // Helper: aggregate KPI values across multiple patterns (SUM for queue size)
      async function fetchKpiSumAtCheckpoint(patterns: string[], cpDate: string): Promise<number | null> {
        const r = p.request();
        r.input('cpDate', sql.Date, cpDate);
        const likes = patterns.map((_, i) => `kpi LIKE @p${i}`).join(' OR ');
        patterns.forEach((pat, i) => r.input(`p${i}`, sql.NVarChar, pat));
        const result = await r.query(`
          SELECT SUM(val) AS total FROM (
            SELECT kpi, MAX([Count]) AS val
            FROM dbo.jira_kpi_daily
            WHERE (${likes})
              AND CAST(CreatedAt AS DATE) = @cpDate
            GROUP BY kpi
          ) sub
        `);
        return result.recordset[0]?.total ?? null;
      }

      async function fetchKpiSumCurrent(patterns: string[]): Promise<number | null> {
        const r = p.request();
        const likes = patterns.map((_, i) => `kpi LIKE @p${i}`).join(' OR ');
        patterns.forEach((pat, i) => r.input(`p${i}`, sql.NVarChar, pat));
        const result = await r.query(`
          SELECT SUM(val) AS total FROM (
            SELECT kpi, (SELECT TOP 1 [Count] FROM dbo.jira_kpi_daily k2
                         WHERE k2.kpi = k1.kpi ORDER BY k2.CreatedAt DESC) AS val
            FROM (SELECT DISTINCT kpi FROM dbo.jira_kpi_daily WHERE ${likes}) k1
          ) sub
        `);
        return result.recordset[0]?.total ?? null;
      }

      // Helper: aggregate KPI values across patterns (MAX for oldest ticket)
      async function fetchKpiMaxAtCheckpoint(patterns: string[], cpDate: string): Promise<number | null> {
        const r = p.request();
        r.input('cpDate', sql.Date, cpDate);
        const likes = patterns.map((_, i) => `kpi LIKE @p${i}`).join(' OR ');
        patterns.forEach((pat, i) => r.input(`p${i}`, sql.NVarChar, pat));
        const result = await r.query(`
          SELECT MAX(val) AS oldest FROM (
            SELECT kpi, MAX([Count]) AS val
            FROM dbo.jira_kpi_daily
            WHERE (${likes})
              AND CAST(CreatedAt AS DATE) = @cpDate
            GROUP BY kpi
          ) sub
        `);
        return result.recordset[0]?.oldest ?? null;
      }

      async function fetchKpiMaxCurrent(patterns: string[]): Promise<number | null> {
        const r = p.request();
        const likes = patterns.map((_, i) => `kpi LIKE @p${i}`).join(' OR ');
        patterns.forEach((pat, i) => r.input(`p${i}`, sql.NVarChar, pat));
        const result = await r.query(`
          SELECT MAX(val) AS oldest FROM (
            SELECT kpi, (SELECT TOP 1 [Count] FROM dbo.jira_kpi_daily k2
                         WHERE k2.kpi = k1.kpi ORDER BY k2.CreatedAt DESC) AS val
            FROM (SELECT DISTINCT kpi FROM dbo.jira_kpi_daily WHERE ${likes}) k1
          ) sub
        `);
        return result.recordset[0]?.oldest ?? null;
      }

      for (const metric of CHECKPOINT_METRICS) {
        const row: any = {
          key: metric.key,
          label: metric.label,
          target: metric.target,
          direction: metric.direction,
          expandable: metric.expandable,
          checkpoints: {},
          current: null,
          tiers: null,
        };

        if (metric.source === 'derived_compliance') {
          // FRT/Resolution Compliance: aggregate from jira_kpi_daily as before
          for (const cp of CHECKPOINTS) {
            row.checkpoints[cp.label] = await fetchKpiAtCheckpoint(metric.kpiPattern as string, cp.date);
          }
          row.current = await fetchKpiCurrent(metric.kpiPattern as string);

          // Per-tier: derive compliance from breach counts + volume counts
          // compliance = ((volume - breaches) / volume) * 100
          if (metric.expandable && metric.tierBreachPatterns && metric.tierVolumePatterns) {
            row.tiers = [];
            for (const tier of TIERS) {
              const breachPats = metric.tierBreachPatterns[tier.key];
              const volPats = metric.tierVolumePatterns[tier.key];
              if (!breachPats || !volPats) {
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: Object.fromEntries(CHECKPOINTS.map(cp => [cp.label, null])), current: null });
                continue;
              }
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {}, current: null };
              for (const cp of CHECKPOINTS) {
                const breaches = await fetchKpiSumAtCheckpoint(breachPats, cp.date);
                const volume = await fetchKpiSumAtCheckpoint(volPats, cp.date);
                tierRow.checkpoints[cp.label] = (volume && volume > 0 && breaches !== null) ? +((1 - breaches / volume) * 100).toFixed(1) : null;
              }
              const breachesCur = await fetchKpiSumCurrent(breachPats);
              const volumeCur = await fetchKpiSumCurrent(volPats);
              tierRow.current = (volumeCur && volumeCur > 0 && breachesCur !== null) ? +((1 - breachesCur / volumeCur) * 100).toFixed(1) : null;
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.source === 'derived_escalation') {
          // Escalation Accuracy aggregate
          for (const cp of CHECKPOINTS) {
            row.checkpoints[cp.label] = await fetchKpiAtCheckpoint(metric.kpiPattern as string, cp.date);
          }
          row.current = await fetchKpiCurrent(metric.kpiPattern as string);

          // Per destination tier: accuracy = escalated / (escalated + rejected) * 100
          if (metric.expandable && metric.tierEscPatterns && metric.tierRejPatterns) {
            row.tiers = [];
            for (const tier of TIERS) {
              const escPat = metric.tierEscPatterns[tier.key];
              const rejPat = metric.tierRejPatterns[tier.key];
              if (!escPat || !rejPat) {
                // CC doesn't receive escalations — skip with nulls
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: Object.fromEntries(CHECKPOINTS.map(cp => [cp.label, null])), current: null });
                continue;
              }
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {}, current: null };
              for (const cp of CHECKPOINTS) {
                const esc = await fetchKpiAtCheckpoint(escPat, cp.date);
                const rej = await fetchKpiAtCheckpoint(rejPat, cp.date);
                const total = (esc ?? 0) + (rej ?? 0);
                tierRow.checkpoints[cp.label] = (total > 0 && esc !== null) ? +((esc / total) * 100).toFixed(1) : null;
              }
              const escCur = await fetchKpiCurrent(escPat);
              const rejCur = await fetchKpiCurrent(rejPat);
              const totalCur = (escCur ?? 0) + (rejCur ?? 0);
              tierRow.current = (totalCur > 0 && escCur !== null) ? +((escCur / totalCur) * 100).toFixed(1) : null;
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.source === 'qa') {
          // QA avg from jira_qa_results — 7-day window ending on checkpoint date
          const tbl = `dbo.jira_qa_results${suffix(env)}`;
          for (const cp of CHECKPOINTS) {
            const r = p.request();
            r.input('cpDate', sql.Date, cp.date);
            const result = await r.query(`
              SELECT AVG(CAST(overallScore AS FLOAT)) AS avg_score
              FROM ${tbl}
              WHERE CAST(CreatedAt AS DATE) BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
                AND qaType != 'excluded'
            `);
            row.checkpoints[cp.label] = result.recordset[0]?.avg_score ?? null;
          }
          const cr = p.request();
          const currentResult = await cr.query(`
            SELECT AVG(CAST(overallScore AS FLOAT)) AS avg_score
            FROM ${tbl}
            WHERE CreatedAt >= DATEADD(DAY, -7, GETUTCDATE())
              AND qaType != 'excluded'
          `);
          row.current = currentResult.recordset[0]?.avg_score ?? null;

          // Per-tier: JOIN jira_qa_results to jira_agent_kpi_daily to get TierCode
          if (metric.expandable) {
            row.tiers = [];
            // Build tier code IN clause for each of our tiers
            const tierCodeGroups: Record<string, string[]> = {};
            for (const [code, tierKey] of Object.entries(TIER_CODE_MAP)) {
              if (!tierCodeGroups[tierKey]) tierCodeGroups[tierKey] = [];
              tierCodeGroups[tierKey].push(code);
            }
            for (const tier of TIERS) {
              const codes = tierCodeGroups[tier.key];
              if (!codes || codes.length === 0) {
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: Object.fromEntries(CHECKPOINTS.map(cp => [cp.label, null])), current: null });
                continue;
              }
              const codeList = codes.map(c => `'${c}'`).join(',');
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {}, current: null };
              for (const cp of CHECKPOINTS) {
                const r = p.request();
                r.input('cpDate', sql.Date, cp.date);
                const result = await r.query(`
                  SELECT AVG(CAST(q.overallScore AS FLOAT)) AS avg_score
                  FROM ${tbl} q
                  INNER JOIN (
                    SELECT DISTINCT AgentName, TierCode FROM dbo.jira_agent_kpi_daily${suffix(env)}
                    WHERE TierCode IN (${codeList})
                  ) a ON q.assigneeName = a.AgentName
                  WHERE CAST(q.CreatedAt AS DATE) BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
                    AND q.qaType != 'excluded'
                `);
                tierRow.checkpoints[cp.label] = result.recordset[0]?.avg_score ?? null;
              }
              const curR = p.request();
              const curResult = await curR.query(`
                SELECT AVG(CAST(q.overallScore AS FLOAT)) AS avg_score
                FROM ${tbl} q
                INNER JOIN (
                  SELECT DISTINCT AgentName, TierCode FROM dbo.jira_agent_kpi_daily${suffix(env)}
                  WHERE TierCode IN (${codeList})
                ) a ON q.assigneeName = a.AgentName
                WHERE q.CreatedAt >= DATEADD(DAY, -7, GETUTCDATE())
                  AND q.qaType != 'excluded'
              `);
              tierRow.current = curResult.recordset[0]?.avg_score ?? null;
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.source === 'golden') {
          // Golden rules from Jira_QA_GoldenRules — 7-day window ending on checkpoint date
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
              WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
                    BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
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

          // Per-tier: JOIN Jira_QA_GoldenRules to jira_agent_kpi_daily via Updater → AgentName
          if (metric.expandable) {
            row.tiers = [];
            const tierCodeGroups: Record<string, string[]> = {};
            for (const [code, tierKey] of Object.entries(TIER_CODE_MAP)) {
              if (!tierCodeGroups[tierKey]) tierCodeGroups[tierKey] = [];
              tierCodeGroups[tierKey].push(code);
            }
            for (const tier of TIERS) {
              const codes = tierCodeGroups[tier.key];
              if (!codes || codes.length === 0) {
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: Object.fromEntries(CHECKPOINTS.map(cp => [cp.label, null])), current: null });
                continue;
              }
              const codeList = codes.map(c => `'${c}'`).join(',');
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {}, current: null };
              for (const cp of CHECKPOINTS) {
                const r = p.request();
                r.input('cpDate', sql.Date, cp.date);
                const result = await r.query(`
                  SELECT
                    AVG(CASE WHEN g.rule1Pass = 1 THEN 100.0 ELSE 0 END +
                        CASE WHEN g.rule2Pass = 1 THEN 100.0 ELSE 0 END +
                        CASE WHEN g.rule3Pass = 1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
                  FROM ${tbl} g
                  INNER JOIN (
                    SELECT DISTINCT AgentName, TierCode FROM dbo.jira_agent_kpi_daily${suffix(env)}
                    WHERE TierCode IN (${codeList})
                  ) a ON g.Updater = a.AgentName
                  WHERE CAST(COALESCE(g.commentTimestamp, g.CreatedAt) AS DATE)
                        BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
                `);
                tierRow.checkpoints[cp.label] = result.recordset[0]?.avg_pct ?? null;
              }
              const curR = p.request();
              const curResult = await curR.query(`
                SELECT
                  AVG(CASE WHEN g.rule1Pass = 1 THEN 100.0 ELSE 0 END +
                      CASE WHEN g.rule2Pass = 1 THEN 100.0 ELSE 0 END +
                      CASE WHEN g.rule3Pass = 1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
                FROM ${tbl} g
                INNER JOIN (
                  SELECT DISTINCT AgentName, TierCode FROM dbo.jira_agent_kpi_daily${suffix(env)}
                  WHERE TierCode IN (${codeList})
                ) a ON g.Updater = a.AgentName
                WHERE COALESCE(g.commentTimestamp, g.CreatedAt) >= DATEADD(DAY, -7, GETUTCDATE())
              `);
              tierRow.current = curResult.recordset[0]?.avg_pct ?? null;
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.key === 'total_queue_size' && metric.tierPatterns) {
          // Total Queue Size: SUM of all tier ticket counts
          const allPatterns = Object.values(metric.tierPatterns);
          for (const cp of CHECKPOINTS) {
            row.checkpoints[cp.label] = await fetchKpiSumAtCheckpoint(allPatterns, cp.date);
          }
          row.current = await fetchKpiSumCurrent(allPatterns);

          // Per-tier breakdown
          row.tiers = [];
          for (const tier of TIERS) {
            const tierPattern = metric.tierPatterns[tier.key];
            if (!tierPattern) {
              row.tiers.push({ key: tier.key, label: tier.label, target: null, checkpoints: Object.fromEntries(CHECKPOINTS.map(cp => [cp.label, null])), current: null });
              continue;
            }
            const tierRow: any = { key: tier.key, label: tier.label, target: null, checkpoints: {}, current: null };
            for (const cp of CHECKPOINTS) {
              tierRow.checkpoints[cp.label] = await fetchKpiAtCheckpoint(tierPattern, cp.date);
            }
            tierRow.current = await fetchKpiCurrent(tierPattern);
            row.tiers.push(tierRow);
          }

        } else if (metric.key === 'oldest_support_ticket' && metric.tierPatterns) {
          // Oldest Support Ticket: MAX across all tier patterns
          const allPatterns = Object.values(metric.tierPatterns);
          for (const cp of CHECKPOINTS) {
            row.checkpoints[cp.label] = await fetchKpiMaxAtCheckpoint(allPatterns, cp.date);
          }
          row.current = await fetchKpiMaxCurrent(allPatterns);

          // Per-tier breakdown
          row.tiers = [];
          for (const tier of TIERS) {
            const tierPattern = metric.tierPatterns[tier.key];
            if (!tierPattern) {
              row.tiers.push({ key: tier.key, label: tier.label, target: null, checkpoints: Object.fromEntries(CHECKPOINTS.map(cp => [cp.label, null])), current: null });
              continue;
            }
            const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {}, current: null };
            for (const cp of CHECKPOINTS) {
              tierRow.checkpoints[cp.label] = await fetchKpiAtCheckpoint(tierPattern, cp.date);
            }
            tierRow.current = await fetchKpiCurrent(tierPattern);
            row.tiers.push(tierRow);
          }

        } else {
          // Standard KPI from jira_kpi_daily (CSAT, FCR, 1st Line, Bug Ack — all non-expandable)
          for (const cp of CHECKPOINTS) {
            row.checkpoints[cp.label] = await fetchKpiAtCheckpoint(metric.kpiPattern as string, cp.date);
          }
          row.current = await fetchKpiCurrent(metric.kpiPattern as string);
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

  // ─── GET /api/trends/data-audit ───
  // Diagnostic: check data coverage across all checkpoint tables
  router.get('/data-audit', async (req, res) => {
    try {
      const p = await getPool();
      const env = parseEnv(req);
      const qaTbl = `dbo.jira_qa_results${suffix(env)}`;
      const grTbl = `dbo.Jira_QA_GoldenRules${suffix(env)}`;

      const audit: any = { checkpoints: CHECKPOINTS, tables: {}, checkpointCoverage: {} };

      // 1. Table-level overview: row counts + date ranges
      const tables = [
        { key: 'jira_kpi_daily', tbl: 'dbo.jira_kpi_daily', dateCol: 'CreatedAt' },
        { key: 'jira_qa_results', tbl: qaTbl, dateCol: 'CreatedAt' },
        { key: 'Jira_QA_GoldenRules', tbl: grTbl, dateCol: 'COALESCE(commentTimestamp, CreatedAt)' },
        { key: 'jira_agent_kpi_daily', tbl: `dbo.jira_agent_kpi_daily${suffix(env)}`, dateCol: 'CreatedAt' },
      ];

      for (const t of tables) {
        try {
          const r = p.request();
          const result = await r.query(`
            SELECT
              COUNT(*) AS total_rows,
              MIN(CAST(${t.dateCol} AS DATE)) AS earliest,
              MAX(CAST(${t.dateCol} AS DATE)) AS latest
            FROM ${t.tbl}
          `);
          audit.tables[t.key] = result.recordset[0];
        } catch (e: any) {
          audit.tables[t.key] = { error: e.message };
        }
      }

      // 2. Per-checkpoint date window coverage for each metric source
      for (const cp of CHECKPOINTS) {
        const cpAudit: any = { date: cp.date };

        // KPI daily: exact date row count + which KPIs exist
        const kpiReq = p.request();
        kpiReq.input('cpDate', sql.Date, cp.date);
        const kpiResult = await kpiReq.query(`
          SELECT kpi, [Count] AS val
          FROM dbo.jira_kpi_daily
          WHERE CAST(CreatedAt AS DATE) = @cpDate
          ORDER BY kpi
        `);
        cpAudit.kpi_exact_day = {
          rows: kpiResult.recordset.length,
          kpis: kpiResult.recordset.map((r: any) => `${r.kpi}: ${r.val}`),
        };

        // KPI daily: 7-day window
        const kpiWinReq = p.request();
        kpiWinReq.input('cpDate', sql.Date, cp.date);
        const kpiWinResult = await kpiWinReq.query(`
          SELECT COUNT(DISTINCT CAST(CreatedAt AS DATE)) AS days_with_data,
                 COUNT(*) AS total_rows
          FROM dbo.jira_kpi_daily
          WHERE CAST(CreatedAt AS DATE) BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
        `);
        cpAudit.kpi_7day_window = kpiWinResult.recordset[0];

        // QA: exact day + 7-day window
        const qaExReq = p.request();
        qaExReq.input('cpDate', sql.Date, cp.date);
        const qaExResult = await qaExReq.query(`
          SELECT COUNT(*) AS rows, AVG(CAST(overallScore AS FLOAT)) AS avg_score
          FROM ${qaTbl}
          WHERE CAST(CreatedAt AS DATE) = @cpDate AND qaType != 'excluded'
        `);
        cpAudit.qa_exact_day = qaExResult.recordset[0];

        const qaWinReq = p.request();
        qaWinReq.input('cpDate', sql.Date, cp.date);
        const qaWinResult = await qaWinReq.query(`
          SELECT COUNT(*) AS rows, AVG(CAST(overallScore AS FLOAT)) AS avg_score,
                 COUNT(DISTINCT CAST(CreatedAt AS DATE)) AS days_with_data
          FROM ${qaTbl}
          WHERE CAST(CreatedAt AS DATE) BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
            AND qaType != 'excluded'
        `);
        cpAudit.qa_7day_window = qaWinResult.recordset[0];

        // Golden Rules: exact day + 7-day window
        const grExReq = p.request();
        grExReq.input('cpDate', sql.Date, cp.date);
        const grExResult = await grExReq.query(`
          SELECT COUNT(*) AS rows,
            AVG(CASE WHEN rule1Pass=1 THEN 100.0 ELSE 0 END +
                CASE WHEN rule2Pass=1 THEN 100.0 ELSE 0 END +
                CASE WHEN rule3Pass=1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
          FROM ${grTbl}
          WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE) = @cpDate
        `);
        cpAudit.gr_exact_day = grExResult.recordset[0];

        const grWinReq = p.request();
        grWinReq.input('cpDate', sql.Date, cp.date);
        const grWinResult = await grWinReq.query(`
          SELECT COUNT(*) AS rows,
            AVG(CASE WHEN rule1Pass=1 THEN 100.0 ELSE 0 END +
                CASE WHEN rule2Pass=1 THEN 100.0 ELSE 0 END +
                CASE WHEN rule3Pass=1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct,
            COUNT(DISTINCT CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)) AS days_with_data
          FROM ${grTbl}
          WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
                BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
        `);
        cpAudit.gr_7day_window = grWinResult.recordset[0];

        audit.checkpointCoverage[cp.label] = cpAudit;
      }

      // 3. Daily row counts for QA and GR (last 60 days) to see gaps
      const qaDaily = p.request();
      const qaDailyResult = await qaDaily.query(`
        SELECT CAST(CreatedAt AS DATE) AS day, COUNT(*) AS rows,
               AVG(CAST(overallScore AS FLOAT)) AS avg_score
        FROM ${qaTbl}
        WHERE CreatedAt >= '2026-02-01' AND qaType != 'excluded'
        GROUP BY CAST(CreatedAt AS DATE)
        ORDER BY day
      `);
      audit.qa_daily_coverage = qaDailyResult.recordset;

      const grDaily = p.request();
      const grDailyResult = await grDaily.query(`
        SELECT CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE) AS day, COUNT(*) AS rows,
               AVG(CASE WHEN rule1Pass=1 THEN 100.0 ELSE 0 END +
                   CASE WHEN rule2Pass=1 THEN 100.0 ELSE 0 END +
                   CASE WHEN rule3Pass=1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
        FROM ${grTbl}
        WHERE COALESCE(commentTimestamp, CreatedAt) >= '2026-02-01'
        GROUP BY CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
        ORDER BY day
      `);
      audit.gr_daily_coverage = grDailyResult.recordset;

      res.json({ ok: true, data: audit });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
