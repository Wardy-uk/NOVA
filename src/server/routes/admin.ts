import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { TeamQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { FileUserQueries } from '../db/user-store.js';
type UserQueries = FileUserQueries;
import { requireRole } from '../middleware/auth.js';

export function createAdminRoutes(
  userQueries: UserQueries,
  teamQueries: TeamQueries,
  userSettingsQueries: UserSettingsQueries,
  settingsQueries: SettingsQueries,
): Router {
  const router = Router();
  router.use(requireRole('admin'));

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
