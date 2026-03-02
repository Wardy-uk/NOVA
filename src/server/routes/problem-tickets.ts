import { Router } from 'express';
import type { ProblemTicketQueries } from '../db/queries.js';
import type { ProblemTicketScanner } from '../services/problem-ticket-scanner.js';
import { requireRole } from '../middleware/auth.js';

export function createProblemTicketRoutes(
  queries: ProblemTicketQueries,
  getScanner: () => ProblemTicketScanner | null,
): Router {
  const router = Router();

  // GET / — list active alerts
  router.get('/', (req, res) => {
    try {
      const severity = req.query.severity as string | undefined;
      const projectKey = req.query.project as string | undefined;
      const alerts = queries.getActiveAlerts({
        severity: severity || undefined,
        projectKey: projectKey || undefined,
      });
      res.json({ ok: true, data: alerts });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /stats — aggregate stats
  router.get('/stats', (_req, res) => {
    try {
      const stats = queries.getStats();
      res.json({ ok: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /config — rule config
  router.get('/config', (_req, res) => {
    try {
      const config = queries.getConfig();
      res.json({ ok: true, data: config });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /config/:rule — update rule config (admin only)
  router.put('/config/:rule', requireRole('admin'), (req, res) => {
    try {
      const rule = req.params.rule as string;
      const { enabled, weight, threshold_json } = req.body;
      queries.updateConfig(rule, { enabled, weight, threshold_json });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /scan — trigger on-demand scan
  router.post('/scan', async (_req, res) => {
    try {
      const scanner = getScanner();
      if (!scanner) {
        return res.status(503).json({ ok: false, error: 'Scanner not available (no Jira client)' });
      }
      const result = await scanner.scan();
      if (result.error) {
        return res.json({ ok: false, error: result.error, data: result });
      }
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /:issueKey — single alert with reasons
  router.get('/:issueKey', (req, res) => {
    try {
      const alert = queries.getAlertByIssueKey(req.params.issueKey);
      if (!alert) {
        return res.status(404).json({ ok: false, error: 'Alert not found' });
      }
      res.json({ ok: true, data: alert });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /:issueKey/ignore — ignore an alert
  router.post('/:issueKey/ignore', (req, res) => {
    try {
      const alert = queries.getAlertByIssueKey(req.params.issueKey);
      if (!alert) {
        return res.status(404).json({ ok: false, error: 'Alert not found' });
      }
      const username = (req as any).user?.username ?? 'unknown';
      const reason = req.body?.reason ?? null;
      queries.insertIgnore(req.params.issueKey, username, reason, alert.fingerprint);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /:issueKey/ignores — ignore history
  router.get('/:issueKey/ignores', (req, res) => {
    try {
      const ignores = queries.getIgnoresForIssue(req.params.issueKey);
      res.json({ ok: true, data: ignores });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
