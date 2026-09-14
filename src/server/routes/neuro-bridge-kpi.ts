import { Router } from 'express';
import sql from 'mssql';

import type { SettingsQueries } from '../db/settings-store.js';
import { query } from '../services/database.js';
import type { EscalationLogService } from '../services/escalation-log-service.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { applyTargetFallbacks } from '../services/kpi-targets.js';
import { bridgeAuth } from './neuro-bridge.js';

/** Jira's own JSM satisfaction field. Carries `{ rating }` and NOTHING else - no
 *  comment, and crucially no rating timestamp. Same constant as csat-metrics.ts. */
const NATIVE_SATISFACTION_FIELD = 'customfield_12802';

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
  getJiraClient: () => JiraRestClient | null = () => null,
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

  /**
   * GET /csat-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Ratings-level CSAT for NEURO's weekly risk report. It exists because the
   * report could otherwise only read `jira_kpi_daily."CSAT %"`, and that column
   * CANNOT honestly answer either question asked of it.
   *
   * WARNING: `kpi-pipeline.ts` writes `csatCount > 0 ? avg*20 : 0` - so a day
   * with NO ratings is stored as 0, indistinguishable from a day of one-star
   * ratings. A real rating is 1-5, so a genuine 0 is impossible: the zeros ARE
   * the empty days. Measured over the 28 days to 14 Sep 2026, three days
   * carried a rating and twenty-five were stored as 0, dragging the weekly
   * average to 14.3% - a figure that reads to a manager as customers loathing
   * the desk when it means "three ratings this month, averaging about 4.2 out
   * of 5". A report built on that column would restate the defect inside a
   * document Chris assesses.
   *
   * So this answers from the RATINGS, never from a daily percentage:
   *   - `avgScore` is out of 5, weighted per rating, and NULL when there are
   *     none. Never 0 - that conflates "nobody rated us" with "everybody hated
   *     us", which is the whole bug.
   *   - `daysWithRating` says how thin the sample is, which is the real finding.
   *
   * WARNING: BOTH SURVEYS ARE POOLED, in the same order the KPI engine pools
   * them (`kpi-org/nt-compute.resolvedAgg`): NOVA's portal survey and Jira's
   * native Satisfaction field, with a ticket rated in both counting ONCE and the
   * portal score winning - it is the survey NOVA now asks for and the only one a
   * customer can go back and correct. Native out-rated the portal 7 to 3 over a
   * fortnight when that was last measured, so portal-only would understate the
   * sample by more than half.
   *
   * WARNING: THE TWO SOURCES ARE NOT DATED THE SAME WAY, and the response says
   * so rather than quietly averaging the bases together. A portal rating carries
   * a real `responded_at`. A native one carries no rating timestamp at all, so
   * it can only be dated by the ticket's last update - a PROXY, reported as
   * `jiraDatedByProxy` so a consumer can footnote it instead of presenting a
   * guess as a measurement.
   *
   * Strictly SELECT plus one Jira read. Nothing here writes.
   */
  router.get('/csat-summary', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const fromStr = typeof req.query.from === 'string' && dayRe.test(req.query.from) ? req.query.from : null;
    const toStr = typeof req.query.to === 'string' && dayRe.test(req.query.to) ? req.query.to : null;
    if (!fromStr || !toStr || fromStr > toStr) {
      // A caller error is the same error whatever the database is doing, so it
      // is answered before any pool is opened.
      res.status(400).json({ ok: false, error: 'from and to are required as YYYY-MM-DD, with from <= to' });
      return;
    }
    const from = new Date(fromStr + 'T00:00:00Z');
    const toExclusiveDate = new Date(new Date(toStr + 'T00:00:00Z').getTime() + 86400000);
    const toExclusiveStr = toExclusiveDate.toISOString().slice(0, 10);

    try {
      // Portal half. Bounded, and the bound is reported - a truncated list must
      // never read as the whole population.
      const LIMIT = 2000;
      const portal = await query<{ issue_key: string; day: string; score: number }>(
        `SELECT TOP (${LIMIT})
                s.jira_issue_key AS issue_key,
                CONVERT(varchar(10), s.responded_at, 23) AS day,
                CAST(s.csat_score AS FLOAT) AS score
         FROM portal_csat_surveys s
         WHERE s.responded_at IS NOT NULL
           AND s.responded_at >= ? AND s.responded_at < ?
           AND s.csat_score BETWEEN 1 AND 5
         ORDER BY s.responded_at DESC`,
        [from, toExclusiveDate],
      );

      const days = new Set<string>();
      const seen = new Set<string>();
      let sum = 0;
      for (const r of portal) {
        seen.add(r.issue_key);
        days.add(r.day);
        sum += r.score;
      }
      let count = portal.length;

      // Native half. A Jira outage degrades this to portal-only WITH a reason -
      // silently returning half the ratings is the failure csat-metrics.ts was
      // already bitten by once.
      let jiraRatings = 0;
      let jiraDatedByProxy = 0;
      let jiraError: string | null = null;
      const client = getJiraClient();
      if (!client) {
        jiraError = 'No Jira client configured, so Jira-survey ratings are not included.';
      } else {
        try {
          const jql = 'project in (NT, NTPJ) AND cf[12802] is not EMPTY '
            + 'AND updated >= "' + fromStr + '" AND updated < "' + toExclusiveStr + '" '
            + 'ORDER BY updated DESC';
          const found = await client.searchJqlAll(jql, [NATIVE_SATISFACTION_FIELD, 'updated'], 200);
          for (const iss of found.issues ?? []) {
            if (seen.has(iss.key)) continue; // rated in both - portal wins
            const f = (iss.fields ?? {}) as Record<string, unknown>;
            const rating = (f[NATIVE_SATISFACTION_FIELD] as { rating?: number } | null)?.rating;
            if (typeof rating !== 'number' || rating < 1 || rating > 5) continue;
            seen.add(iss.key);
            sum += rating;
            count += 1;
            jiraRatings += 1;
            const updated = typeof f.updated === 'string' ? f.updated.slice(0, 10) : null;
            if (updated) { days.add(updated); jiraDatedByProxy += 1; }
          }
        } catch (err) {
          jiraError = err instanceof Error ? err.message : 'Jira lookup failed';
        }
      }

      res.json({
        ok: true,
        data: {
          from: fromStr,
          to: toStr,
          ratings: count,
          portalRatings: portal.length,
          jiraRatings,
          // Out of 5. NULL, never 0, when nobody rated anything.
          avgScore: count > 0 ? Math.round((sum / count) * 100) / 100 : null,
          daysWithRating: days.size,
          ratedDays: [...days].sort(),
          jiraDatedByProxy,
          dateBasis: {
            portal: 'responded_at',
            jira: 'updated (proxy - the native survey records no rating timestamp)',
          },
          jiraError,
          // False whenever a source could not be read or the portal list hit its
          // bound: the figures are then a floor, not the population.
          complete: jiraError === null && portal.length < LIMIT,
          truncated: portal.length === LIMIT,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}

