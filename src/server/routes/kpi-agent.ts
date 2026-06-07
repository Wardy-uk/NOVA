// Per-agent KPI (Layer 3) API. Live scorecard, stored day/history, manual capture.

import { Router } from 'express';
import type { JiraRestClient } from '../services/jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import {
  captureAgentKpis, getAgentLiveSnapshot, getLatestDay, getDay, getAgentHistory, getAgentPeriod,
} from '../services/kpi-agent/index.js';

export interface KpiAgentDeps {
  getJiraClient: () => JiraRestClient | null;
  settings: SettingsQueries;
}

export function createKpiAgentRoutes(deps: KpiAgentDeps): Router {
  const router = Router();

  // Live scorecard — recompute (60s-cached). Falls back to latest stored if no Jira client.
  router.get('/live', async (_req, res) => {
    const jira = deps.getJiraClient();
    if (!jira) {
      try { res.json({ ok: true, data: { agents: await getLatestDay(), live: false } }); }
      catch (err) { res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' }); }
      return;
    }
    try {
      const snap = await getAgentLiveSnapshot(deps.settings, jira);
      res.json({ ok: true, data: { agents: snap.agents, live: true, updatedAt: snap.updatedAt } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  router.get('/latest', async (_req, res) => {
    try { res.json({ ok: true, data: await getLatestDay() }); }
    catch (err) { res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' }); }
  });

  router.get('/day/:day', async (req, res) => {
    try { res.json({ ok: true, data: await getDay(req.params.day) }); }
    catch (err) { res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' }); }
  });

  // Weekly / monthly rollup across all agents: /period?period=week|month&anchor=YYYY-MM-DD
  router.get('/period', async (req, res) => {
    const period = (req.query.period === 'month' ? 'month' : 'week') as 'week' | 'month';
    const anchor = (req.query.anchor as string) || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    try {
      res.json({ ok: true, data: await getAgentPeriod(deps.settings, period, anchor) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  router.get('/agent/:accountId/history', async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) { res.status(400).json({ ok: false, error: 'from and to required' }); return; }
    try { res.json({ ok: true, data: await getAgentHistory(req.params.accountId, from, to) }); }
    catch (err) { res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' }); }
  });

  router.post('/capture', async (_req, res) => {
    const jira = deps.getJiraClient();
    if (!jira) { res.status(503).json({ ok: false, error: 'Jira client not configured' }); return; }
    const summary = await captureAgentKpis(deps.settings, jira);
    res.json({ ok: summary.failed ? false : true, data: summary });
  });

  return router;
}
