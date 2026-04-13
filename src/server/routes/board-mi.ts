import { Router } from 'express';
import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';

/**
 * Board MI Pack — monthly aggregation endpoint.
 *
 * Returns everything the BoardMiView needs in one call: headline KPIs mapped to
 * the 6 HoTS 90-day outcomes, plus supporting detail for each pack section.
 * Where KPI data doesn't yet exist, fields come back as null so the UI can
 * show "baseline pending".
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

function monthBounds(ym: string): { start: string; end: string; prevStart: string; prevEnd: string; label: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prevEnd = new Date(Date.UTC(y, m - 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const label = start.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start: fmt(start), end: fmt(end), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd), label };
}

export function createBoardMiRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();
  const holder: PoolHolder = { pool: null };

  router.get('/monthly', async (req, res) => {
    try {
      const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
      const { start, end, prevStart, prevEnd, label } = monthBounds(month);

      let kpiRows: Array<{ kpi: string; kpiGroup: string; count: number; target: number | null; direction: string | null; rag: string | null; CreatedAt: Date }> = [];
      let prevRows: typeof kpiRows = [];
      let dataError: string | null = null;

      try {
        const p = await getPool(holder, settingsQueries);
        const q = async (from: string, to: string) => {
          const r = p.request();
          r.input('from', sql.Date, from);
          r.input('to', sql.Date, to);
          const result = await r.query(`
            SELECT kpi, kpiGroup, [count], target, direction, rag, CreatedAt
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

      // Aggregate: average of daily counts for percentage KPIs, sum for count KPIs
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

      res.json({
        ok: true,
        data: {
          month,
          label,
          window: { start, end, prevStart, prevEnd },
          dataError,
          availableKpis: uniqueKpis,

          // Section 1: Service Performance
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
            firstLineResolution: pickAvg(kpiRows, '1st Line Resolution Rate %'),
            csat: pickAvg(kpiRows, 'CSAT %'),
            prevFcrRate: pickAvg(prevRows, 'FCR Rate %'),
            prevFirstLineResolution: pickAvg(prevRows, '1st Line Resolution Rate %'),
            prevCsat: pickAvg(prevRows, 'CSAT %'),
          },

          // Section 2: Escalation health
          escalation: {
            frtBreachedAll: pickSum(kpiRows, 'FRT Breached (All)'),
            frtBreachedCC: pickSum(kpiRows, 'FRT Breached (Customer Care)'),
            frtBreachedT2: pickSum(kpiRows, 'FRT Breached (Tier 2)'),
            frtBreachedT3: pickSum(kpiRows, 'FRT Breached (Tier 3)'),
            frtBreachedDev: pickSum(kpiRows, 'FRT Breached (Development)'),
            prevFrtBreachedAll: pickSum(prevRows, 'FRT Breached (All)'),
          },

          // Section 6: Production
          production: {
            ticketsInCC_SR: pickSum(kpiRows, 'Number of Tickets in Customer Care (Service Requests)'),
            ticketsInCC_Inc: pickSum(kpiRows, 'Number of Tickets in Customer Care (Incidents)'),
          },
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'board-mi query failed' });
    }
  });

  return router;
}
