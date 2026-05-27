import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, execute } from '../services/database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { getMetrics, getTopSearches, getEventCounts, getKbDeflectionTarget } from '../services/portal-analytics.js';

export function createPortalAdminRoutes(settings: FileSettingsQueries): Router {
  const router = Router();

  async function ensureOrganisation(orgId: number | null, name: string | null, domain: string | null): Promise<number> {
    if (orgId) {
      const existing = await queryOne<{ id: number }>(
        `SELECT id FROM portal_organisations WHERE id = ?`,
        [orgId],
      );
      if (!existing) {
        throw new Error('Selected organisation was not found');
      }
      return existing.id;
    }

    const orgName = name?.trim();
    if (!orgName) {
      throw new Error('Organisation is required');
    }
    const normalizedDomain = domain?.trim().toLowerCase() || null;

    if (normalizedDomain) {
      const byDomain = await queryOne<{ id: number }>(
        `SELECT TOP 1 id FROM portal_organisations WHERE LOWER(domain) = LOWER(?) ORDER BY id`,
        [normalizedDomain],
      );
      if (byDomain) {
        await execute(
          `UPDATE portal_organisations SET name = ?, updated_at = GETUTCDATE() WHERE id = ?`,
          [orgName, byDomain.id],
        );
        return byDomain.id;
      }
    }

    const result = await queryOne<{ id: number }>(
      `INSERT INTO portal_organisations (external_id, name, domain)
       OUTPUT INSERTED.id VALUES (?, ?, ?)`,
      [`local-org-${crypto.randomUUID()}`, orgName, normalizedDomain],
    );
    return result!.id;
  }

  // Portal users list
  router.get('/users', async (_req: Request, res: Response) => {
    try {
      const users = await query<{
        id: number;
        email: string;
        display_name: string;
        org_id: number;
        org_name: string;
        last_login: string;
        role: string;
        auth_type: string;
        access_state: string;
        ticket_count: number;
      }>(
        `SELECT pu.id, pu.email, pu.display_name, pu.org_id, po.name AS org_name, pu.last_login, pu.role,
                pu.auth_type, pu.access_state,
                (SELECT COUNT(*) FROM jira_issue_cache jic WHERE jic.reporter_email = pu.email) AS ticket_count
         FROM portal_users pu
         JOIN portal_organisations po ON pu.org_id = po.id
         ORDER BY pu.last_login DESC`,
      );
      res.json({ ok: true, data: users });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list users' });
    }
  });

  router.post('/users', async (req: Request, res: Response) => {
    const {
      email,
      display_name,
      password,
      role,
      org_id,
      organisation_name,
      organisation_domain,
    } = req.body ?? {};

    if (!email?.trim() || !display_name?.trim() || !password) {
      res.status(400).json({ ok: false, error: 'Email, display name, password, and organisation are required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await queryOne<{ id: number; auth_type: string; access_state: string }>(
      `SELECT TOP 1 id, auth_type, access_state
       FROM portal_users
       WHERE LOWER(email) = LOWER(?)
         AND access_state <> 'removed'
       ORDER BY id DESC`,
      [normalizedEmail],
    );
    if (existing) {
      res.status(409).json({ ok: false, error: `A portal user already exists for ${normalizedEmail}` });
      return;
    }

    try {
      const resolvedOrgId = await ensureOrganisation(
        typeof org_id === 'number' ? org_id : null,
        typeof organisation_name === 'string' ? organisation_name : null,
        typeof organisation_domain === 'string' ? organisation_domain : null,
      );
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await queryOne<{ id: number }>(
        `INSERT INTO portal_users
           (external_id, org_id, email, display_name, role, password_hash, auth_type, access_state)
         OUTPUT INSERTED.id
         VALUES (?, ?, ?, ?, ?, ?, 'local', 'active')`,
        [`local-user-${crypto.randomUUID()}`, resolvedOrgId, normalizedEmail, display_name.trim(), role === 'admin' ? 'admin' : role === 'org_admin' ? 'org_admin' : 'requester', passwordHash],
      );
      res.json({ ok: true, data: { id: result!.id } });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create portal user' });
    }
  });

  router.post('/users/:id/access', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const { access_state } = req.body ?? {};
    if (!id || !['active', 'disabled'].includes(access_state)) {
      res.status(400).json({ ok: false, error: 'Valid user ID and access_state are required' });
      return;
    }

    const user = await queryOne<{ id: number; auth_type: string; access_state: string }>(
      `SELECT id, auth_type, access_state FROM portal_users WHERE id = ?`,
      [id],
    );
    if (!user) {
      res.status(404).json({ ok: false, error: 'Portal user not found' });
      return;
    }
    if (user.auth_type !== 'local') {
      res.status(400).json({ ok: false, error: 'Only local portal users can be lifecycle-managed here' });
      return;
    }
    if (user.access_state === 'removed') {
      res.status(400).json({ ok: false, error: 'Removed portal users cannot be reactivated from this action' });
      return;
    }

    await execute(
      `UPDATE portal_users
       SET access_state = ?,
           disabled_at = CASE WHEN ? = 'disabled' THEN GETUTCDATE() ELSE NULL END,
           removed_at = CASE WHEN ? = 'active' THEN NULL ELSE removed_at END
       WHERE id = ?`,
      [access_state, access_state, access_state, id],
    );
    res.json({ ok: true });
  });

  router.delete('/users/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ ok: false, error: 'Valid user ID is required' });
      return;
    }

    const user = await queryOne<{ id: number; auth_type: string }>(
      `SELECT id, auth_type FROM portal_users WHERE id = ?`,
      [id],
    );
    if (!user) {
      res.status(404).json({ ok: false, error: 'Portal user not found' });
      return;
    }
    if (user.auth_type !== 'local') {
      res.status(400).json({ ok: false, error: 'Only local portal users can be removed here' });
      return;
    }

    await execute(
      `UPDATE portal_users
       SET access_state = 'removed',
           password_hash = NULL,
           refresh_token = NULL,
           token_expires_at = NULL,
           disabled_at = NULL,
           removed_at = GETUTCDATE()
       WHERE id = ?`,
      [id],
    );
    res.json({ ok: true });
  });

  // Portal organisations list
  router.get('/organisations', async (_req: Request, res: Response) => {
    try {
      const orgs = await query<{
        id: number;
        name: string;
        domain: string | null;
        external_id: string;
        user_count: number;
        ticket_count: number;
      }>(
        `SELECT po.id, po.name, po.domain, po.external_id,
                (SELECT COUNT(*) FROM portal_users WHERE org_id = po.id) AS user_count,
                (SELECT COUNT(*) FROM jira_issue_cache jic
                 WHERE jic.reporter_email LIKE '%@' + po.domain
                   AND po.domain IS NOT NULL AND po.domain != '') AS ticket_count
         FROM portal_organisations po
         ORDER BY po.name`,
      );
      res.json({ ok: true, data: orgs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list organisations' });
    }
  });

  // Org → Jira mapping
  router.get('/org-mapping', async (_req: Request, res: Response) => {
    try {
      const mappings = await query(
        `SELECT m.*, po.name AS org_name
         FROM portal_org_jira_mapping m
         JOIN portal_organisations po ON m.org_id = po.id`,
      );
      res.json({ ok: true, data: mappings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list mappings' });
    }
  });

  router.put('/org-mapping/:orgId', async (req: Request, res: Response) => {
    const orgId = parseInt(req.params.orgId as string, 10);
    const { jira_organisation_id, jira_email_domain } = req.body;
    try {
      const existing = await queryOne(
        `SELECT id FROM portal_org_jira_mapping WHERE org_id = ?`,
        [orgId],
      );
      if (existing) {
        await execute(
          `UPDATE portal_org_jira_mapping SET jira_organisation_id = ?, jira_email_domain = ? WHERE org_id = ?`,
          [jira_organisation_id || null, jira_email_domain || null, orgId],
        );
      } else {
        await execute(
          `INSERT INTO portal_org_jira_mapping (org_id, jira_organisation_id, jira_email_domain) VALUES (?, ?, ?)`,
          [orgId, jira_organisation_id || null, jira_email_domain || null],
        );
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update mapping' });
    }
  });

  // Chat sessions log
  router.get('/chat-sessions', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    try {
      const sessions = await query(
        `SELECT TOP (${limit}) cs.*, pu.display_name, pu.email, po.name AS org_name
         FROM portal_chat_sessions cs
         JOIN portal_users pu ON cs.portal_user_id = pu.id
         JOIN portal_organisations po ON pu.org_id = po.id
         ORDER BY cs.started_at DESC`,
      );
      res.json({ ok: true, data: sessions });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list sessions' });
    }
  });

  // Portal metrics / analytics
  router.get('/metrics', async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string, 10) || 30;
    try {
      const metrics = await getMetrics(days);
      res.json({ ok: true, data: metrics });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get metrics' });
    }
  });

  router.get('/top-searches', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    try {
      const searches = await getTopSearches(limit);
      res.json({ ok: true, data: searches });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get top searches' });
    }
  });

  router.get('/event-counts', async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const counts = await getEventCounts(since);
      res.json({ ok: true, data: counts });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get event counts' });
    }
  });

  // KB deflection baseline vs target
  router.get('/kb-deflection-target', async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string, 10) || 30;
    const targetMin = parseInt(settings.get('portal_kb_deflection_target_min') || '20', 10);
    const targetMax = parseInt(settings.get('portal_kb_deflection_target_max') || '30', 10);
    try {
      const data = await getKbDeflectionTarget(days, targetMin, targetMax);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get KB deflection target' });
    }
  });

  // Portal settings
  router.get('/settings', (_req: Request, res: Response) => {
    const portalSettings: Record<string, string> = {};
    const allSettings = settings.getAll();
    for (const [key, value] of Object.entries(allSettings)) {
      if (key.startsWith('portal_')) {
        portalSettings[key] = value;
      }
    }
    res.json({ ok: true, data: portalSettings });
  });

  router.put('/settings', (req: Request, res: Response) => {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ ok: false, error: 'Request body must be an object of key-value pairs' });
      return;
    }
    try {
      for (const [key, value] of Object.entries(updates)) {
        if (!key.startsWith('portal_')) continue;
        settings.set(key, String(value));
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update settings' });
    }
  });

  // Widget embed code generator
  router.get('/widget-embed', (_req: Request, res: Response) => {
    const apiUrl = settings.get('portal_oidc_redirect_uri')?.replace('/api/portal/auth/callback', '') || 'https://nova.nurtur.local';
    const brandColor = settings.get('portal_widget_brand_color') || '#1e40af';
    const greeting = settings.get('portal_widget_greeting') || 'Hi! How can we help you today?';

    const embedCode = `<script src="${apiUrl}/widget/portal-chat.js"
  data-api="${apiUrl}"
  data-theme="light"
  data-position="bottom-right"
  data-brand-color="${brandColor}"
  data-greeting="${greeting.replace(/"/g, '&quot;')}">
</script>`;

    res.json({ ok: true, data: { embedCode, apiUrl, brandColor, greeting } });
  });

  return router;
}
