import { Router, type Request, type Response } from 'express';
import { PortalDashboardService } from '../services/portal-dashboards.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { canViewAllOrgTickets, canEscalateTicket, PORTAL_ROLE_RANK } from '../../shared/portal-types.js';
import { listMemberships } from '../services/portal-org-membership.js';
import { getSlaMatrix } from '../services/portal-sla-matrix.js';
import type { GuildDashboardService } from '../services/guild-dashboard.js';

// Customer-facing Onboarding + Support dashboards, scoped to the portal user's
// organisation (→ BC Account Number OR reporter set). Queries Jira live so it
// spans every project. Mounted behind portalGate + portalAuth.
export function createPortalDashboardRoutes(settings: FileSettingsQueries | undefined, jira: JiraRestClient | null, guildDashboard?: GuildDashboardService): Router {
  const router = Router();
  const service = new PortalDashboardService(settings, jira);

  // Orgs this user may switch into, plus the one they're currently in. Drives the
  // org switcher; a single-org customer gets one entry and no switcher is shown.
  router.get('/my-orgs', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const memberships = await listMemberships({
        userId: req.portalUser.userId,
        homeOrgId: req.portalUser.homeOrgId ?? req.portalUser.orgId,
        role: req.portalUser.role,
        authType: req.portalUser.authType,
      });
      res.json({
        ok: true,
        data: {
          orgs: memberships.map(m => ({ orgId: m.orgId, orgName: m.orgName, kind: m.kind, canWrite: m.canWrite, role: m.role })),
          activeOrgId: req.portalUser.orgId,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load organisations' });
    }
  });

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

  // SLA reference matrix for the About page — derived from live Jira SLA data.
  // Admin-only (org_admin and above): it exposes internal SLA targets.
  router.get('/sla-matrix', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (PORTAL_ROLE_RANK[req.portalUser.role] < PORTAL_ROLE_RANK.org_admin) {
      res.status(403).json({ ok: false, error: 'Admin only' }); return;
    }
    if (!jira) { res.status(503).json({ ok: false, error: 'Jira is not configured' }); return; }
    try {
      const data = await getSlaMatrix(jira, { force: req.query.refresh === '1' });
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to derive SLA matrix' });
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

  // Guild/BYM onboarding tracker (backlog #8) — records-based, scoped to the
  // portal user's org. Read-only for the customer; BYM staff edit fields in NOVA.
  router.get('/dashboards/guild-onboarding', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!guildDashboard) { res.json({ ok: true, data: { rows: [], generatedAt: new Date().toISOString() } }); return; }
    try {
      const data = await guildDashboard.getDashboard({ orgId: req.portalUser.orgId });
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load onboarding tracker' });
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
