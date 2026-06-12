// TPJ Maintenance (NTPJ) dashboard API. All reads are scoped to the NTPJ Jira
// project. Time-series comes live from Jira REST; backlog-by-status from the
// nightly EOD snapshot. See services/tpj-maintenance.ts for the data layer.

import { Router } from 'express';
import type { JiraRestClient } from '../services/jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import {
  getDashboardSnapshot, getRaisedVsSolvedDaily, getSlaStatus, getSlaMetVsExceededDaily,
  getBacklogByStatusDaily, getKpiMetrics, getPspMonthlyByAgent, getSloTrendWeekly,
} from '../services/tpj-maintenance.js';

export interface TpjMaintenanceDeps {
  getJiraClient: () => JiraRestClient | null;
  settings: SettingsQueries;
}

/** Validate from/to (YYYY-MM-DD); default to the current calendar month. */
function range(req: { query: Record<string, unknown> }): { from: string; to: string } {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const ok = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return {
    from: ok(req.query.from) ? (req.query.from as string) : iso(monthStart),
    to: ok(req.query.to) ? (req.query.to as string) : iso(today),
  };
}

export function createTpjMaintenanceRoutes(deps: TpjMaintenanceDeps): Router {
  const router = Router();

  // Wrap a handler that needs a live Jira client, returning a clear 503 if unconfigured.
  const withJira = (fn: (client: JiraRestClient, from: string, to: string) => Promise<unknown>) =>
    async (req: any, res: any) => {
      const client = deps.getJiraClient();
      if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }
      const { from, to } = range(req);
      try {
        res.json({ ok: true, data: await fn(client, from, to) });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
      }
    };

  router.get('/dashboard', withJira((c, f, t) => getDashboardSnapshot(c, f, t)));
  router.get('/raised-vs-solved', withJira((c, f, t) => getRaisedVsSolvedDaily(c, f, t)));
  router.get('/sla-status', withJira((c, f, t) => getSlaStatus(c, f, t)));
  router.get('/sla-daily', withJira((c, f, t) => getSlaMetVsExceededDaily(c, f, t)));
  router.get('/psp-monthly', withJira((c, f, t) => getPspMonthlyByAgent(c, f, t)));
  router.get('/slo-trend', withJira((c) => getSloTrendWeekly(c)));
  router.get('/metrics', withJira((c, f, t) => getKpiMetrics(c, deps.settings, f, t)));

  // Backlog-by-status reads the KPI DB snapshot, not Jira.
  router.get('/backlog-daily', async (req, res) => {
    const { from, to } = range(req);
    try {
      res.json({ ok: true, data: await getBacklogByStatusDaily(deps.settings, from, to) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  });

  return router;
}
