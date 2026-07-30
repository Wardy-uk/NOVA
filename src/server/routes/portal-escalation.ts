import { Router, type Request, type Response } from 'express';
import { queryOne, execute } from '../services/database.js';
import {
  DEFAULT_ESCALATION_POLICY,
  OnboardingEscalationPolicySchema,
  OnboardingOrgConfigSchema,
  DEFAULT_ONBOARDING_ORG_CONFIG,
  PORTAL_ROLE_RANK,
  type OnboardingEscalationPolicy,
} from '../../shared/portal-types.js';
import type { OnboardingEscalationService } from '../services/onboarding-escalation-service.js';

// Per-org onboarding escalation policy. Readable/editable by Org Admin and above.
// Storage: portal_organisations.escalation_policy (JSON). No policy yet → a
// neutral default template is returned so admins start from a sensible base.
export function createPortalEscalationRoutes(escalation: OnboardingEscalationService): Router {
  const router = Router();

  const isOrgAdmin = (req: Request) =>
    !!req.portalUser && PORTAL_ROLE_RANK[req.portalUser.role] >= PORTAL_ROLE_RANK.org_admin;

  router.get('/escalation-policy', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    try {
      const row = await queryOne<{ escalation_policy: string | null }>(
        `SELECT escalation_policy FROM portal_organisations WHERE id = ?`,
        [req.portalUser.orgId],
      );
      let policy: OnboardingEscalationPolicy = DEFAULT_ESCALATION_POLICY;
      let isDefault = true;
      if (row?.escalation_policy) {
        try {
          const parsed = OnboardingEscalationPolicySchema.safeParse(JSON.parse(row.escalation_policy));
          if (parsed.success) { policy = parsed.data; isDefault = false; }
        } catch { /* fall back to default */ }
      }
      res.json({ ok: true, data: { policy, isDefault } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load escalation policy' });
    }
  });

  router.put('/escalation-policy', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }

    const parsed = OnboardingEscalationPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') });
      return;
    }
    // Progress updates go to the onboarding's requestor automatically, so only
    // internal escalation levels need a configured recipient before enabling.
    if (parsed.data.enabled) {
      const missing = parsed.data.levels.some(l =>
        l.escalate && l.escalationRecipients.every(r => !r.email.trim()),
      );
      if (missing) {
        res.status(400).json({ ok: false, error: 'Add at least one recipient email to every enabled escalation level before turning the policy on.' });
        return;
      }
    }

    try {
      await execute(
        `UPDATE portal_organisations SET escalation_policy = ?, updated_at = GETUTCDATE() WHERE id = ?`,
        [JSON.stringify(parsed.data), req.portalUser.orgId],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to save escalation policy' });
    }
  });

  // Onboarding org config (backlog #8, level 3) — recipient addresses this org's
  // admin sets for the Guild pipeline's alerts/digest/INTS escalations.
  router.get('/onboarding-config', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    try {
      const row = await queryOne<{ onboarding_config: string | null }>(
        `SELECT onboarding_config FROM portal_organisations WHERE id = ?`,
        [req.portalUser.orgId],
      );
      let config = DEFAULT_ONBOARDING_ORG_CONFIG;
      if (row?.onboarding_config) {
        const parsed = OnboardingOrgConfigSchema.safeParse(JSON.parse(row.onboarding_config));
        if (parsed.success) config = parsed.data;
      }
      res.json({ ok: true, data: config });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load onboarding config' });
    }
  });

  router.put('/onboarding-config', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    const parsed = OnboardingOrgConfigSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') }); return; }
    try {
      await execute(
        `UPDATE portal_organisations SET onboarding_config = ?, updated_at = GETUTCDATE() WHERE id = ?`,
        [JSON.stringify(parsed.data), req.portalUser.orgId],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to save onboarding config' });
    }
  });

  // Onboarding tickets for the test-send picker.
  router.get('/escalation-policy/onboardings', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    try {
      const data = await escalation.listOrgOnboardings(req.portalUser.orgId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load onboardings' });
    }
  });

  // Fire a level's emails for selected tickets as a test — delivered only to the
  // triggering admin, marked [TEST], nothing logged.
  router.post('/escalation-policy/test-send', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    const levelDay = Number(req.body?.levelDay);
    const ticketKeys = Array.isArray(req.body?.ticketKeys) ? req.body.ticketKeys.filter((k: unknown) => typeof k === 'string') : [];
    if (!levelDay || ticketKeys.length === 0) {
      res.status(400).json({ ok: false, error: 'Pick a level and at least one onboarding ticket.' });
      return;
    }
    try {
      const result = await escalation.testSend(req.portalUser.orgId, levelDay, ticketKeys, req.portalUser.email);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Test send failed' });
    }
  });

  return router;
}
