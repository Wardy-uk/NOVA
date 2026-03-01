import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { TeamQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { FileUserQueries } from '../db/user-store.js';
type UserQueries = FileUserQueries;
import { requireRole } from '../middleware/auth.js';
import { EmailService } from '../services/email.js';

function generateTempPassword(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export function createAdminRoutes(
  userQueries: UserQueries,
  teamQueries: TeamQueries,
  userSettingsQueries: UserSettingsQueries,
  settingsQueries: SettingsQueries,
): Router {
  const router = Router();
  router.use(requireRole('admin'));

  const emailService = new EmailService(() => settingsQueries.getAll());

  /** Send an email via SMTP */
  async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!emailService.isConfigured()) {
      throw new Error('Email not configured. Set up Email in Admin > Integrations.');
    }
    await emailService.send({ to, subject, text, html });
  }

  /** Build branded HTML email */
  function buildInviteHtml(opts: {
    name: string;
    username: string;
    tempPassword?: string;
    loginUrl: string;
    ssoEnabled: boolean;
  }): string {
    const { name, username, tempPassword, loginUrl, ssoEnabled } = opts;
    const credentialsRow = tempPassword
      ? `<tr>
           <td style="padding:4px 0;color:#a0a0a0;font-size:13px;width:140px">Temporary password</td>
           <td style="padding:4px 0;color:#e5e5e5;font-size:13px;font-family:monospace">${tempPassword}</td>
         </tr>`
      : '';
    const ssoNote = ssoEnabled
      ? '<p style="margin:0 0 16px;color:#a0a0a0;font-size:13px">You can also click <strong style="color:#e5e5e5">Sign in with Microsoft</strong> on the login page.</p>'
      : '';
    const passwordNote = tempPassword
      ? '<p style="margin:0 0 16px;color:#a0a0a0;font-size:13px">Please change your password after your first login.</p>'
      : '';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#1e2228;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e2228;padding:40px 16px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%">
  <!-- Header -->
  <tr><td style="padding:0 0 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;letter-spacing:1px;color:#5ec1ca">N.O.V.A</span>
    <br><span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:2px">Nurtur Operational Virtual Assistant</span>
  </td></tr>
  <!-- Card -->
  <tr><td style="background-color:#2f353d;border:1px solid #3a424d;border-radius:12px;padding:32px">
    <p style="margin:0 0 20px;color:#e5e5e5;font-size:15px">Hi ${name},</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">You've been invited to <strong style="color:#e5e5e5">N.O.V.A</strong>. Here are your login details:</p>
    <!-- Credentials table -->
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#272C33;border:1px solid #3a424d;border-radius:8px;padding:12px 16px;width:100%">
      <tr>
        <td style="padding:4px 0;color:#a0a0a0;font-size:13px;width:140px">Username</td>
        <td style="padding:4px 0;color:#5ec1ca;font-size:13px;font-weight:600">${username}</td>
      </tr>
      ${credentialsRow}
    </table>
    ${passwordNote}${ssoNote}
    <!-- CTA button -->
    <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:4px 0 8px">
      <a href="${loginUrl}" style="display:inline-block;background-color:#5ec1ca;color:#272C33;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px">Sign In to N.O.V.A</a>
    </td></tr></table>
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:20px 0 0;text-align:center">
    <span style="font-size:11px;color:#4b5563">Nurtur Limited</span>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  }

  // ---- Users ----

  router.get('/users', (_req, res) => {
    const users = userQueries.getAll();
    const teams = teamQueries.getAll();
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
    const rawRoles = settingsQueries.get('custom_roles');
    let customRoleIds: string[] = [];
    try {
      if (rawRoles) customRoleIds = (JSON.parse(rawRoles) as Array<{ id: string }>).map(r => r.id);
    } catch { /* ignore */ }
    const allValidRoles = ['admin', ...customRoleIds];
    const assignedRole = role && allValidRoles.includes(role) ? role : (customRoleIds.includes('viewer') ? 'viewer' : customRoleIds[0] || 'viewer');
    const normalizedUsername = username.trim().toLowerCase();
    if (userQueries.getByUsername(normalizedUsername)) {
      res.status(409).json({ ok: false, error: 'Username already taken' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const id = userQueries.create({
      username: normalizedUsername,
      display_name: display_name?.trim() || normalizedUsername,
      email: email?.trim() || undefined,
      password_hash: hash,
      role: assignedRole,
    });
    res.json({ ok: true, data: { id } });
  });

  router.put('/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Invalid user ID' }); return; }

    const user = userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

    const { display_name, email, role, team_id } = req.body;
    const updates: Record<string, unknown> = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) {
      // Validate role: must be 'admin' or a custom role ID
      const rawRoles = settingsQueries.get('custom_roles');
      let customRoleIds: string[] = [];
      try {
        if (rawRoles) customRoleIds = (JSON.parse(rawRoles) as Array<{ id: string }>).map(r => r.id);
      } catch { /* ignore */ }
      const validRoles = ['admin', ...customRoleIds];
      if (!validRoles.includes(role)) {
        res.status(400).json({ ok: false, error: `Invalid role. Valid: ${validRoles.join(', ')}` });
        return;
      }
      // Prevent removing the last admin
      if (user.role === 'admin' && role !== 'admin') {
        const allUsers = userQueries.getAll();
        const adminCount = allUsers.filter((u) => u.role === 'admin').length;
        if (adminCount <= 1) {
          res.status(400).json({ ok: false, error: 'Cannot remove the last admin' });
          return;
        }
      }
      updates.role = role;
    }
    if (team_id !== undefined) updates.team_id = team_id;

    userQueries.update(id, updates);
    res.json({ ok: true });
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password || password.length < 6) {
      res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      return;
    }
    const user = userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

    const hash = await bcrypt.hash(password, 10);
    userQueries.update(id, { password_hash: hash });
    res.json({ ok: true });
  });

  router.delete('/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Invalid user ID' }); return; }

    // Prevent self-deletion
    if (req.user!.id === id) {
      res.status(400).json({ ok: false, error: 'Cannot delete your own account' });
      return;
    }

    const user = userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

    // Prevent removing the last admin
    if (user.role === 'admin') {
      const allUsers = userQueries.getAll();
      const adminCount = allUsers.filter((u) => u.role === 'admin').length;
      if (adminCount <= 1) {
        res.status(400).json({ ok: false, error: 'Cannot delete the last admin' });
        return;
      }
    }

    userQueries.delete(id);
    res.json({ ok: true });
  });

  // ---- Invite ----

  /** Send invite email to an existing user via SMTP or MCP fallback */
  router.post('/users/:id/invite', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const user = userQueries.getById(id);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }
    if (!user.email) { res.status(400).json({ ok: false, error: 'User has no email address' }); return; }

    const ssoEnabled = settingsQueries.get('sso_enabled') === 'true';
    const frontendUrl = (process.env.FRONTEND_URL || `https://${req.headers.host}`).replace(/\/+$/, '');

    const displayName = user.display_name || user.username;
    const text = `Hi ${displayName},\n\nYou've been invited to N.O.V.A.\n\nUsername: ${user.username}\nSign in at: ${frontendUrl}\n\nRegards,\nN.O.V.A`;
    const html = buildInviteHtml({
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
    const rawRoles = settingsQueries.get('custom_roles');
    let customRoleIds: string[] = [];
    try {
      if (rawRoles) customRoleIds = (JSON.parse(rawRoles) as Array<{ id: string }>).map(r => r.id);
    } catch { /* ignore */ }
    const allValidRoles = ['admin', ...customRoleIds];
    const defaultRole = customRoleIds.includes('viewer') ? 'viewer' : customRoleIds[0] || 'viewer';

    const ssoEnabled = settingsQueries.get('sso_enabled') === 'true';
    const frontendUrl = (process.env.FRONTEND_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
    let created = 0;
    let invited = 0;
    const skipped: string[] = [];

    for (const entry of incoming) {
      if (!entry.username?.trim()) { skipped.push('(empty username)'); continue; }
      const normalizedUsername = entry.username.trim().toLowerCase();

      if (userQueries.getByUsername(normalizedUsername)) {
        skipped.push(normalizedUsername);
        continue;
      }

      const tempPassword = generateTempPassword();
      const role = entry.role && allValidRoles.includes(entry.role) ? entry.role : defaultRole;
      const hash = await bcrypt.hash(tempPassword, 10);

      userQueries.create({
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
          const html = buildInviteHtml({
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

  // ---- Teams ----

  router.get('/teams', (_req, res) => {
    res.json({ ok: true, data: teamQueries.getAll() });
  });

  router.post('/teams', (req, res) => {
    const { name, description } = req.body;
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'Team name is required' }); return; }
    const id = teamQueries.create(name.trim(), description?.trim());
    res.json({ ok: true, data: { id } });
  });

  router.put('/teams/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, description } = req.body;
    teamQueries.update(id, { name: name?.trim(), description: description?.trim() });
    res.json({ ok: true });
  });

  router.delete('/teams/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    teamQueries.delete(id);
    res.json({ ok: true });
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
  router.get('/ai-keys/user/:userId', (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const userKey = userSettingsQueries.get(userId, 'openai_api_key') ?? '';
    const masked = userKey.length > 4 ? '•'.repeat(userKey.length - 4) + userKey.slice(-4) : userKey;
    res.json({ ok: true, data: { key: masked, hasKey: userKey.length > 0 } });
  });

  router.put('/ai-keys/user/:userId', (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const { key } = req.body;
    if (key?.trim()) {
      userSettingsQueries.set(userId, 'openai_api_key', key.trim());
    } else {
      userSettingsQueries.delete(userId, 'openai_api_key');
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
