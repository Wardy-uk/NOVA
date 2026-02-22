import { Router } from 'express';
import type { TaskQueries, SettingsQueries } from '../db/queries.js';
import { getNextActions, getAiActionsDebugLog, recordAiActionsDebug } from '../services/ai-actions.js';

export function createActionRoutes(
  taskQueries: TaskQueries,
  settingsQueries: SettingsQueries,
) {
  const router = Router();

  const resolveApiKey = (): string | null => {
    // DB is the source of truth (seeded from env on startup)
    const fromDb = settingsQueries.get('openai_api_key');
    if (fromDb?.trim()) return fromDb.trim();
    // Read-only fallback to env vars — no side-effect writes
    const fromEnv = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? null;
    if (fromEnv?.trim()) return fromEnv.trim();
    return null;
  };

  router.post('/suggest', async (req, res) => {
    try {
      const sourceParam = (req.query.source as string | undefined) ?? 'all';
      const sources = sourceParam === 'all' ? null : sourceParam.split(',').filter(Boolean);
      const provider = settingsQueries.get('ai_provider') ?? 'openai';
      const taskCount = !sources
        ? taskQueries.getAll().length
        : taskQueries.getAll().filter((t) => sources.includes(t.source)).length;
      recordAiActionsDebug(
        `[request] source=${sourceParam} provider=${provider} taskCount=${taskCount}`
      );

      if (provider !== 'openai') {
        recordAiActionsDebug(`[error] provider "${provider}" not supported`);
        res.status(400).json({
          ok: false,
          error: `AI provider "${provider}" is not configured on the server yet.`,
        });
        return;
      }

      const apiKey = resolveApiKey();
      if (!apiKey) {
        recordAiActionsDebug('[error] missing OpenAI API key');
        res.status(400).json({
          ok: false,
          error: 'OpenAI API key not configured. Add it in Settings → AI Assistant.',
        });
        return;
      }

      const countStr = settingsQueries.get('ai_action_count') ?? '10';
      const count = parseInt(countStr, 10) || 5;

      const tasks = !sources
        ? taskQueries.getAll()
        : taskQueries.getAll().filter((t) => sources.includes(t.source));
      if (tasks.length === 0) {
        recordAiActionsDebug('[info] no tasks for requested source');
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

  router.get('/debug-log', (_req, res) => {
    res.json({ ok: true, data: getAiActionsDebugLog() });
  });

  return router;
}
