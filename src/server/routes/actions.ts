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

  router.post('/suggest', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const sourceParam = (req.query.source as string | undefined) ?? 'all';
      const sources = sourceParam === 'all' ? null : sourceParam.split(',').filter(Boolean);

      // Get all tasks scoped to this user's enabled integrations
      let allUserTasks = filterTasksByAllowedSources(
        taskQueries.getAll(), userId, userRole, userSettingsQueries, settingsQueries
      );
      // Then apply the source query-param filter on top
      if (sources) allUserTasks = allUserTasks.filter((t) => sources.includes(t.source));

      const taskCount = allUserTasks.length;
      recordAiActionsDebug(`[request] source=${sourceParam} taskCount=${taskCount}`);

      // Allow client-side override via query param, else use global setting
      const queryCount = req.query.count ? parseInt(req.query.count as string, 10) : NaN;
      const countStr = settingsQueries.get('ai_action_count') ?? '10';
      const count = (!isNaN(queryCount) && queryCount >= 1 && queryCount <= 25) ? queryCount : (parseInt(countStr, 10) || 5);

      if (allUserTasks.length === 0) {
        recordAiActionsDebug('[info] no tasks for requested source');
        res.json({ ok: true, data: { suggestions: [] } });
        return;
      }

      const suggestions = getNextActions(allUserTasks, count);

      // Enrich suggestions with full task data
      const enriched = suggestions.map((s) => {
        const task = taskQueries.getById(s.task_id);
        return { ...s, task: task ?? null };
      }).filter((s) => s.task !== null);

      res.json({ ok: true, data: { suggestions: enriched } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `Suggestion failed: ${message}` });
    }
  });

  router.get('/debug-log', (_req, res) => {
    res.json({ ok: true, data: getAiActionsDebugLog() });
  });

  return router;
}
