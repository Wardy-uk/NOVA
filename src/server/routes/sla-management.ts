import { Router } from 'express';
import type { SlaManager } from '../services/sla-manager.js';
import { requireRole } from '../middleware/auth.js';

export function createSlaManagementRoutes(slaManager: SlaManager): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/stats', async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const stats = await slaManager.getInterventionStats(days);
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
