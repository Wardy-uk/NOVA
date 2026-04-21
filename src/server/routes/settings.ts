import { Router } from 'express';
import { z } from 'zod';
import type { SettingsQueries } from '../db/settings-store.js';
import type { UserSettingsQueries } from '../db/queries.js';
import { requireRole } from '../middleware/auth.js';
import { isAdmin } from '../utils/role-helpers.js';

const SettingUpdateSchema = z.object({
  value: z.string(),
});

// Keys that should NEVER be exposed to non-admin users
const SENSITIVE_KEYS = new Set([
  'jwt_secret',
  'jira_token', 'jira_ob_token',
  'openai_api_key',
  'monday_token',
  'd365_client_secret', 'sso_client_secret',
  'smtp_pass',
]);

export function createSettingsRoutes(
  settingsQueries: SettingsQueries,
  userSettingsQueries: UserSettingsQueries,
  onSettingChanged?: (key: string) => void,
): Router {
  const router = Router();

  // GET /api/settings — admin gets all, non-admin gets redacted subset
  router.get('/', (req, res) => {
    const all = settingsQueries.getAll();
    const userRole = (req as any).user?.role as string | undefined;
    if (userRole && isAdmin(userRole)) {
      res.json({ ok: true, data: all });
      return;
    }
    // Redact sensitive keys for non-admin users
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(all)) {
      if (SENSITIVE_KEYS.has(key) || key.includes('_token') || key.includes('_secret')) {
        continue; // Strip entirely
      }
      safe[key] = value;
    }
    res.json({ ok: true, data: safe });
  });

  // GET /api/settings/my/ai-key — User's personal AI key override
  router.get('/my/ai-key', (req, res) => {
    const userId = req.user?.id as number | undefined;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const key = userSettingsQueries.get(userId, 'openai_api_key');
    const hasKey = !!key?.trim();
    res.json({
      ok: true,
      data: {
        hasKey,
        masked: hasKey ? key!.slice(0, 5) + '****' + key!.slice(-4) : null,
      },
    });
  });

  // PUT /api/settings/my/ai-key — Set user's personal AI key override
  router.put('/my/ai-key', (req, res) => {
    const userId = req.user?.id as number | undefined;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const parsed = SettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const value = parsed.data.value.trim();
    if (!value) {
      res.status(400).json({ ok: false, error: 'API key cannot be empty. Use DELETE to remove your override.' });
      return;
    }
    userSettingsQueries.set(userId, 'openai_api_key', value);
    res.json({ ok: true });
  });

  // DELETE /api/settings/my/ai-key — Remove user's personal AI key override (fall back to global)
  router.delete('/my/ai-key', (req, res) => {
    const userId = req.user?.id as number | undefined;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    userSettingsQueries.delete(userId, 'openai_api_key');
    res.json({ ok: true });
  });

  // PUT /api/settings/:key — Update a global setting (admin/editor only)
  router.put('/:key', requireRole('admin', 'editor'), (req, res) => {
    const parsed = SettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }
    const key = String(req.params.key);
    if (key === 'openai_api_key' && !parsed.data.value.trim()) {
      res.status(400).json({ ok: false, error: 'OpenAI API key cannot be empty.' });
      return;
    }
    settingsQueries.set(key, parsed.data.value);
    onSettingChanged?.(key);
    res.json({ ok: true });
  });

  return router;
}
