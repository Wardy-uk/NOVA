import { Router } from 'express';
import { z } from 'zod';
import type { SettingsQueries } from '../db/queries.js';

const SettingUpdateSchema = z.object({
  value: z.string(),
});

export function createSettingsRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();

  // GET /api/settings — All settings
  router.get('/', (_req, res) => {
    res.json({ ok: true, data: settingsQueries.getAll() });
  });

  // PUT /api/settings/:key — Update a setting
  router.put('/:key', (req, res) => {
    const parsed = SettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }
    if (req.params.key === 'openai_api_key' && !parsed.data.value.trim()) {
      res.status(400).json({ ok: false, error: 'OpenAI API key cannot be empty.' });
      return;
    }
    settingsQueries.set(req.params.key, parsed.data.value);
    res.json({ ok: true });
  });

  return router;
}
