import { Router, type Request, type Response } from 'express';
import sql from 'mssql';
import type { Database } from 'sql.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { DevReviewQueries } from '../db/dev-review-queries.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { saveDb } from '../db/schema.js';

/**
 * Service Desk MI route.
 *
 * Returns a full departmental MI pack for a given month (default = current,
 * MTD). Combines:
 *   - dbo.jira_kpi_daily (MSSQL) for SLA compliance, FCR, CSAT, 1st line rate
 *   - Local dev_review_state / thread for Dev Review queue metrics
 *   - Live NT JQL calls for backlog splits, aging buckets, top products,
 *     aged dev backlog, opened vs resolved totals
 *   - mi_commentary (SQLite) for the editable monthly narrative
 *
 * Everything is wrapped in try/catch so one source failing doesn't kill the
 * whole response — partial data is better than no data.
 */

interface PoolHolder { pool: sql.ConnectionPool | null }

async function getPool(holder: PoolHolder, settingsQueries: SettingsQueries): Promise<sql.ConnectionPool> {
  if (holder.pool?.connected) return holder.pool;
  const s = settingsQueries.getAll();
  if (!s.kpi_sql_server || !s.kpi_sql_database || !s.kpi_sql_user || !s.kpi_sql_password) {
    throw new Error('KPI SQL Server not configured');
  }
  holder.pool = await new sql.ConnectionPool({
    server: s.kpi_sql_server,
    database: s.kpi_sql_database,
    user: s.kpi_sql_user,
    password: s.kpi_sql_password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();
  return holder.pool;
}

// ── Month bounds ───────────────────────────────────────────────────────────
// For the CURRENT month, end = today (MTD). For PAST months, end = last day.
function monthBounds(ym: string): {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  label: string;
  isMtd: boolean;
  daysElapsed: number;
} {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const today = new Date();
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const isCurrent = y === today.getUTCFullYear() && m === today.getUTCMonth() + 1;
  const end = isCurrent ? now : new Date(Date.UTC(y, m, 0));
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prevEnd = isCurrent
    ? new Date(Date.UTC(y, m - 1, now.getUTCDate())) // same day-count window from previous month, for fair MTD vs MTD compare
    : new Date(Date.UTC(y, m - 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const label = start.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const daysElapsed = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return {
    start: fmt(start), end: fmt(end),
    prevStart: fmt(prevStart), prevEnd: fmt(prevEnd),
    label, isMtd: isCurrent, daysElapsed,
  };
}

// ── Commentary queries (inline — tiny table) ───────────────────────────────

function getCommentary(db: Database, month: string): { content: string; updated_at: string | null } {
  const stmt = db.prepare('SELECT content, updated_at FROM mi_commentary WHERE month = ?');
  stmt.bind([month]);
  let out = { content: '', updated_at: null as string | null };
  if (stmt.step()) {
    const row = stmt.getAsObject() as { content: string | null; updated_at: string | null };
    out = { content: row.content || '', updated_at: row.updated_at };
  }
  stmt.free();
  return out;
}

function saveCommentary(db: Database, month: string, content: string, userId: number): void {
  db.run(
    `INSERT INTO mi_commentary (month, content, updated_by_user_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(month) DO UPDATE SET content=excluded.content, updated_by_user_id=excluded.updated_by_user_id, updated_at=datetime('now')`,
    [month, content, userId],
  );
  saveDb();
}

// ── JQL helper: count-only search ──────────────────────────────────────────
// Delegates to JiraRestClient.jqlCount which uses the dedicated
// /search/approximate-count endpoint. The legacy search endpoint returned a
// `total` field; the new POST /search/jql endpoint does not, which is why
// every count was silently coming back as 0 before this change.

async function jqlCount(client: JiraRestClient, jql: string): Promise<number> {
  const n = await client.jqlCount(jql);
  return n < 0 ? 0 : n; // collapse "error" into 0 for the UI
}

// ── Main route ─────────────────────────────────────────────────────────────

export function createBoardMiRoutes(
  settingsQueries: SettingsQueries,
  devQueries: DevReviewQueries,
  db: Database,
  getJiraClient: () => JiraRestClient | null,
): Router {
  const router = Router();
  const holder: PoolHolder = { pool: null };

  router.get('/monthly', async (req: Request, res: Response) => {
    try {
      const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
      const bounds = monthBounds(month);
      const { start, end, prevStart, prevEnd, label, isMtd, daysElapsed } = bounds;

      // ── 1. KPI daily data ──────────────────────────────────────────────
      let kpiRows: Array<{ kpi: string; kpiGroup: string; count: number; CreatedAt: Date }> = [];
      let prevRows: typeof kpiRows = [];
      let dataError: string | null = null;

      try {
        const p = await getPool(holder, settingsQueries);
        const q = async (from: string, to: string) => {
          const r = p.request();
          r.input('from', sql.Date, from);
          r.input('to', sql.Date, to);
          const result = await r.query(`
            SELECT kpi, kpiGroup, [count], CreatedAt
            FROM dbo.jira_kpi_daily
            WHERE CAST(CreatedAt AS DATE) >= @from AND CAST(CreatedAt AS DATE) <= @to
          `);
          return result.recordset;
        };
        kpiRows = await q(start, end);
        prevRows = await q(prevStart, prevEnd);
      } catch (e) {
        dataError = e instanceof Error ? e.message : 'kpi query failed';
      }

      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const sum = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) : null;
      const pickAvg = (rows: typeof kpiRows, kpi: string) =>
        avg(rows.filter((r) => r.kpi === kpi).map((r) => Number(r.count) || 0));
      const pickSum = (rows: typeof kpiRows, kpi: string) =>
        sum(rows.filter((r) => r.kpi === kpi).map((r) => Number(r.count) || 0));
      const seriesFor = (rows: typeof kpiRows, kpi: string) => {
        const byDay = new Map<string, number>();
        for (const r of rows.filter((x) => x.kpi === kpi)) {
          const d = new Date(r.CreatedAt).toISOString().slice(0, 10);
          byDay.set(d, Number(r.count) || 0);
        }
        return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
      };

      const frtKpis = [
        'FRT Compliance % (Customer Care)',
        'FRT Compliance % (Tier 2)',
        'FRT Compliance % (Tier 3)',
        'FRT Compliance % (Production)',
        'FRT Compliance % (Development)',
      ];
      const resKpis = [
        'Resolution Compliance % (Customer Care)',
        'Resolution Compliance % (Tier 2)',
        'Resolution Compliance % (Tier 3)',
        'Resolution Compliance % (Production)',
        'Resolution Compliance % (Development)',
      ];

      const uniqueKpis = Array.from(new Set(kpiRows.map((r) => r.kpi))).sort();

      // ── 2. Live JQL queries (run in parallel, each wrapped to not fail fast) ──
      const client = getJiraClient();
      let aging = null as {
        under4h: number; h4to24: number; d1to3: number; d3to7: number; over7d: number;
      } | null;
      let backlogSplit = null as { cc: number; incidents: number; serviceReq: number; t2: number; t3: number; dev: number } | null;
      let topProducts: Array<{ product: string; count: number }> = [];
      let agedDev = null as { total: number; over30d: number; over90d: number; over180d: number; oldestDays: number | null } | null;
      let openedResolved = null as { opened: number; resolved: number; prevOpened: number; prevResolved: number } | null;

      if (client) {
        // Aging buckets — all currently unresolved NT tickets by creation age
        try {
          const [u4, h4, d1, d3, o7] = await Promise.all([
            jqlCount(client, `project = NT AND statusCategory != Done AND created >= -4h`),
            jqlCount(client, `project = NT AND statusCategory != Done AND created < -4h AND created >= -1d`),
            jqlCount(client, `project = NT AND statusCategory != Done AND created < -1d AND created >= -3d`),
            jqlCount(client, `project = NT AND statusCategory != Done AND created < -3d AND created >= -7d`),
            jqlCount(client, `project = NT AND statusCategory != Done AND created < -7d`),
          ]);
          aging = { under4h: u4, h4to24: h4, d1to3: d1, d3to7: d3, over7d: o7 };
        } catch { /* leave null */ }

        // Backlog split by current tier
        try {
          const [cc, t2, t3, dev] = await Promise.all([
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Customer Care"`),
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Tier 2"`),
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Tier 3"`),
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Development"`),
          ]);
          // Request type split — Incidents vs Service Requests — run on Customer Care tier only
          // (Board pack style: split by CC tier first, then by type)
          const [inc, sr] = await Promise.all([
            jqlCount(client, `project = NT AND statusCategory != Done AND "Request Type" = "Report a Bug"`).catch(() => 0),
            jqlCount(client, `project = NT AND statusCategory != Done AND "Request Type" = "Service Request"`).catch(() => 0),
          ]);
          backlogSplit = { cc, incidents: inc, serviceReq: sr, t2, t3, dev };
        } catch { /* leave null */ }

        // Top 5 products — facet in memory from top 200 unresolved
        try {
          const r = await client.searchJql(
            `project = NT AND statusCategory != Done ORDER BY updated DESC`,
            ['customfield_13183'],
            200,
          );
          const counts = new Map<string, number>();
          for (const i of r.issues) {
            const p = (i.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value;
            if (!p) continue;
            counts.set(p, (counts.get(p) || 0) + 1);
          }
          topProducts = Array.from(counts.entries())
            .map(([product, count]) => ({ product, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        } catch { /* leave empty */ }

        // Aged Dev backlog
        try {
          const [total, o30, o90, o180] = await Promise.all([
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Development"`),
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Development" AND created < -30d`),
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Development" AND created < -90d`),
            jqlCount(client, `project = NT AND statusCategory != Done AND cf[12981] = "Development" AND created < -180d`),
          ]);
          // Oldest — sort ascending by created
          let oldestDays: number | null = null;
          try {
            const r = await client.searchJql(
              `project = NT AND statusCategory != Done AND cf[12981] = "Development" ORDER BY created ASC`,
              ['created'],
              1,
            );
            const createdIso = (r.issues[0]?.fields as { created?: string } | undefined)?.created;
            if (createdIso) {
              oldestDays = Math.floor((Date.now() - new Date(createdIso).getTime()) / 86400000);
            }
          } catch { /* ignore */ }
          agedDev = { total, over30d: o30, over90d: o90, over180d: o180, oldestDays };
        } catch { /* leave null */ }

        // Opened vs Resolved for the month + previous month
        try {
          const [opened, resolved, prevOpened, prevResolved] = await Promise.all([
            jqlCount(client, `project = NT AND created >= "${start}" AND created <= "${end}"`),
            jqlCount(client, `project = NT AND resolved >= "${start}" AND resolved <= "${end}"`),
            jqlCount(client, `project = NT AND created >= "${prevStart}" AND created <= "${prevEnd}"`),
            jqlCount(client, `project = NT AND resolved >= "${prevStart}" AND resolved <= "${prevEnd}"`),
          ]);
          openedResolved = { opened, resolved, prevOpened, prevResolved };
        } catch { /* leave null */ }
      }

      // ── 3. Dev Review metrics ──────────────────────────────────────────
      // Use the dashboard snapshot and derive month-scoped figures from local tables
      let devReviewMonth = null as {
        accepted: number; returned: number; avgTimeToDecisionMinutes: number | null;
        inQueueNow: number; avgAgeHours: number | null;
      } | null;
      try {
        const d = devQueries.getDashboard();
        // Month-scoped: count thread entries within bounds
        const startIso = `${start}T00:00:00`;
        const endIso = `${end}T23:59:59`;
        const monthStmt = db.prepare(
          `SELECT kind, COUNT(*) AS cnt FROM dev_review_thread
           WHERE kind IN ('accept','return') AND created_at >= ? AND created_at <= ?
           GROUP BY kind`,
        );
        monthStmt.bind([startIso, endIso]);
        let monthAccepted = 0, monthReturned = 0;
        while (monthStmt.step()) {
          const row = monthStmt.getAsObject() as { kind: string; cnt: number };
          if (row.kind === 'accept') monthAccepted = row.cnt;
          if (row.kind === 'return') monthReturned = row.cnt;
        }
        monthStmt.free();

        devReviewMonth = {
          accepted: monthAccepted,
          returned: monthReturned,
          avgTimeToDecisionMinutes: d.averages.avgTimeToDecisionMinutes,
          inQueueNow: d.queue.total,
          avgAgeHours: d.averages.oldestPendingHours,
        };
      } catch { /* leave null */ }

      // ── 4. Commentary ───────────────────────────────────────────────────
      const commentary = getCommentary(db, month);

      // ── Response ────────────────────────────────────────────────────────
      res.json({
        ok: true,
        data: {
          month, label, isMtd, daysElapsed,
          window: { start, end, prevStart, prevEnd },
          dataError,
          availableKpis: uniqueKpis,

          service: {
            frtCompliance: frtKpis.map((k) => ({
              tier: k.replace('FRT Compliance % (', '').replace(')', ''),
              current: pickAvg(kpiRows, k),
              previous: pickAvg(prevRows, k),
              series: seriesFor(kpiRows, k),
            })),
            resolutionCompliance: resKpis.map((k) => ({
              tier: k.replace('Resolution Compliance % (', '').replace(')', ''),
              current: pickAvg(kpiRows, k),
              previous: pickAvg(prevRows, k),
            })),
            ticketsOpened: pickSum(kpiRows, 'Tickets opened today'),
            fcrRate: pickAvg(kpiRows, 'FCR Rate %'),
            prevFcrRate: pickAvg(prevRows, 'FCR Rate %'),
            firstLineResolution: pickAvg(kpiRows, '1st Line Resolution Rate %'),
            prevFirstLineResolution: pickAvg(prevRows, '1st Line Resolution Rate %'),
            csat: pickAvg(kpiRows, 'CSAT %'),
            prevCsat: pickAvg(prevRows, 'CSAT %'),
          },

          escalation: {
            frtBreachedAll: pickSum(kpiRows, 'FRT Breached (All)'),
            frtBreachedCC: pickSum(kpiRows, 'FRT Breached (Customer Care)'),
            frtBreachedT2: pickSum(kpiRows, 'FRT Breached (Tier 2)'),
            frtBreachedT3: pickSum(kpiRows, 'FRT Breached (Tier 3)'),
            frtBreachedDev: pickSum(kpiRows, 'FRT Breached (Development)'),
            prevFrtBreachedAll: pickSum(prevRows, 'FRT Breached (All)'),
          },

          aging,
          backlogSplit,
          topProducts,
          agedDev,
          openedResolved,
          devReview: devReviewMonth,

          commentary,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'board-mi query failed' });
    }
  });

  // Save monthly commentary
  router.post('/commentary', (req: Request, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ ok: false }); return; }
      const month = String(req.body?.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        res.status(400).json({ ok: false, error: 'Invalid month' }); return;
      }
      const content = String(req.body?.content || '');
      saveCommentary(db, month, content, req.user.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'save failed' });
    }
  });

  return router;
}
