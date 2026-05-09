import { Router, type Request, type Response } from 'express';
import { query, queryOne, execute } from '../services/database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { getMetrics, getTopSearches, getEventCounts } from '../services/portal-analytics.js';

export function createPortalAdminRoutes(settings: FileSettingsQueries): Router {
  const router = Router();

  // Portal users list
  router.get('/users', async (_req: Request, res: Response) => {
    try {
      const users = await query<{
        id: number;
        email: string;
        display_name: string;
        org_name: string;
        last_login: string;
        role: string;
      }>(
        `SELECT pu.id, pu.email, pu.display_name, po.name AS org_name, pu.last_login, pu.role
         FROM portal_users pu
         JOIN portal_organisations po ON pu.org_id = po.id
         ORDER BY pu.last_login DESC`,
      );
      res.json({ ok: true, data: users });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list users' });
    }
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
      }>(
        `SELECT po.id, po.name, po.domain, po.external_id,
                (SELECT COUNT(*) FROM portal_users WHERE org_id = po.id) AS user_count
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
