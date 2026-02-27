import { Router } from 'express';
import type { TaskQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { getNextActions, getAiActionsDebugLog, recordAiActionsDebug } from '../services/ai-actions.js';
import { filterTasksByAllowedSources } from '../utils/source-filter.js';

export function createActionRoutes(
  taskQueries: TaskQueries,
  settingsQueries: SettingsQueries,
  userSettingsQueries: UserSettingsQueries,
) {
  const router = Router();

  const resolveApiKey = (userId?: number): string | null => {
    // 1. Per-user override (from user_settings table)
    if (userId) {
      const userKey = userSettingsQueries.get(userId, 'openai_api_key');
      if (userKey?.trim()) return userKey.trim();
    }
    // 2. Global key from settings
    const fromDb = settingsQueries.get('openai_api_key');
    if (fromDb?.trim()) return fromDb.trim();
    // 3. Read-only fallback to env vars
    const fromEnv = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? null;
    if (fromEnv?.trim()) return fromEnv.trim();
    return null;
  };

  router.post('/suggest', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const sourceParam = (req.query.source as string | undefined) ?? 'all';
      const sources = sourceParam === 'all' ? null : sourceParam.split(',').filter(Boolean);
      const provider = settingsQueries.get('ai_provider') ?? 'openai';

      // Get all tasks scoped to this user's enabled integrations
      let allUserTasks = filterTasksByAllowedSources(
        taskQueries.getAll(), userId, userRole, userSettingsQueries, settingsQueries
      );
      // Then apply the source query-param filter on top
      if (sources) allUserTasks = allUserTasks.filter((t) => sources.includes(t.source));

      const taskCount = allUserTasks.length;
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

      const apiKey = resolveApiKey(req.user?.id as number | undefined);
      if (!apiKey) {
        recordAiActionsDebug('[error] missing OpenAI API key');
        res.status(400).json({
          ok: false,
          error: 'OpenAI API key not configured. Set a personal key in My Settings → AI Preferences, or ask your admin to set a global key.',
        });
        return;
      }

      const countStr = settingsQueries.get('ai_action_count') ?? '10';
      const count = parseInt(countStr, 10) || 5;

      const tasks = allUserTasks;
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
