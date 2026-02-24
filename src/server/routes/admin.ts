import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { UserQueries, TeamQueries, UserSettingsQueries, SettingsQueries } from '../db/queries.js';
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
      if (!['admin', 'editor', 'viewer'].includes(role)) {
        res.status(400).json({ ok: false, error: 'Role must be admin, editor, or viewer' });
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

  return router;
}
