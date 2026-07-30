import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, execute } from '../services/database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { getMetrics, getTopSearches, getEventCounts, getKbDeflectionTarget } from '../services/portal-analytics.js';
import { parseSupportRoutes } from '../../shared/portal-types.js';
import { fetchOrgBranding } from '../services/portal-branding.js';
import type { LlmService } from '../services/llm-service.js';

const VALID_PORTAL_ROLES = ['requester', 'leader', 'manager', 'org_admin', 'admin'];
function normalisePortalRole(role: unknown): string {
  return typeof role === 'string' && VALID_PORTAL_ROLES.includes(role) ? role : 'requester';
}

export function createPortalAdminRoutes(settings: FileSettingsQueries, llm?: LlmService | null): Router {
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
        include_in_setup: number;
        ticket_count: number;
      }>(
        `SELECT pu.id, pu.email, pu.display_name, pu.org_id, po.name AS org_name, pu.last_login, pu.role,
                pu.auth_type, pu.access_state, pu.include_in_setup,
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
        [`local-user-${crypto.randomUUID()}`, resolvedOrgId, normalizedEmail, display_name.trim(), normalisePortalRole(role), passwordHash],
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

  // Edit a portal user: display name, role, organisation, and optional password reset.
  router.put('/users/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const { display_name, role, org_id, password, include_in_setup } = req.body ?? {};
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

    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof display_name === 'string' && display_name.trim()) {
      sets.push('display_name = ?'); params.push(display_name.trim());
    }
    if (typeof role === 'string') {
      sets.push('role = ?'); params.push(normalisePortalRole(role));
    }
    if (typeof org_id === 'number' && org_id > 0) {
      sets.push('org_id = ?'); params.push(org_id);
    }
    if (typeof include_in_setup === 'boolean') {
      sets.push('include_in_setup = ?'); params.push(include_in_setup ? 1 : 0);
    }
    if (typeof password === 'string' && password.length > 0) {
      if (password.length < 8) {
        res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
        return;
      }
      if (user.auth_type !== 'local') {
        res.status(400).json({ ok: false, error: 'Only local portal users can have a password set here' });
        return;
      }
      sets.push('password_hash = ?'); params.push(await bcrypt.hash(password, 10));
    }
    if (!sets.length) {
      res.status(400).json({ ok: false, error: 'Nothing to update' });
      return;
    }
    params.push(id);
    try {
      await execute(`UPDATE portal_users SET ${sets.join(', ')} WHERE id = ?`, params);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update user' });
    }
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

  // ── Extra org memberships ──
  // A user's home org (portal_users.org_id) is implicit and cannot be granted or
  // revoked here — change it via PUT /users/:id. These rows are ADDITIONAL orgs the
  // user may switch into, with full write access. Internal staff don't need them:
  // they get read-only view-as on every org automatically.

  router.get('/users/:id/orgs', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Valid user ID is required' }); return; }
    try {
      const rows = await query<{ org_id: number; org_name: string; role: string | null; created_at: string }>(
        `SELECT puo.org_id, po.name AS org_name, puo.role, puo.created_at
         FROM portal_user_orgs puo
         JOIN portal_organisations po ON po.id = puo.org_id
         WHERE puo.portal_user_id = ?
         ORDER BY po.name`,
        [id],
      );
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list memberships' });
    }
  });

  router.post('/users/:id/orgs', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const orgId = parseInt(req.body?.org_id, 10);
    if (!id || !orgId) { res.status(400).json({ ok: false, error: 'User ID and org_id are required' }); return; }

    const user = await queryOne<{ id: number; org_id: number }>(`SELECT id, org_id FROM portal_users WHERE id = ?`, [id]);
    if (!user) { res.status(404).json({ ok: false, error: 'Portal user not found' }); return; }
    if (user.org_id === orgId) {
      res.status(400).json({ ok: false, error: 'That is already the user\'s home organisation' });
      return;
    }
    const org = await queryOne<{ id: number }>(`SELECT id FROM portal_organisations WHERE id = ?`, [orgId]);
    if (!org) { res.status(404).json({ ok: false, error: 'Organisation not found' }); return; }

    try {
      // Role is optional — NULL means "same role as in their home org". Upsert so
      // this endpoint both adds a membership and changes its role.
      const role = typeof req.body?.role === 'string' && req.body.role ? normalisePortalRole(req.body.role) : null;
      await execute(
        `IF EXISTS (SELECT 1 FROM portal_user_orgs WHERE portal_user_id = ? AND org_id = ?)
           UPDATE portal_user_orgs SET role = ? WHERE portal_user_id = ? AND org_id = ?;
         ELSE
           INSERT INTO portal_user_orgs (portal_user_id, org_id, role) VALUES (?, ?, ?);`,
        [id, orgId, role, id, orgId, id, orgId, role],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to add membership' });
    }
  });

  router.delete('/users/:id/orgs/:orgId', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const orgId = parseInt(req.params.orgId as string, 10);
    if (!id || !orgId) { res.status(400).json({ ok: false, error: 'Valid user ID and org ID are required' }); return; }
    try {
      await execute(`DELETE FROM portal_user_orgs WHERE portal_user_id = ? AND org_id = ?`, [id, orgId]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to remove membership' });
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
        bc_account_number: string | null;
        scope_reporters: string | null;
        feat_get_help: number;
        feat_kb: number;
        feat_support: number;
        feat_onboarding: number;
        feat_raise_ticket: number;
        support_routes: string | null;
        brand_website_url: string | null;
        brand_logo_url: string | null;
        brand_primary: string | null;
        brand_secondary: string | null;
        brand_font: string | null;
        support_cc_email: string | null;
        guild_onboarding_enabled: number;
        guild_digest_enabled: number;
        guild_ints_escalations_enabled: number;
        user_count: number;
        ticket_count: number;
      }>(
        `SELECT po.id, po.name, po.domain, po.external_id, po.bc_account_number, po.scope_reporters,
                po.feat_get_help, po.feat_kb, po.feat_support, po.feat_onboarding, po.feat_raise_ticket, po.support_routes,
                po.brand_website_url, po.brand_logo_url, po.brand_primary, po.brand_secondary, po.brand_font, po.support_cc_email,
                po.guild_onboarding_enabled, po.guild_digest_enabled, po.guild_ints_escalations_enabled,
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

  // Create a new organisation directly (name required, domain optional).
  router.post('/organisations', async (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim().toLowerCase() : '';
    if (!name) { res.status(400).json({ ok: false, error: 'Organisation name is required' }); return; }
    try {
      if (domain) {
        const existing = await queryOne<{ id: number }>(
          `SELECT TOP 1 id FROM portal_organisations WHERE LOWER(domain) = LOWER(?)`,
          [domain],
        );
        if (existing) { res.status(409).json({ ok: false, error: `An organisation already uses domain ${domain}` }); return; }
      }
      const result = await queryOne<{ id: number }>(
        `INSERT INTO portal_organisations (external_id, name, domain)
         OUTPUT INSERTED.id VALUES (?, ?, ?)`,
        [`local-org-${crypto.randomUUID()}`, name, domain || null],
      );
      res.json({ ok: true, data: { id: result!.id } });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create organisation' });
    }
  });

  // Preview what deleting an org would remove — the users homed here (hard
  // deleted, flagged if they also belong to other orgs) and the count of users
  // merely a member here (who just lose this one membership).
  router.get('/organisations/:id/deletion-impact', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Valid organisation ID is required' }); return; }
    try {
      const org = await queryOne<{ name: string }>(`SELECT name FROM portal_organisations WHERE id = ?`, [id]);
      if (!org) { res.status(404).json({ ok: false, error: 'Organisation not found' }); return; }

      const homeUsers = await query<{
        id: number; email: string; display_name: string; role: string; auth_type: string; other_memberships: number;
      }>(
        `SELECT pu.id, pu.email, pu.display_name, pu.role, pu.auth_type,
                (SELECT COUNT(*) FROM portal_user_orgs puo WHERE puo.portal_user_id = pu.id) AS other_memberships
         FROM portal_users pu
         WHERE pu.org_id = ?
         ORDER BY pu.display_name`,
        [id],
      );
      const memberOnly = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM portal_user_orgs WHERE org_id = ?`,
        [id],
      );
      res.json({ ok: true, data: { orgName: org.name, homeUsers, memberOnlyCount: memberOnly?.n ?? 0 } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load deletion impact' });
    }
  });

  // Delete an organisation. Without force, blocked while it still has portal
  // users (home or additional membership) so a real customer can't be wiped by a
  // mis-click. With ?force=1 it cascades: the org's users and all their portal
  // data (chat, submissions, memberships, CSAT links) are removed too.
  router.delete('/organisations/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Valid organisation ID is required' }); return; }
    const force = req.query.force === '1' || req.query.force === 'true';

    try {
      const org = await queryOne<{ id: number; name: string }>(
        `SELECT id, name FROM portal_organisations WHERE id = ?`,
        [id],
      );
      if (!org) { res.status(404).json({ ok: false, error: 'Organisation not found' }); return; }

      const home = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM portal_users WHERE org_id = ?`,
        [id],
      );
      const members = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM portal_user_orgs WHERE org_id = ?`,
        [id],
      );
      const homeUsers = home?.n ?? 0;
      const memberUsers = members?.n ?? 0;

      if ((homeUsers > 0 || memberUsers > 0) && !force) {
        res.status(409).json({
          ok: false,
          error: `${org.name} has ${homeUsers} user(s) and ${memberUsers} additional membership(s).`,
          data: { needsForce: true, homeUsers, memberUsers },
        });
        return;
      }

      if (force) {
        // Clear everything hanging off this org's home users, then the users,
        // then the org's own dependent rows. Order respects the FK graph.
        await execute(
          `DELETE m FROM portal_chat_messages m
             INNER JOIN portal_chat_sessions s ON s.id = m.session_id
             INNER JOIN portal_users u ON u.id = s.portal_user_id
           WHERE u.org_id = ?`, [id]);
        await execute(
          `DELETE s FROM portal_chat_sessions s
             INNER JOIN portal_users u ON u.id = s.portal_user_id
           WHERE u.org_id = ?`, [id]);
        await execute(
          `DELETE fs FROM portal_form_submissions fs
             INNER JOIN portal_users u ON u.id = fs.portal_user_id
           WHERE u.org_id = ?`, [id]);
        await execute(
          `UPDATE cs SET portal_user_id = NULL FROM portal_csat_surveys cs
             INNER JOIN portal_users u ON u.id = cs.portal_user_id
           WHERE u.org_id = ?`, [id]);
        await execute(
          `DELETE puo FROM portal_user_orgs puo
             INNER JOIN portal_users u ON u.id = puo.portal_user_id
           WHERE u.org_id = ?`, [id]);
        await execute(`DELETE FROM portal_users WHERE org_id = ?`, [id]);
      }

      // Memberships that point INTO this org (from users homed elsewhere), then
      // the mapping row, then the org.
      await execute(`DELETE FROM portal_user_orgs WHERE org_id = ?`, [id]);
      await execute(`DELETE FROM portal_org_jira_mapping WHERE org_id = ?`, [id]);
      await execute(`DELETE FROM portal_organisations WHERE id = ?`, [id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to delete organisation' });
    }
  });

  // Org → Jira mapping
  router.get('/org-mapping', async (_req: Request, res: Response) => {
    try {
      // Left join from organisations so orgs without a mapping row still appear
      // (bc_account_number lives on portal_organisations).
      const mappings = await query(
        `SELECT po.id AS org_id, po.name AS org_name, po.bc_account_number,
                m.jira_organisation_id, m.jira_email_domain
         FROM portal_organisations po
         LEFT JOIN portal_org_jira_mapping m ON m.org_id = po.id
         ORDER BY po.name`,
      );
      res.json({ ok: true, data: mappings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list mappings' });
    }
  });

  // Auto-suggest branding from an org's website (admin reviews/edits before save).
  router.post('/branding/fetch', async (req: Request, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) { res.status(400).json({ ok: false, error: 'A website URL is required' }); return; }
    try {
      const branding = await fetchOrgBranding(url, llm);
      res.json({ ok: true, data: branding });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch branding' });
    }
  });

  router.put('/org-mapping/:orgId', async (req: Request, res: Response) => {
    const orgId = parseInt(req.params.orgId as string, 10);
    const { jira_organisation_id, jira_email_domain, bc_account_number, scope_reporters, features, branding, support_routes, support_cc_email, guild } = req.body;
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
      // BC Account Number + reporter list are the customer key for the
      // Onboarding/Support dashboards (BC Account OR any listed reporter).
      if (bc_account_number !== undefined) {
        await execute(
          `UPDATE portal_organisations SET bc_account_number = ?, updated_at = GETUTCDATE() WHERE id = ?`,
          [bc_account_number ? String(bc_account_number).trim() : null, orgId],
        );
      }
      if (scope_reporters !== undefined) {
        await execute(
          `UPDATE portal_organisations SET scope_reporters = ?, updated_at = GETUTCDATE() WHERE id = ?`,
          [scope_reporters ? String(scope_reporters).trim() : null, orgId],
        );
      }
      // Per-org feature toggles
      if (features && typeof features === 'object') {
        const bit = (v: unknown) => (v ? 1 : 0);
        await execute(
          `UPDATE portal_organisations
           SET feat_get_help = ?, feat_kb = ?, feat_support = ?, feat_onboarding = ?, feat_raise_ticket = ?, updated_at = GETUTCDATE()
           WHERE id = ?`,
          [bit(features.getHelp), bit(features.kb), bit(features.support), bit(features.onboarding), bit(features.raiseTicket), orgId],
        );
      }
      // Which Raise-a-Ticket routes this org offers. Normalise via the shared
      // parser (dedupe/order/validate) then store as CSV; null → default pair.
      if (support_routes !== undefined) {
        const raw = Array.isArray(support_routes) ? support_routes.join(',') : String(support_routes ?? '');
        const routes = parseSupportRoutes(raw);
        await execute(
          `UPDATE portal_organisations SET support_routes = ?, updated_at = GETUTCDATE() WHERE id = ?`,
          [routes.join(','), orgId],
        );
      }
      // Guild onboarding per-org enable toggles (backlog #8, level 2 — set by
      // the portal admin). Each org is switched on individually.
      if (guild && typeof guild === 'object') {
        const bit = (v: unknown) => (v ? 1 : 0);
        await execute(
          `UPDATE portal_organisations
           SET guild_onboarding_enabled = ?, guild_digest_enabled = ?, guild_ints_escalations_enabled = ?, updated_at = GETUTCDATE()
           WHERE id = ?`,
          [bit(guild.onboarding), bit(guild.digest), bit(guild.intsEscalations), orgId],
        );
      }
      // Shared CC address(es) copied on every raised ticket for this org.
      if (support_cc_email !== undefined) {
        await execute(
          `UPDATE portal_organisations SET support_cc_email = ?, updated_at = GETUTCDATE() WHERE id = ?`,
          [support_cc_email ? String(support_cc_email).trim() : null, orgId],
        );
      }
      // Per-org branding
      if (branding && typeof branding === 'object') {
        const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        await execute(
          `UPDATE portal_organisations
           SET brand_website_url = ?, brand_logo_url = ?, brand_primary = ?, brand_secondary = ?, brand_font = ?, updated_at = GETUTCDATE()
           WHERE id = ?`,
          [s(branding.websiteUrl), s(branding.logoUrl), s(branding.primary), s(branding.secondary), s(branding.font), orgId],
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

  // Guild onboarding GLOBAL config (backlog #8, level 1) — Jira wiring + optional
  // keys shared across all orgs. Keeps the existing (orchestrator-shared) key
  // names, so it can't reuse the portal_-prefixed /settings endpoint.
  // Each key falls back to the pre-existing onboarding-orchestrator setting, so
  // the card shows what's ALREADY configured rather than blank (matches the
  // resolution order in guild-onboarding.ts / onboarding-orchestrator.ts).
  const GUILD_GLOBAL_KEYS: Array<{ key: string; fallback?: string }> = [
    { key: 'jira_ob_project', fallback: 'jira_onboarding_project' },
    { key: 'jira_ob_issue_type', fallback: 'jira_onboarding_issue_type' },
    { key: 'jira_ob_link_type', fallback: 'jira_link_type_name' },
    { key: 'jira_ob_request_type_field', fallback: 'jira_request_type_field' },
    { key: 'jira_ob_rt_qa_id', fallback: 'jira_rt_delivery_qa_id' },
    { key: 'jira_ob_rt_onboarding_id', fallback: 'jira_rt_onboarding_id' },
    { key: 'app_base_url' },
    { key: 'guild_ob_parent_label' },
  ];
  router.get('/onboarding-global-config', (_req: Request, res: Response) => {
    const out: Record<string, string> = {};
    for (const { key, fallback } of GUILD_GLOBAL_KEYS) {
      out[key] = settings.get(key) || (fallback ? settings.get(fallback) : '') || '';
    }
    res.json({ ok: true, data: out });
  });
  router.put('/onboarding-global-config', (req: Request, res: Response) => {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') { res.status(400).json({ ok: false, error: 'Body must be an object' }); return; }
    try {
      const allowed = new Set(GUILD_GLOBAL_KEYS.map(k => k.key));
      for (const [key, value] of Object.entries(updates)) {
        if (allowed.has(key)) settings.set(key, String(value ?? ''));
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to save' });
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
