import { Router, type Request, type Response } from 'express';
import { PortalDashboardService } from '../services/portal-dashboards.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

// Customer-facing Onboarding + Support dashboards, scoped to the portal user's
// organisation (→ BC Account Number). Mounted behind portalGate + portalAuth.
export function createPortalDashboardRoutes(settings?: FileSettingsQueries): Router {
  const router = Router();
  const service = new PortalDashboardService(settings);

  router.get('/dashboards/onboarding', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const data = await service.getOnboardingDashboard(req.portalUser.orgId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load onboarding dashboard' });
    }
  });

  router.get('/dashboards/support', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const data = await service.getSupportDashboard(req.portalUser.orgId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load support dashboard' });
    }
  });

  return router;
}
