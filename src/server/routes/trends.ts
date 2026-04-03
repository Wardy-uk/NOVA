import { Router } from 'express';
import sql from 'mssql';
import type { Database } from 'sql.js';
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
const CHECKPOINT_DATES = {
  day0: '2026-03-02',
  day1: '2026-03-16',
  day15: '2026-03-31',
  day30: '2026-04-15',
} as const;

interface CheckpointColumn {
  label: string;
  subtitle: string;
  type: 'range' | 'point';
  start: string;
  end: string;
}

function fmtSubtitle(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtMonthYear(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Build dynamic checkpoint columns with date ranges
function buildCheckpointColumns(): CheckpointColumn[] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Last month: previous calendar month
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lmStart = lastMonthStart.toISOString().slice(0, 10);
  const lmEnd = lastMonthEnd.toISOString().slice(0, 10);

  // Week to date: Monday of current week → today
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  const wtdStart = monday.toISOString().slice(0, 10);

  // Month to date: 1st of current month → today
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  return [
    { label: 'Last Month', subtitle: fmtMonthYear(lmStart), type: 'range', start: lmStart, end: lmEnd },
    { label: 'Day 0', subtitle: fmtSubtitle(CHECKPOINT_DATES.day0), type: 'point', start: CHECKPOINT_DATES.day0, end: CHECKPOINT_DATES.day0 },
    { label: 'Day 1', subtitle: fmtSubtitle(CHECKPOINT_DATES.day1), type: 'point', start: CHECKPOINT_DATES.day1, end: CHECKPOINT_DATES.day1 },
    { label: 'WTD', subtitle: `${fmtSubtitle(wtdStart)} – ${fmtSubtitle(today)}`, type: 'range', start: wtdStart, end: today },
    { label: 'MTD', subtitle: `${fmtSubtitle(mtdStart)} – ${fmtSubtitle(today)}`, type: 'range', start: mtdStart, end: today },
    { label: 'Day 15', subtitle: fmtSubtitle(CHECKPOINT_DATES.day15), type: 'point', start: CHECKPOINT_DATES.day15, end: CHECKPOINT_DATES.day15 },
    { label: 'Day 30', subtitle: fmtSubtitle(CHECKPOINT_DATES.day30), type: 'point', start: CHECKPOINT_DATES.day30, end: CHECKPOINT_DATES.day30 },
  ];
}

// Fixed checkpoint dates for backward compat (used by data-audit route)
const CHECKPOINTS = [
  { label: 'Day 0', date: CHECKPOINT_DATES.day0 },
  { label: 'Day 1', date: CHECKPOINT_DATES.day1 },
  { label: 'Day 15', date: CHECKPOINT_DATES.day15 },
  { label: 'Day 30', date: CHECKPOINT_DATES.day30 },
];

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
  source?: 'qa' | 'golden' | 'derived_escalation' | 'compliance' | 'survey';
  target: number | null;
  direction: string;
  expandable: boolean;
  /** KPI patterns per tier for expandable metrics (key = tier key) */
  tierPatterns?: Record<string, string>;
  /** For derived_escalation: escalation pattern per tier */
  tierEscPatterns?: Record<string, string>;
  /** For derived_escalation: rejection pattern per tier */
  tierRejPatterns?: Record<string, string>;
  /** For compliance source: raw met/breached KPI names for range aggregation */
  metKpi?: string;
  breachedKpi?: string;
  /** Per-tier met/breached KPI names */
  tierMetKpis?: Record<string, string>;
  tierBreachedKpis?: Record<string, string>;
}

