import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { query, queryOne, execute } from '../services/database.js';
import { PORTAL_ROLE_RANK as RANK } from '../../shared/portal-types.js';

const VALID_ROLES = ['requester', 'leader', 'manager', 'org_admin', 'admin'];
const normaliseRole = (r: unknown) => (typeof r === 'string' && VALID_ROLES.includes(r) ? r : 'requester');

// The org's portal users, managed by Org Admins from within the portal. These are
// the SAME portal_users rows the NOVA staff Portal Admin edits — so the two views
// stay in sync automatically. Each user carries an "include in setup" flag used by
// the Onboarding Request flow.
export function createPortalOrgUserRoutes(): Router {
  const router = Router();

  const isOrgAdmin = (req: Request) =>
    !!req.portalUser && RANK[req.portalUser.role] >= RANK.org_admin;

  router.get('/org-users', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    try {
      const rows = await query(
        `SELECT id, email, display_name, role, auth_type, access_state, include_in_setup
         FROM portal_users
         WHERE org_id = ? AND access_state <> 'removed'
         ORDER BY display_name`,
        [req.portalUser.orgId],
      );
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load users' });
    }
  });

  // Add or update a user in the active org (upsert by email). Provisions a portal
  // account for a new email so adding them here also gives them portal access.
  router.post('/org-users', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
    const role = normaliseRole(req.body?.role);
    const includeInSetup = req.body?.include_in_setup ? 1 : 0;
    if (!email || !email.includes('@')) { res.status(400).json({ ok: false, error: 'A valid email is required' }); return; }

    try {
      const existing = await queryOne<{ id: number; org_id: number }>(
        `SELECT TOP 1 id, org_id FROM portal_users WHERE LOWER(email) = LOWER(?) AND access_state <> 'removed' ORDER BY id`,
        [email],
      );
      if (existing) {
        // Only manage users that belong to this org — never touch another org's user.
        if (existing.org_id !== req.portalUser.orgId) {
          res.status(409).json({ ok: false, error: 'That email already belongs to a user in another organisation.' });
          return;
        }
        await execute(
          `UPDATE portal_users SET display_name = COALESCE(NULLIF(?, ''), display_name), role = ?, include_in_setup = ? WHERE id = ?`,
          [displayName, role, includeInSetup, existing.id],
        );
        res.json({ ok: true, data: { id: existing.id } });
      } else {
        const created = await queryOne<{ id: number }>(
          `INSERT INTO portal_users (external_id, org_id, email, display_name, role, auth_type, access_state, include_in_setup)
           OUTPUT INSERTED.id
           VALUES (?, ?, ?, ?, ?, 'oidc', 'active', ?)`,
          [`local-user-${crypto.randomUUID()}`, req.portalUser.orgId, email, displayName || email, role, includeInSetup],
        );
        res.json({ ok: true, data: { id: created!.id } });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to save user' });
    }
  });

  router.delete('/org-users/:id', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!isOrgAdmin(req)) { res.status(403).json({ ok: false, error: 'Organisation admin access required' }); return; }
    const id = parseInt(req.params.id as string, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Valid user ID required' }); return; }
    try {
      const user = await queryOne<{ id: number; org_id: number }>(`SELECT id, org_id FROM portal_users WHERE id = ?`, [id]);
      if (!user || user.org_id !== req.portalUser.orgId) { res.status(404).json({ ok: false, error: 'User not found in your organisation' }); return; }
      if (id === req.portalUser.userId) { res.status(400).json({ ok: false, error: 'You cannot remove yourself.' }); return; }
      await execute(
        `UPDATE portal_users SET access_state = 'removed', removed_at = GETUTCDATE() WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to remove user' });
    }
  });

  return router;
}
