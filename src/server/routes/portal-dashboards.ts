import { Router, type Request, type Response } from 'express';
import { PortalDashboardService } from '../services/portal-dashboards.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { canViewAllOrgTickets, canEscalateTicket } from '../../shared/portal-types.js';

// Customer-facing Onboarding + Support dashboards, scoped to the portal user's
// organisation (→ BC Account Number OR reporter set). Queries Jira live so it
// spans every project. Mounted behind portalGate + portalAuth.
export function createPortalDashboardRoutes(settings: FileSettingsQueries | undefined, jira: JiraRestClient | null): Router {
  const router = Router();
  const service = new PortalDashboardService(settings, jira);

  router.get('/features', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const data = await service.getOrgFeatures(req.portalUser.orgId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load features' });
    }
  });

  router.get('/branding', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const data = await service.getOrgBranding(req.portalUser.orgId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load branding' });
    }
  });

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

  // My Tickets — role-scoped. Requesters get their own tickets only; leaders and
  // above may request the full org scope. Managers may also escalate.
  router.get('/my-tickets', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const role = req.portalUser.role;
      const canViewOrg = canViewAllOrgTickets(role);
      const wantsOrg = req.query.scope === 'org';
      const scope: 'mine' | 'org' = wantsOrg && canViewOrg ? 'org' : 'mine';
      const status = (req.query.status as 'all' | 'open' | 'resolved') || 'all';
      const tickets = await service.listTickets({
        orgId: req.portalUser.orgId,
        userEmail: req.portalUser.email,
        scope,
        status,
        search: (req.query.search as string) || undefined,
      });
      res.json({ ok: true, data: { tickets, scope, canViewOrg, canEscalate: canEscalateTicket(role) } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load tickets' });
    }
  });

  router.post('/tickets/:key/escalate', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!canEscalateTicket(req.portalUser.role)) {
      res.status(403).json({ ok: false, error: 'Escalation requires the Manager role' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) { res.status(400).json({ ok: false, error: 'An escalation reason is required' }); return; }
    try {
      const result = await service.escalateTicket(req.params.key as string, reason, req.portalUser.email, req.portalUser.orgId);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to escalate ticket' });
    }
  });

  return router;
}