const CHECKPOINT_METRICS: CheckpointMetric[] = [
  {
    key: 'frt_compliance', label: 'FRT Compliance %',
    kpiPattern: 'FRT Compliance % (Resolved Today)', source: 'compliance',
    target: 95, direction: 'higher', expandable: true,
    metKpi: 'FRT Met (All)', breachedKpi: 'FRT Breached (All)',
    tierMetKpis: {
      customer_care: 'FRT Met (Customer Care)',
      production:    'FRT Met (Production)',
      tier2:         'FRT Met (Tier 2)',
      tier3:         'FRT Met (Tier 3)',
      development:   'FRT Met (Development)',
    },
    tierBreachedKpis: {
      customer_care: 'FRT Breached (Customer Care)',
      production:    'FRT Breached (Production)',
      tier2:         'FRT Breached (Tier 2)',
      tier3:         'FRT Breached (Tier 3)',
      development:   'FRT Breached (Development)',
    },
  },
  {
    key: 'resolution_compliance', label: 'Resolution Compliance %',
    kpiPattern: 'Resolution Compliance % (Resolved Today)', source: 'compliance',
    target: 95, direction: 'higher', expandable: true,
    metKpi: 'Resolution Met (All)', breachedKpi: 'Resolution Breached (All)',
    tierMetKpis: {
      customer_care: 'Resolution Met (Customer Care)',
      production:    'Resolution Met (Production)',
      tier2:         'Resolution Met (Tier 2)',
      tier3:         'Resolution Met (Tier 3)',
      development:   'Resolution Met (Development)',
    },
    tierBreachedKpis: {
      customer_care: 'Resolution Breached (Customer Care)',
      production:    'Resolution Breached (Production)',
      tier2:         'Resolution Breached (Tier 2)',
      tier3:         'Resolution Breached (Tier 3)',
      development:   'Resolution Breached (Development)',
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
  // Survey satisfaction scores (sourced from local SQLite, not SQL Server)
  { key: 'survey_team_sat', label: 'Support Team Satisfaction', source: 'survey', target: 4.0, direction: 'higher', expandable: false, kpiPattern: 'team_satisfaction' },
  { key: 'survey_kam_sat', label: 'KAM Satisfaction with Support', source: 'survey', target: 4.0, direction: 'higher', expandable: false, kpiPattern: 'kam_satisfaction' },
  { key: 'survey_csm_sat', label: 'CSM Satisfaction with Support', source: 'survey', target: 4.0, direction: 'higher', expandable: false, kpiPattern: 'csm_satisfaction' },
];

export function createTrendsRoutes(settingsQueries: SettingsQueries, _userQueries: FileUserQueries, localDb?: Database): Router {
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
      const columns = buildCheckpointColumns();

      const metrics: any[] = [];

      // ── Helpers ──

      const todayStr = new Date().toISOString().slice(0, 10);

      // Fetch KPI value at or before a date (falls back up to 4 days for weekends/gaps)
      async function fetchKpiAtDate(pattern: string, cpDate: string): Promise<number | null> {
        if (cpDate > todayStr) return null;  // Future date — no data yet
        const r = p.request();
        r.input('cpDate', sql.Date, cpDate);
        r.input('pattern', sql.NVarChar, pattern);
        const result = await r.query(`
          SELECT TOP 1 [Count] AS val
          FROM dbo.jira_kpi_daily
          WHERE kpi LIKE @pattern
            AND CAST(CreatedAt AS DATE) <= @cpDate
            AND CAST(CreatedAt AS DATE) >= DATEADD(DAY, -4, @cpDate)
          ORDER BY CreatedAt DESC
        `);
        return result.recordset[0]?.val ?? null;
      }

      // Fetch KPI SUM at a single date across multiple patterns
      async function fetchKpiSumAtDate(patterns: string[], cpDate: string): Promise<number | null> {
        if (cpDate > todayStr) return null;
        const r = p.request();
        r.input('cpDate', sql.Date, cpDate);
        const likes = patterns.map((_, i) => `kpi LIKE @p${i}`).join(' OR ');
        patterns.forEach((pat, i) => r.input(`p${i}`, sql.NVarChar, pat));
        const result = await r.query(`
          SELECT SUM(val) AS total FROM (
            SELECT kpi, (SELECT TOP 1 [Count] FROM dbo.jira_kpi_daily k2
              WHERE k2.kpi = k1.kpi AND CAST(k2.CreatedAt AS DATE) <= @cpDate
                AND CAST(k2.CreatedAt AS DATE) >= DATEADD(DAY, -4, @cpDate)
              ORDER BY k2.CreatedAt DESC) AS val
            FROM (SELECT DISTINCT kpi FROM dbo.jira_kpi_daily WHERE (${likes})
              AND CAST(CreatedAt AS DATE) <= @cpDate
              AND CAST(CreatedAt AS DATE) >= DATEADD(DAY, -4, @cpDate)) k1
          ) sub
        `);
        return result.recordset[0]?.total ?? null;
      }

      // Fetch KPI MAX at a single date across multiple patterns
      async function fetchKpiMaxAtDate(patterns: string[], cpDate: string): Promise<number | null> {
        if (cpDate > todayStr) return null;
        const r = p.request();
        r.input('cpDate', sql.Date, cpDate);
        const likes = patterns.map((_, i) => `kpi LIKE @p${i}`).join(' OR ');
        patterns.forEach((pat, i) => r.input(`p${i}`, sql.NVarChar, pat));
        const result = await r.query(`
          SELECT MAX(val) AS oldest FROM (
            SELECT kpi, (SELECT TOP 1 [Count] FROM dbo.jira_kpi_daily k2
              WHERE k2.kpi = k1.kpi AND CAST(k2.CreatedAt AS DATE) <= @cpDate
                AND CAST(k2.CreatedAt AS DATE) >= DATEADD(DAY, -4, @cpDate)
              ORDER BY k2.CreatedAt DESC) AS val
            FROM (SELECT DISTINCT kpi FROM dbo.jira_kpi_daily WHERE (${likes})
              AND CAST(CreatedAt AS DATE) <= @cpDate
              AND CAST(CreatedAt AS DATE) >= DATEADD(DAY, -4, @cpDate)) k1
          ) sub
        `);
        return result.recordset[0]?.oldest ?? null;
      }

      // Fetch SUM of a KPI across a date range (for escalation/rejection counts)
      async function fetchKpiSumRange(pattern: string, startDate: string, endDate: string): Promise<number | null> {
        if (startDate > todayStr) return null;
        const cappedEnd = endDate > todayStr ? todayStr : endDate;
        const r = p.request();
        r.input('startDate', sql.Date, startDate);
        r.input('endDate', sql.Date, cappedEnd);
        r.input('pattern', sql.NVarChar, pattern);
        const result = await r.query(`
          SELECT SUM([Count]) AS total
          FROM dbo.jira_kpi_daily
          WHERE kpi LIKE @pattern
            AND CAST(CreatedAt AS DATE) BETWEEN @startDate AND @endDate
        `);
        return result.recordset[0]?.total ?? null;
      }

      // Compute compliance % from raw met/breached KPI counts over a date range
      async function fetchComplianceForRange(metKpi: string, breachedKpi: string, startDate: string, endDate: string): Promise<number | null> {
        if (startDate > todayStr) return null;
        const cappedEnd = endDate > todayStr ? todayStr : endDate;
        const r = p.request();
        r.input('startDate', sql.Date, startDate);
        r.input('endDate', sql.Date, cappedEnd);
        r.input('metKpi', sql.NVarChar, metKpi);
        r.input('breachedKpi', sql.NVarChar, breachedKpi);
        const result = await r.query(`
          SELECT
            SUM(CASE WHEN kpi = @metKpi THEN [Count] ELSE 0 END) AS met,
            SUM(CASE WHEN kpi = @breachedKpi THEN [Count] ELSE 0 END) AS breached
          FROM dbo.jira_kpi_daily
          WHERE kpi IN (@metKpi, @breachedKpi)
            AND CAST(CreatedAt AS DATE) BETWEEN @startDate AND @endDate
        `);
        const met = result.recordset[0]?.met ?? 0;
        const breached = result.recordset[0]?.breached ?? 0;
        const total = met + breached;
        if (total === 0) return null;
        return +((met / total) * 100).toFixed(1);
      }

      // Compute escalation accuracy over a date range: escalated / (escalated + rejected) * 100
      async function fetchEscAccuracyForRange(escPat: string, rejPat: string, startDate: string, endDate: string): Promise<number | null> {
        const esc = await fetchKpiSumRange(escPat, startDate, endDate);
        const rej = await fetchKpiSumRange(rejPat, startDate, endDate);
        const total = (esc ?? 0) + (rej ?? 0);
        if (total === 0 || esc === null) return null;
        return +((esc / total) * 100).toFixed(1);
      }

      // Fetch value for a column: uses the column's date range + type
      // For 'point' columns, just use the end date.
      // For 'range' columns, behavior depends on the metric type (handled by caller).

      // ── Build metric rows ──

      for (const metric of CHECKPOINT_METRICS) {
        const row: any = {
          key: metric.key,
          label: metric.label,
          target: metric.target,
          direction: metric.direction,
          expandable: metric.expandable,
          checkpoints: {},
          tiers: null,
        };

        const nullCheckpoints = () => Object.fromEntries(columns.map(c => [c.label, null]));

        if (metric.source === 'compliance') {
          // FRT / Resolution compliance
          // For point columns: use the pre-computed compliance % KPI at that date
          // For range columns: compute from raw met/breached counts
          for (const col of columns) {
            if (col.type === 'point') {
              row.checkpoints[col.label] = await fetchKpiAtDate(metric.kpiPattern as string, col.end);
            } else {
              row.checkpoints[col.label] = await fetchComplianceForRange(
                metric.metKpi as string, metric.breachedKpi as string, col.start, col.end
              );
            }
          }

          // Per-tier breakdown
          if (metric.expandable && metric.tierMetKpis && metric.tierBreachedKpis) {
            row.tiers = [];
            for (const tier of TIERS) {
              const metK = metric.tierMetKpis[tier.key];
              const breachedK = metric.tierBreachedKpis[tier.key];
              if (!metK || !breachedK) {
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: nullCheckpoints() });
                continue;
              }
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {} };
              for (const col of columns) {
                if (col.type === 'point') {
                  // Use per-tier compliance KPI pattern if available, fallback to raw counts
                  // The old tierPatterns had "FRT Compliance % (Customer Care)" etc. — keep that for point lookups
                  const tierCompliancePattern = metric.key === 'frt_compliance'
                    ? `FRT Compliance % (${tier.label.split(' (')[0]})`
                    : `Resolution Compliance % (${tier.label.split(' (')[0]})`;
                  tierRow.checkpoints[col.label] = await fetchKpiAtDate(tierCompliancePattern, col.end);
                } else {
                  tierRow.checkpoints[col.label] = await fetchComplianceForRange(metK, breachedK, col.start, col.end);
                }
              }
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.source === 'derived_escalation') {
          // Escalation Accuracy
          // Point: use pre-computed KPI at that date
          // Range: sum escalated & rejected over range, compute accuracy
          for (const col of columns) {
            if (col.type === 'point') {
              row.checkpoints[col.label] = await fetchKpiAtDate(metric.kpiPattern as string, col.end);
            } else {
              // Sum all esc and rej across tiers for aggregate accuracy
              if (metric.tierEscPatterns && metric.tierRejPatterns) {
                let totalEsc = 0, totalRej = 0, hasData = false;
                for (const tierKey of Object.keys(metric.tierEscPatterns)) {
                  const escPat = metric.tierEscPatterns[tierKey];
                  const rejPat = metric.tierRejPatterns[tierKey];
                  if (!escPat || !rejPat) continue;
                  const esc = await fetchKpiSumRange(escPat, col.start, col.end);
                  const rej = await fetchKpiSumRange(rejPat, col.start, col.end);
                  if (esc !== null) { totalEsc += esc; hasData = true; }
                  if (rej !== null) totalRej += rej;
                }
                const total = totalEsc + totalRej;
                row.checkpoints[col.label] = (hasData && total > 0) ? +((totalEsc / total) * 100).toFixed(1) : null;
              } else {
                row.checkpoints[col.label] = null;
              }
            }
          }

          // Per destination tier
          if (metric.expandable && metric.tierEscPatterns && metric.tierRejPatterns) {
            row.tiers = [];
            for (const tier of TIERS) {
              const escPat = metric.tierEscPatterns[tier.key];
              const rejPat = metric.tierRejPatterns[tier.key];
              if (!escPat || !rejPat) {
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: nullCheckpoints() });
                continue;
              }
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {} };
              for (const col of columns) {
                if (col.type === 'point') {
                  const esc = await fetchKpiAtDate(escPat, col.end);
                  const rej = await fetchKpiAtDate(rejPat, col.end);
                  const total = (esc ?? 0) + (rej ?? 0);
                  tierRow.checkpoints[col.label] = (total > 0 && esc !== null) ? +((esc / total) * 100).toFixed(1) : null;
                } else {
                  tierRow.checkpoints[col.label] = await fetchEscAccuracyForRange(escPat, rejPat, col.start, col.end);
                }
              }
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.source === 'qa') {
          // QA avg from jira_qa_results
          // Point: 7-day window ending on checkpoint date
          // Range: average over the range
          const tbl = `dbo.jira_qa_results${suffix(env)}`;
          for (const col of columns) {
            const r = p.request();
            if (col.type === 'point') {
              r.input('cpDate', sql.Date, col.end);
              const result = await r.query(`
                SELECT AVG(CAST(overallScore AS FLOAT)) AS avg_score
                FROM ${tbl}
                WHERE CAST(CreatedAt AS DATE) BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
                  AND qaType != 'excluded'
              `);
              row.checkpoints[col.label] = result.recordset[0]?.avg_score ?? null;
            } else {
              r.input('startDate', sql.Date, col.start);
              r.input('endDate', sql.Date, col.end);
              const result = await r.query(`
                SELECT AVG(CAST(overallScore AS FLOAT)) AS avg_score
                FROM ${tbl}
                WHERE CAST(CreatedAt AS DATE) BETWEEN @startDate AND @endDate
                  AND qaType != 'excluded'
              `);
              row.checkpoints[col.label] = result.recordset[0]?.avg_score ?? null;
            }
          }

          // Per-tier
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
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: nullCheckpoints() });
                continue;
              }
              const codeList = codes.map(c => `'${c}'`).join(',');
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {} };
              for (const col of columns) {
                const r = p.request();
                if (col.type === 'point') {
                  r.input('cpDate', sql.Date, col.end);
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
                  tierRow.checkpoints[col.label] = result.recordset[0]?.avg_score ?? null;
                } else {
                  r.input('startDate', sql.Date, col.start);
                  r.input('endDate', sql.Date, col.end);
                  const result = await r.query(`
                    SELECT AVG(CAST(q.overallScore AS FLOAT)) AS avg_score
                    FROM ${tbl} q
                    INNER JOIN (
                      SELECT DISTINCT AgentName, TierCode FROM dbo.jira_agent_kpi_daily${suffix(env)}
                      WHERE TierCode IN (${codeList})
                    ) a ON q.assigneeName = a.AgentName
                    WHERE CAST(q.CreatedAt AS DATE) BETWEEN @startDate AND @endDate
                      AND q.qaType != 'excluded'
                  `);
                  tierRow.checkpoints[col.label] = result.recordset[0]?.avg_score ?? null;
                }
              }
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.source === 'golden') {
          // Golden rules from Jira_QA_GoldenRules
          // Point: 7-day window ending on checkpoint date
          // Range: average over the range
          const tbl = `dbo.Jira_QA_GoldenRules${suffix(env)}`;
          for (const col of columns) {
            const r = p.request();
            if (col.type === 'point') {
              r.input('cpDate', sql.Date, col.end);
              const result = await r.query(`
                SELECT
                  AVG(CASE WHEN rule1Pass = 1 THEN 100.0 ELSE 0 END +
                      CASE WHEN rule2Pass = 1 THEN 100.0 ELSE 0 END +
                      CASE WHEN rule3Pass = 1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
                FROM ${tbl}
                WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
                      BETWEEN DATEADD(DAY, -6, @cpDate) AND @cpDate
              `);
              row.checkpoints[col.label] = result.recordset[0]?.avg_pct ?? null;
            } else {
              r.input('startDate', sql.Date, col.start);
              r.input('endDate', sql.Date, col.end);
              const result = await r.query(`
                SELECT
                  AVG(CASE WHEN rule1Pass = 1 THEN 100.0 ELSE 0 END +
                      CASE WHEN rule2Pass = 1 THEN 100.0 ELSE 0 END +
                      CASE WHEN rule3Pass = 1 THEN 100.0 ELSE 0 END) / 3.0 AS avg_pct
                FROM ${tbl}
                WHERE CAST(COALESCE(commentTimestamp, CreatedAt) AS DATE)
                      BETWEEN @startDate AND @endDate
              `);
              row.checkpoints[col.label] = result.recordset[0]?.avg_pct ?? null;
            }
          }

          // Per-tier
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
                row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: nullCheckpoints() });
                continue;
              }
              const codeList = codes.map(c => `'${c}'`).join(',');
              const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {} };
              for (const col of columns) {
                const r = p.request();
                if (col.type === 'point') {
                  r.input('cpDate', sql.Date, col.end);
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
                  tierRow.checkpoints[col.label] = result.recordset[0]?.avg_pct ?? null;
                } else {
                  r.input('startDate', sql.Date, col.start);
                  r.input('endDate', sql.Date, col.end);
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
                          BETWEEN @startDate AND @endDate
                  `);
                  tierRow.checkpoints[col.label] = result.recordset[0]?.avg_pct ?? null;
                }
              }
              row.tiers.push(tierRow);
            }
          }

        } else if (metric.tierPatterns) {
          // Point-in-time metrics with per-tier KPI patterns (queue size, oldest ticket)
          // Point columns: use end date. Range columns: use end date (last day in range).
          if (metric.key === 'total_queue_size') {
            const allPatterns = Object.values(metric.tierPatterns);
            for (const col of columns) {
              row.checkpoints[col.label] = await fetchKpiSumAtDate(allPatterns, col.end);
            }
          } else if (metric.key === 'oldest_support_ticket') {
            const allPatterns = Object.values(metric.tierPatterns);
            for (const col of columns) {
              row.checkpoints[col.label] = await fetchKpiMaxAtDate(allPatterns, col.end);
            }
          } else {
            for (const col of columns) {
              row.checkpoints[col.label] = await fetchKpiAtDate(metric.kpiPattern as string, col.end);
            }
          }

          // Per-tier breakdown
          row.tiers = [];
          for (const tier of TIERS) {
            const tierPattern = metric.tierPatterns[tier.key];
            if (!tierPattern) {
              row.tiers.push({ key: tier.key, label: tier.label, target: metric.target, checkpoints: nullCheckpoints() });
              continue;
            }
            const tierRow: any = { key: tier.key, label: tier.label, target: metric.target, checkpoints: {} };
            for (const col of columns) {
              tierRow.checkpoints[col.label] = await fetchKpiAtDate(tierPattern, col.end);
            }
            row.tiers.push(tierRow);
          }

        } else if (metric.source === 'survey' && localDb) {
          // Survey satisfaction score from local SQLite — show latest score for this category
          const category = metric.kpiPattern as string;
          const result = localDb.exec(
            `SELECT s.id, s.closed_at, s.start_date, s.created_at FROM surveys s
             WHERE s.category = ? AND s.status IN ('active', 'closed')
             ORDER BY COALESCE(s.closed_at, s.start_date, s.created_at) DESC LIMIT 1`,
            [category]
          );
          if (result.length > 0 && result[0].values.length > 0) {
            const surveyId = result[0].values[0][0] as number;
            const responses = localDb.exec('SELECT answers FROM survey_responses WHERE survey_id = ?', [surveyId]);
            const scaleQs = localDb.exec(`SELECT id FROM survey_questions WHERE survey_id = ? AND question_type = 'scale_5'`, [surveyId]);
            const qIds = new Set((scaleQs[0]?.values ?? []).map(v => v[0] as number));

            let total = 0, count = 0;
            for (const row2 of (responses[0]?.values ?? [])) {
              const answers = JSON.parse(row2[0] as string) as Array<{ question_id: number; value: number }>;
              for (const a of answers) {
                if (qIds.has(a.question_id)) { const v = Number(a.value); if (!isNaN(v) && v >= 1 && v <= 5) { total += v; count++; } }
              }
            }
            const avg = count > 0 ? Math.round((total / count) * 100) / 100 : null;
            // Set the same score for all columns (it's a point-in-time latest score)
            for (const col of columns) { row.checkpoints[col.label] = avg; }
          } else {
            for (const col of columns) { row.checkpoints[col.label] = null; }
          }

        } else {
          // Standard KPI from jira_kpi_daily (CSAT, FCR, 1st Line, Bug Ack — all non-expandable)
          // These are point-in-time metrics: use end date for all columns
          for (const col of columns) {
            row.checkpoints[col.label] = await fetchKpiAtDate(metric.kpiPattern as string, col.end);
          }
        }

        metrics.push(row);
      }

      // Return columns with metadata for the frontend
      const checkpoints = columns.map(c => ({ label: c.label, subtitle: c.subtitle, start: c.start, end: c.end }));
      res.json({ ok: true, data: { checkpoints, metrics } });
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
