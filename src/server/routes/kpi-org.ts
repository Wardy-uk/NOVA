// Org KPI (Layer 1) read/write API. Reads serve the Support/NT scorecard from
// kpi_org_daily, enriched with registry metadata (label, unit, direction, etc).
// Writes: manual entry (#18/#19) and a manual capture trigger.

import { Router } from 'express';
import type { JiraRestClient } from '../services/jira-client.js';
import {
  captureSupportNt, getDay, getLatest, getRange, setManualValue,
  ORG_KPIS, getKpi,
} from '../services/kpi-org/index.js';
import type { OrgKpiDailyRow } from '../services/kpi-org/store.js';

export interface KpiOrgDeps {
  getJiraClient: () => JiraRestClient | null;
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

  // A specific day's snapshot.
  router.get('/support/day/:day', async (req, res) => {
    try {
      const rows = await getDay('Support', req.params.day);
      res.json({ ok: true, data: rows.map(enrich) });
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
