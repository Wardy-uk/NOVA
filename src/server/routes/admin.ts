import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { TeamQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { UserQueries } from '../db/queries.js';
import { requireRole } from '../middleware/auth.js';
import { parseRoles, isAdmin } from '../utils/role-helpers.js';
import { EmailService } from '../services/email.js';
import { inviteHtml } from '../services/email-templates.js';
import type { JiraRestClient } from '../services/jira-client.js';

function generateTempPassword(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export function createAdminRoutes(
  userQueries: UserQueries,
  teamQueries: TeamQueries,
  userSettingsQueries: UserSettingsQueries,
  settingsQueries: SettingsQueries,
  getJiraClient: () => JiraRestClient | null,
): Router {
  const router = Router();
  router.use(requireRole('admin', 'super_admin'));

  const emailService = new EmailService(() => settingsQueries.getAll());

  /** Get valid role IDs — built-in roles always valid, plus any custom roles */
  function getValidRoleIds(): string[] {
    const builtIn = ['super_admin', 'admin', 'editor', 'viewer'];
    const rawRoles = settingsQueries.get('custom_roles');
    let customRoleIds: string[] = [];
    try {
      if (rawRoles) customRoleIds = (JSON.parse(rawRoles) as Array<{ id: string }>).map(r => r.id);
    } catch { /* ignore */ }
    return [...new Set([...builtIn, ...customRoleIds])];
  }

  /** Send an email via SMTP */
  async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!emailService.isConfigured()) {
      throw new Error('Email not configured. Set up Email in Admin > Integrations.');
    }
    await emailService.send({ to, subject, text, html });
  }

  // ---- Users ----

  router.get('/users', async (_req, res) => {
    const users = await userQueries.getAll();
    const teams = await teamQueries.getAll();
    res.json({ ok: true, data: { users, teams } });
  });

  router.post('/users', async (req, res) => {
    const { username, password, display_name, email, role } = req.body;
    if (!username?.trim()) {
      res.status(400).json({ ok: false, error: 'Username is required' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      return;
    }
    const allValidRoles = getValidRoleIds();
    const requested = role ? parseRoles(role) : [];
    const invalid = requested.filter(r => !allValidRoles.includes(r));
    if (invalid.length > 0) {
      res.status(400).json({ ok: false, error: `Invalid role(s): ${invalid.join(', ')}` });
      return;
    }
    const assignedRole = requested.length > 0 ? requested.join(',') : (allValidRoles.includes('viewer') ? 'viewer' : allValidRoles[1] || 'viewer');
    const normalizedUsername = username.trim().toLowerCase();
    if (await userQueries.getByUsername(normalizedUsername)) {
      res.status(409).json({ ok: false, error: 'Username already taken' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const id = await userQueries.create({
      username: normalizedUsername,
      display_name: display_name?.trim() || normalizedUsername,
      email: email?.trim() || undefined,
      password_hash: hash,
      role: assignedRole,
    });
    res.json({ ok: true, data: { id } });
  });

  router.put('/users/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Invalid user ID' }); return; }

    const user = await userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

    const { display_name, email, role, team_id } = req.body;
    const updates: Record<string, unknown> = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) {
      // Validate each role in comma-separated list
      const validRoles = getValidRoleIds();
      const requested = parseRoles(role);
      if (requested.length === 0) {
        res.status(400).json({ ok: false, error: 'At least one role is required' });
        return;
      }
      const invalid = requested.filter(r => !validRoles.includes(r));
      if (invalid.length > 0) {
        res.status(400).json({ ok: false, error: `Invalid role(s): ${invalid.join(', ')}. Valid: ${validRoles.join(', ')}` });
        return;
      }
      // Prevent removing the last admin/super_admin
      if (isAdmin(user.role) && !requested.includes('admin') && !requested.includes('super_admin')) {
        const allUsers = await userQueries.getAll();
        const adminCount = allUsers.filter((u) => isAdmin(u.role)).length;
        if (adminCount <= 1) {
          res.status(400).json({ ok: false, error: 'Cannot remove the last admin' });
          return;
        }
      }
      updates.role = requested.join(',');
    }
    if (team_id !== undefined) updates.team_id = team_id;

    await userQueries.update(id, updates);
    res.json({ ok: true });
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password || password.length < 6) {
      res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      return;
    }
    const user = await userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

    const hash = await bcrypt.hash(password, 10);
    await userQueries.update(id, { password_hash: hash });
    res.json({ ok: true });
  });

  router.delete('/users/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Invalid user ID' }); return; }

    // Prevent self-deletion
    if (req.user!.id === id) {
      res.status(400).json({ ok: false, error: 'Cannot delete your own account' });
      return;
    }

    const user = await userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

    // Prevent removing the last admin
    if (isAdmin(user.role)) {
      const allUsers = await userQueries.getAll();
      const adminCount = allUsers.filter((u) => isAdmin(u.role)).length;
      if (adminCount <= 1) {
        res.status(400).json({ ok: false, error: 'Cannot delete the last admin' });
        return;
      }
    }

    await userQueries.delete(id);
    res.json({ ok: true });
  });

  // ---- Invite ----

  /** Send invite email to an existing user via SMTP or MCP fallback */
  router.post('/users/:id/invite', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const user = await userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }
    if (!user.email) { res.status(400).json({ ok: false, error: 'User has no email address' }); return; }

    const ssoEnabled = settingsQueries.get('sso_enabled') === 'true';
    const frontendUrl = (process.env.FRONTEND_URL || `https://${req.headers.host}`).replace(/\/+$/, '');

    const displayName = user.display_name || user.username;
    const text = `Hi ${displayName},\n\nYou've been invited to N.O.V.A.\n\nUsername: ${user.username}\nSign in at: ${frontendUrl}\n\nRegards,\nN.O.V.A`;
    const html = inviteHtml({
      name: displayName,
      username: user.username,
      loginUrl: frontendUrl,
      ssoEnabled,
    });

    try {
      console.log(`[Admin] Sending invite to ${user.email} (smtp: ${emailService.isConfigured()})`);
      await sendEmail(user.email, "You've been invited to N.O.V.A", text, html);
      console.log(`[Admin] Invite sent to ${user.email}`);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[Admin] Invite failed for ${user.email}:`, err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send invite' });
    }
  });

  /** Send a test email */
  router.post('/email/test', async (req, res) => {
    const { to } = req.body;
    if (!to?.trim()) { res.status(400).json({ ok: false, error: 'to address required' }); return; }
    const result = await emailService.sendTest(to.trim());
    res.json(result);
  });

  // ---- Bulk import ----

  /** Bulk-create users from a JSON array */
  router.post('/users/bulk', async (req, res) => {
    const { users: incoming, sendInvites } = req.body as {
      users: Array<{ username: string; display_name?: string; email?: string; role?: string }>;
      sendInvites?: boolean;
    };

    if (!Array.isArray(incoming) || incoming.length === 0) {
      res.status(400).json({ ok: false, error: 'users array is required' });
      return;
    }

    // Resolve valid roles
    const allValidRoles = getValidRoleIds();
    const defaultRole = allValidRoles.includes('viewer') ? 'viewer' : allValidRoles[1] || 'viewer';

    const ssoEnabled = settingsQueries.get('sso_enabled') === 'true';
    const frontendUrl = (process.env.FRONTEND_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
    let created = 0;
    let invited = 0;
    const skipped: string[] = [];

    for (const entry of incoming) {
      if (!entry.username?.trim()) { skipped.push('(empty username)'); continue; }
      const normalizedUsername = entry.username.trim().toLowerCase();

      if (await userQueries.getByUsername(normalizedUsername)) {
        skipped.push(normalizedUsername);
        continue;
      }

      const tempPassword = generateTempPassword();
      // Validate each role in comma-separated list
      let role = defaultRole;
      if (entry.role) {
        const entryRoles = parseRoles(entry.role);
        const allValid = entryRoles.length > 0 && entryRoles.every((r: string) => allValidRoles.includes(r));
        role = allValid ? entryRoles.join(',') : defaultRole;
      }
      const hash = await bcrypt.hash(tempPassword, 10);

      await userQueries.create({
        username: normalizedUsername,
        display_name: entry.display_name?.trim() || normalizedUsername,
        email: entry.email?.trim() || undefined,
        password_hash: hash,
        role,
      });
      created++;

      // Send invite email if requested
      if (sendInvites && entry.email?.trim()) {
        try {
          const displayName = entry.display_name?.trim() || normalizedUsername;
          const text = `Hi ${displayName},\n\nYou've been invited to N.O.V.A.\n\nUsername: ${normalizedUsername}\nTemporary password: ${tempPassword}\nSign in at: ${frontendUrl}\n\nPlease change your password after your first login.\n\nRegards,\nN.O.V.A`;
          const html = inviteHtml({
            name: displayName,
            username: normalizedUsername,
            tempPassword,
            loginUrl: frontendUrl,
            ssoEnabled,
          });

          await sendEmail(entry.email.trim(), "You've been invited to N.O.V.A", text, html);
          invited++;
        } catch (err) {
          console.error(`[Admin] Failed to send invite to ${entry.email}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    res.json({ ok: true, data: { created, skipped, invited } });
  });

  /*
  // ---- Debug / config inspection (admin only) ----
  //
  // COMMENTED OUT 2026-04-15 — replaced by nova-mcp tools
  // (nova_admin_get_config / nova_admin_set_setting) which read the
  // settings.json file directly. Leaving this block as reference in
  // case we later want an HTTP-facing equivalent for the browser UI.
  //
  // Full masked dump of settings.json plus live Jira identity, teams,
  // users (counts only), and custom roles. Used to diagnose config
  // issues without exposing secrets. Every key whose name contains
  // 'token', 'password', 'secret', 'apikey', etc. is masked. Every
  // email-looking value is partially masked. Everything else is passed
  // through verbatim.
  router.get('/debug/config', async (req, res) => {
    try {
      const s = settingsQueries.getAll();

      // ── Mask helpers ─────────────────────────────────────────────────
      const maskEmail = (email: string | undefined | null): string => {
        if (!email) return '(unset)';
        const [local, domain] = email.split('@');
        if (!domain || !local) return email;
        const masked = local.length <= 3
          ? `${local[0]}***`
          : `${local.slice(0, 2)}***${local.slice(-1)}`;
        return `${masked}@${domain}`;
      };
      const maskToken = (tok: string | undefined | null): string => {
        if (tok == null || tok === '') return '(unset)';
        if (typeof tok !== 'string') return `(non-string: ${typeof tok})`;
        if (tok.length < 12) return '(too short)';
        return `${tok.slice(0, 4)}…${tok.slice(-4)} (len ${tok.length})`;
      };
      const SECRET_KEY_PATTERN = /token|password|secret|apikey|api_key|client_secret|pass$|pass_|_pass/i;
      const EMAIL_KEY_PATTERN = /email|username|user$|_user/i;
      const maskValue = (key: string, val: unknown): unknown => {
        if (val == null || val === '') return '(unset)';
        if (typeof val !== 'string') return val;
        if (SECRET_KEY_PATTERN.test(key)) return maskToken(val);
        if (EMAIL_KEY_PATTERN.test(key) && val.includes('@')) return maskEmail(val);
        return val;
      };

      // ── Full masked dump of settings.json ────────────────────────────
      const maskedSettings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s)) {
        maskedSettings[k] = maskValue(k, v);
      }

      // ── Live Jira identity — calls GET /myself on the service desk
      //    client so we see exactly which account is used for writes.
      //    The answer to "is a service account configured?" lives here.
      let liveJiraIdentity: Record<string, unknown> | { error: string } = { error: 'client not built' };
      try {
        const client = getJiraClient();
        if (client) {
          const myself = await (client as unknown as { request: (m: string, p: string) => Promise<unknown> })
            .request('GET', 'myself');
          const me = myself as {
            accountId?: string; emailAddress?: string; displayName?: string;
            accountType?: string; active?: boolean; timeZone?: string;
          };
          liveJiraIdentity = {
            accountId: me.accountId,
            emailAddress: me.emailAddress,
            displayName: me.displayName,
            accountType: me.accountType,
            active: me.active,
            timeZone: me.timeZone,
          };
        } else {
          liveJiraIdentity = { error: 'buildServiceDeskJiraClient returned null' };
        }
      } catch (err) {
        liveJiraIdentity = { error: err instanceof Error ? err.message : 'myself call failed' };
      }

      // ── Teams, users, custom roles ───────────────────────────────────
      const teams = teamQueries.getAll().map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        member_count: userQueries.getAll().filter((u) => u.team_id === t.id).length,
        jira_products: t.jira_products || [],
      }));

      const users = userQueries.getAll();
      const usersByRole: Record<string, number> = {};
      for (const u of users) {
        const r = u.role || '(none)';
        usersByRole[r] = (usersByRole[r] || 0) + 1;
      }
      const usersSummary = {
        total: users.length,
        byRole: usersByRole,
        list: users.map((u) => ({
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          email: maskEmail(u.email),
          role: u.role,
          team_id: u.team_id,
          auth_provider: (u as unknown as { auth_provider?: string }).auth_provider,
        })),
      };

      let customRoles: unknown = null;
      try {
        const raw = s.custom_roles;
        customRoles = raw ? JSON.parse(raw) : [];
      } catch {
        customRoles = '(parse failed)';
      }

      let rolePermissions: unknown = null;
      try {
        const raw = s.role_permissions;
        rolePermissions = raw ? JSON.parse(raw) : {};
      } catch {
        rolePermissions = '(parse failed)';
      }

      // ── Caller info ─────────────────────────────────────────────────
      const caller = {
        id: req.user?.id,
        username: req.user?.username,
        role: req.user?.role,
      };

      res.json({
        ok: true,
        data: {
          caller,
          liveJiraIdentity,
          teams,
          users: usersSummary,
          customRoles,
          rolePermissions,
          settings: maskedSettings,
          meta: {
            settingKeyCount: Object.keys(maskedSettings).length,
            note: 'liveJiraIdentity is the Jira account actually used by buildServiceDeskJiraClient for all Dev Review writes. If it shows a real human, NOVA is writing as that human — not a service account.',
          },
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'debug failed' });
    }
  });
  */

  // ---- Teams ----

  router.get('/teams', async (_req, res) => {
    res.json({ ok: true, data: await teamQueries.getAll() });
  });

  router.post('/teams', async (req, res) => {
    const { name, description } = req.body;
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'Team name is required' }); return; }
    const id = await teamQueries.create(name.trim(), description?.trim());
    res.json({ ok: true, data: { id } });
  });

  router.put('/teams/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, description, jira_products, jira_project_key } = req.body;
    const updates: { name?: string; description?: string; jira_products?: string[] | null; jira_project_key?: string | null } = {};
    if (name !== undefined) updates.name = name?.trim();
    if (description !== undefined) updates.description = description?.trim();
    if (jira_products !== undefined) {
      updates.jira_products = Array.isArray(jira_products)
        ? jira_products.filter((p) => typeof p === 'string')
        : null;
    }
    if (jira_project_key !== undefined) updates.jira_project_key = jira_project_key?.trim() || null;
    await teamQueries.update(id, updates);
    res.json({ ok: true });
  });

  router.delete('/teams/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await teamQueries.delete(id);
    res.json({ ok: true });
  });

  // ── Nurtur Product field options (cached, for the Dev Review team picker) ──
  // Fetches allowed values for customfield_13183 from Jira at most once per
  // hour. Collapses all 'The Property Jungle' variants into a single 'TPJ'
  // entry to match productToTeam(). Clients should gracefully fall back to
  // a bundled default list if this endpoint fails.
  const PRODUCT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  let productCache: { products: string[]; fetchedAt: number } | null = null;

  router.get('/nurtur-products', async (req, res) => {
    try {
      const force = req.query.refresh === '1';
      const fresh = productCache && !force && (Date.now() - productCache.fetchedAt) < PRODUCT_CACHE_TTL_MS;
      if (fresh && productCache) {
        res.json({ ok: true, data: productCache.products, cached: true, fetchedAt: productCache.fetchedAt });
        return;
      }
      const client = getJiraClient();
      if (!client) {
        res.status(503).json({ ok: false, error: 'Jira not configured' });
        return;
      }
      const raw = await client.getFieldOptions('customfield_13183');
      const values = raw.map((o) => o.value).filter((v): v is string => !!v);
      // Collapse TPJ variants
      const hasTpj = values.some((v) => v.startsWith('The Property Jungle'));
      const collapsed = values.filter((v) => !v.startsWith('The Property Jungle'));
      if (hasTpj) collapsed.push('TPJ');
      // Deduplicate + sort
      const deduped = Array.from(new Set(collapsed)).sort((a, b) => a.localeCompare(b));
      productCache = { products: deduped, fetchedAt: Date.now() };
      res.json({ ok: true, data: deduped, cached: false, fetchedAt: productCache.fetchedAt });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : 'Product fetch failed' });
    }
  });

  // ---- AI Keys ----

  router.get('/ai-keys', (req, res) => {
    const globalKey = settingsQueries.get('openai_api_key') ?? '';
    // Mask all but last 4 chars
    const masked = globalKey.length > 4 ? '•'.repeat(globalKey.length - 4) + globalKey.slice(-4) : globalKey;
    res.json({ ok: true, data: { globalKey: masked, hasGlobalKey: globalKey.length > 0 } });
  });

  router.put('/ai-keys/global', (req, res) => {
    const { key } = req.body;
    if (!key?.trim()) { res.status(400).json({ ok: false, error: 'API key is required' }); return; }
    settingsQueries.set('openai_api_key', key.trim());
    res.json({ ok: true });
  });

  // Per-user AI key override
  router.get('/ai-keys/user/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const userKey = (await userSettingsQueries.get(userId, 'openai_api_key')) ?? '';
    const masked = userKey.length > 4 ? '•'.repeat(userKey.length - 4) + userKey.slice(-4) : userKey;
    res.json({ ok: true, data: { key: masked, hasKey: userKey.length > 0 } });
  });

  router.put('/ai-keys/user/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const { key } = req.body;
    if (key?.trim()) {
      await userSettingsQueries.set(userId, 'openai_api_key', key.trim());
    } else {
      await userSettingsQueries.delete(userId, 'openai_api_key');
    }
    res.json({ ok: true });
  });

  // ---- Custom Roles ----

  router.get('/roles', (_req, res) => {
    const raw = settingsQueries.get('custom_roles');
    let roles: Array<{ id: string; name: string; areas: Record<string, string> }> = [];
    try {
      if (raw) roles = JSON.parse(raw);
    } catch { /* ignore */ }
    res.json({ ok: true, data: { roles } });
  });

  router.put('/roles', (req, res) => {
    const { roles } = req.body;
    if (!Array.isArray(roles)) {
      res.status(400).json({ ok: false, error: 'roles must be an array' });
      return;
    }

    const validAccess = ['hidden', 'view', 'edit'];
    const ids = new Set<string>();

    for (const role of roles) {
      if (!role.id || typeof role.id !== 'string' || !role.name || typeof role.name !== 'string') {
        res.status(400).json({ ok: false, error: 'Each role must have id and name' });
        return;
      }
      if (role.id === 'admin') {
        res.status(400).json({ ok: false, error: 'Cannot define a custom role with id "admin"' });
        return;
      }
      if (role.id.includes(',')) {
        res.status(400).json({ ok: false, error: 'Role id cannot contain commas' });
        return;
      }
      if (ids.has(role.id)) {
        res.status(400).json({ ok: false, error: `Duplicate role id: ${role.id}` });
        return;
      }
      ids.add(role.id);

      if (!role.areas || typeof role.areas !== 'object') {
        res.status(400).json({ ok: false, error: `Role "${role.name}" must have areas object` });
        return;
      }
      for (const [area, access] of Object.entries(role.areas)) {
        if (!validAccess.includes(access as string)) {
          res.status(400).json({ ok: false, error: `Invalid access "${access}" for area "${area}" in role "${role.name}"` });
          return;
        }
      }
    }

    settingsQueries.set('custom_roles', JSON.stringify(roles));
    res.json({ ok: true });
  });

  // Update user role validation to accept custom role IDs
  router.get('/valid-roles', (_req, res) => {
    const raw = settingsQueries.get('custom_roles');
    let customRoles: Array<{ id: string; name: string }> = [];
    try {
      if (raw) customRoles = JSON.parse(raw);
    } catch { /* ignore */ }
    const validRoles = ['admin', ...customRoles.map(r => r.id)];
    res.json({ ok: true, data: { roles: validRoles, customRoles } });
  });

  return router;
}
