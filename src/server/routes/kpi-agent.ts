// Per-agent KPI (Layer 3) API. Live scorecard, stored day/history, manual capture.

import { Router } from 'express';
import type { JiraRestClient } from '../services/jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import {
  captureAgentKpis, getAgentLiveSnapshot, getLatestDay, getDay, getAgentHistory, getAgentPeriod, getAgentHistoryGrid, backfillAgentFromLegacy,
} from '../services/kpi-agent/index.js';
import { getLegacyEarliest } from '../services/kpi-org/index.js';

function yesterday(): string { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

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

  // Daily / weekly / monthly rollup across all agents: /period?period=day|week|month&anchor=YYYY-MM-DD
  router.get('/period', async (req, res) => {
    const q = req.query.period;
    const period = (q === 'month' ? 'month' : q === 'day' ? 'day' : 'week') as 'day' | 'week' | 'month';
    const anchor = (req.query.anchor as string) || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    try {
      res.json({ ok: true, data: await getAgentPeriod(deps.settings, period, anchor) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  // Daily-history grid (agents × date columns) for one metric: /history-grid?from&to&metric
  router.get('/history-grid', async (req, res) => {
    const { from, to, metric } = req.query as { from?: string; to?: string; metric?: string };
    if (!from || !to) { res.status(400).json({ ok: false, error: 'from and to required' }); return; }
    try {
      res.json({ ok: true, data: await getAgentHistoryGrid(from, to, metric || 'solvedToday') });
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

  // Backfill agent history from legacy dbo.jira_agent_kpi_daily (single SQL pull —
  // fast even for full history). Body: { from?, to? } — defaults to FULL history.
  router.post('/backfill', async (req, res) => {
    try {
      const body = req.body as { from?: string; to?: string };
      const to = body.to || yesterday();
      const from = body.from || (await getLegacyEarliest(deps.settings)).agent || '2024-01-01';
      res.json({ ok: true, data: { ...(await backfillAgentFromLegacy(deps.settings, from, to)), from, to } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  return router;
}
