import { Router } from 'express';
import type { Dynamics365Service } from '../services/dynamics365.js';
import type { CrmQueries } from '../db/queries.js';

export function createDynamics365Routes(
  getService: () => Dynamics365Service | null,
  crmQueries: CrmQueries
): Router {
  const router = Router();

  // GET /api/dynamics365/test — connection test
  router.get('/test', async (_req, res) => {
    const svc = getService();
    if (!svc) {
      res.status(503).json({ ok: false, error: 'Dynamics 365 not configured. Add credentials in Settings.' });
      return;
    }
    try {
      const result = await svc.whoAmI();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    }
  });

  // GET /api/dynamics365/accounts — browse live D365 accounts
  router.get('/accounts', async (req, res) => {
    const svc = getService();
    if (!svc) {
      res.status(503).json({ ok: false, error: 'Dynamics 365 not configured' });
      return;
    }
    try {
      const top = req.query.top ? parseInt(req.query.top as string, 10) : 100;
      const accounts = await svc.getAccounts(top);
      res.json({ ok: true, data: accounts });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch accounts',
      });
    }
  });

  // POST /api/dynamics365/sync — pull D365 accounts into local CRM
  router.post('/sync', async (_req, res) => {
    const svc = getService();
    if (!svc) {
      res.status(503).json({ ok: false, error: 'Dynamics 365 not configured' });
      return;
    }
    try {
      const result = await svc.syncToLocal(crmQueries);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  });

  // GET /api/dynamics365/status — service status
  router.get('/status', (_req, res) => {
    const svc = getService();
    if (!svc) {
      res.json({ ok: true, data: { status: 'disconnected', lastError: 'Not configured', lastConnected: null } });
      return;
    }
    res.json({ ok: true, data: svc.getStatus() });
  });

  return router;
}
