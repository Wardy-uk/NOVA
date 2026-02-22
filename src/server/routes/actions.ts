import { Router } from 'express';
import type { TaskQueries, SettingsQueries } from '../db/queries.js';
import { getNextActions } from '../services/ai-actions.js';

export function createActionRoutes(
  taskQueries: TaskQueries,
  settingsQueries: SettingsQueries,
) {
  const router = Router();

  router.post('/suggest', async (_req, res) => {
    try {
      const apiKey = settingsQueries.get('openai_api_key');
      if (!apiKey) {
        res.status(400).json({
          ok: false,
          error: 'OpenAI API key not configured. Add it in Settings → AI Assistant.',
        });
        return;
      }

      const countStr = settingsQueries.get('ai_action_count') ?? '5';
      const count = parseInt(countStr, 10) || 5;

      const tasks = taskQueries.getAll();
      if (tasks.length === 0) {
        res.json({ ok: true, data: { suggestions: [] } });
        return;
      }

      const suggestions = await getNextActions(tasks, count, apiKey);

      // Enrich suggestions with full task data
      const enriched = suggestions.map((s) => {
        const task = taskQueries.getById(s.task_id);
        return { ...s, task: task ?? null };
      }).filter((s) => s.task !== null);

      res.json({ ok: true, data: { suggestions: enriched } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `AI suggestion failed: ${message}` });
    }
  });

  return router;
}
