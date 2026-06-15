// Org KPI (Layer 1) read/write API. Reads serve the Support/NT scorecard from
// kpi_org_daily, enriched with registry metadata (label, unit, direction, etc).
// Writes: manual entry (#18/#19) and a manual capture trigger.

import { Router } from 'express';
import type { JiraRestClient } from '../services/jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import {
  captureSupportNt, getDay, getLatest, getRange, getTeamRange, setManualValue,
  ORG_KPIS, getKpi, getOrgPeriod, getOrgHistoryGrid, startOrgBackfill, getLegacyEarliest, orgBackfillState,
} from '../services/kpi-org/index.js';
import { getSupportLiveSnapshot } from '../services/kpi-org/live.js';

function yesterday(): string { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
import type { OrgKpiDailyRow } from '../services/kpi-org/store.js';

export interface KpiOrgDeps {
  getJiraClient: () => JiraRestClient | null;
  settings: SettingsQueries;
}

/** Merge a stored row with its registry definition for the client. */
function enrich(row: OrgKpiDailyRow) {
  const def = getKpi(row.kpi_key);
  return {
    key: row.kpi_key,
    label: def?.label ?? row.kpi_key,
    colA: def?.colA ?? null,
    unit: def?.unit ?? 'count',
    direction: def?.direction ?? 'lower-better',
    rollup: def?.rollup ?? 'latest',
    manual: def?.compute.kind === 'manual',
    note: def?.note ?? null,
    date: row.kpi_date,
    value: row.value,
    target: row.target,
    rag: row.rag,
    source: row.source,
    capturedAt: row.captured_at,
  };
}

export function createKpiOrgRoutes(deps: KpiOrgDeps): Router {
  const router = Router();

  // The registry itself — definitions for every org KPI (transparency / admin).
  router.get('/definitions', (_req, res) => {
    res.json({ ok: true, data: ORG_KPIS });
  });

  // Current Support scorecard — latest stored value per KPI, in registry order.
  router.get('/support/latest', async (_req, res) => {
    try {
      const rows = await getLatest('Support');
      const byKey = new Map(rows.map(r => [r.kpi_key, r]));
      // Return in registry order, including KPIs not yet captured (value null).
      const data = ORG_KPIS.filter(k => k.team === 'Support').map(k => {
        const row = byKey.get(k.key);
        return row ? enrich(row) : {
          key: k.key, label: k.label, colA: k.colA, unit: k.unit, direction: k.direction,
          rollup: k.rollup, manual: k.compute.kind === 'manual', note: k.note ?? null,
          date: null, value: null, target: k.dailyTarget, rag: null, source: null, capturedAt: null,
        };
      });
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Weekly / monthly rollup: /support/period?period=week|month&anchor=YYYY-MM-DD
  router.get('/support/period', async (req, res) => {
    const period = (req.query.period === 'month' ? 'month' : 'week') as 'week' | 'month';
    const anchor = (req.query.anchor as string) || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    try {
      res.json({ ok: true, data: await getOrgPeriod('Support', period, anchor) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Daily-history grid (KPIs × date columns): /support/history-grid?from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/support/history-grid', async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) { res.status(400).json({ ok: false, error: 'from and to required' }); return; }
    try {
      res.json({ ok: true, data: await getOrgHistoryGrid('Support', from, to) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // A specific day's snapshot.
  router.get('/support/day/:day', async (req, res) => {
    try {
      const rows = await getDay('Support', req.params.day);
      res.json({ ok: true, data: rows.map(enrich) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Legacy daily-history shape — serves kpi_org_daily in the SAME shape the old
  // /api/kpi-data/daily-history returned, so the "Legacy KPIs" view can read this
  // engine instead. /support/legacy-history?from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/support/legacy-history', async (req, res) => {
    const { from, to, liveToday } = req.query as { from?: string; to?: string; liveToday?: string };
    if (!from || !to) { res.status(400).json({ ok: false, error: 'from and to required' }); return; }
    try {
      const ragNum = (r: string | null) => r === 'green' ? 1 : r === 'amber' ? 2 : r === 'red' ? 3 : null;
      const dir = (d?: string) => d === 'higher-better' ? 'Higher is better' : 'Lower is better';
      const rows = await getTeamRange('Support', from, to);
      let data = rows.map(row => {
        const def = getKpi(row.kpi_key);
        return {
          kpi: def?.label ?? row.kpi_key,
          kpiGroup: def?.colA ?? 'Other',
          count: row.value,
          target: row.target,
          direction: dir(def?.direction),
          rag: ragNum(row.rag),
          CreatedAt: typeof row.kpi_date === 'string' ? row.kpi_date : new Date(row.kpi_date as unknown as string).toISOString().slice(0, 10),
        };
      });

      // Live overlay for today's column: the stored table freezes at 18:00, so when
      // the caller opts in (liveToday=1) and the range includes today (UK), replace
      // today's stored rows with a fresh 60s-cached recompute. Keeps prior days frozen
      // for history. Falls back silently to stored rows if Jira is unavailable.
      const todayUk = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
      if (liveToday && from <= todayUk && todayUk <= to) {
        const jira = deps.getJiraClient();
        if (jira) {
          try {
            const snap = await getSupportLiveSnapshot(jira);
            data = data.filter(d => d.CreatedAt !== todayUk);
            for (const it of snap.items) {
              const def = getKpi(it.key);
              data.push({
                kpi: it.label,
                kpiGroup: def?.colA ?? 'Other',
                count: it.value,
                target: it.target,
                direction: dir(def?.direction),
                rag: ragNum(it.rag),
                CreatedAt: todayUk,
              });
            }
          } catch { /* keep stored today rows on live-compute failure */ }
        }
      }
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Daily history for one KPI: /support/history/nt_new_tickets?from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/support/history/:kpiKey', async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) { res.status(400).json({ ok: false, error: 'from and to are required' }); return; }
      const rows = await getRange('Support', req.params.kpiKey, from, to);
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Manual entry for a KPI (e.g. #18 Failed Jobs, #19 CI). Body: { kpiKey, day, value }.
  router.post('/manual', async (req, res) => {
    try {
      const { kpiKey, day, value } = req.body as { kpiKey?: string; day?: string; value?: number | null };
      if (!kpiKey || !day) { res.status(400).json({ ok: false, error: 'kpiKey and day are required' }); return; }
      const kpi = await setManualValue(kpiKey, day, value ?? null);
      res.json({ ok: true, data: { kpiKey: kpi.key, day, value: value ?? null } });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Backfill historic days (background): hybrid (flows from Jira, stocks from legacy).
  // Body: { from?, to? } — defaults to the FULL legacy history (earliest → yesterday).
  router.post('/backfill', async (req, res) => {
    const jira = deps.getJiraClient();
    if (!jira) { res.status(503).json({ ok: false, error: 'Jira client not configured' }); return; }
    try {
      const body = req.body as { from?: string; to?: string };
      const to = body.to || yesterday();
      const from = body.from || (await getLegacyEarliest(deps.settings)).org || '2024-01-01';
      const r = startOrgBackfill(deps.settings, jira, from, to);
      res.json({ ok: true, data: { ...r, from, to } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Poll backfill progress + earliest available dates.
  router.get('/backfill-status', async (_req, res) => {
    try {
      const earliest = await getLegacyEarliest(deps.settings).catch(() => ({ org: null, agent: null }));
      res.json({ ok: true, data: { ...orgBackfillState, earliest } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Manually trigger a capture run (admin). Useful for backfill / verification.
  router.post('/capture', async (_req, res) => {
    const jira = deps.getJiraClient();
    if (!jira) { res.status(503).json({ ok: false, error: 'Jira client not configured' }); return; }
    try {
      const summary = await captureSupportNt(jira);
      res.json({ ok: true, data: summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  return router;
}
