import { Router } from 'express';
import type { TaskQueries, RitualQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { generateMorningBriefing, generateReplan, generateEndOfDay } from '../services/ai-standup.js';
import { getAllowedSources, filterTasksByAllowedSources } from '../utils/source-filter.js';

export function createStandupRoutes(
  taskQueries: TaskQueries,
  settingsQueries: SettingsQueries,
  ritualQueries: RitualQueries,
  userSettingsQueries: UserSettingsQueries,
) {
  const router = Router();

  const today = () => new Date().toISOString().split('T')[0];

  const requireApiKey = (userId?: number): string | null => {
    if (userId) {
      const userKey = userSettingsQueries.get(userId, 'openai_api_key');
      if (userKey?.trim()) return userKey.trim();
    }
    const fromDb = settingsQueries.get('openai_api_key');
    if (fromDb?.trim()) return fromDb.trim();
    const fromEnv = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? null;
    if (fromEnv?.trim()) return fromEnv.trim();
    return null;
  };

  // Re-enrich task references from stored AI response, optionally filtered by allowed sources
  const enrichTask = (allowedSources?: Set<string>) => (item: { task_id: string }) => {
    const task = taskQueries.getById(item.task_id);
    if (!task || (allowedSources && !allowedSources.has(task.source))) return { ...item, task: null };
    return { ...item, task };
  };

  const enrichMorning = (raw: Record<string, unknown>, ritualId: number, allowed?: Set<string>) => ({
    summary: raw.summary as string,
    overdue: ((raw.overdue as Array<{ task_id: string }>) ?? []).map(enrichTask(allowed)).filter((i) => i.task),
    due_today: ((raw.due_today as Array<{ task_id: string }>) ?? []).map(enrichTask(allowed)).filter((i) => i.task),
    top_priorities: ((raw.top_priorities as Array<{ task_id: string }>) ?? []).map(enrichTask(allowed)).filter((i) => i.task),
    rolled_over: ((raw.rolled_over as Array<{ task_id: string }>) ?? []).map(enrichTask(allowed)).filter((i) => i.task),
    ritual_id: ritualId,
  });

  const enrichReplan = (raw: Record<string, unknown>, ritualId: number, allowed?: Set<string>) => ({
    summary: raw.summary as string,
    adjusted_priorities: ((raw.adjusted_priorities as Array<{ task_id: string }>) ?? []).map(enrichTask(allowed)).filter((i) => i.task),
    ritual_id: ritualId,
  });

  const enrichEod = (raw: Record<string, unknown>, ritualId: number, allowed?: Set<string>) => ({
    summary: raw.summary as string,
    accomplished: (raw.accomplished as string[]) ?? [],
    rolling_over: ((raw.rolling_over as Array<{ task_id: string }>) ?? []).map(enrichTask(allowed)).filter((i) => i.task),
    insights: (raw.insights as string) ?? '',
    ritual_id: ritualId,
  });

  // Check what exists today (per-user)
  router.get('/today', (req, res) => {
    const userId = (req as any).user?.id as number | undefined;
    const rituals = ritualQueries.getByDate(today(), undefined, userId);
    const hasMorning = rituals.some((r) => r.type === 'morning');
    const hasReplan = rituals.some((r) => r.type === 'replan');
    const hasEod = rituals.some((r) => r.type === 'eod');
    res.json({ ok: true, data: { rituals, hasMorning, hasReplan, hasEod, date: today() } });
  });

  // Load cached rituals for today, re-enriched with current task data (per-user, source-filtered)
  router.get('/cached', (req, res) => {
    const userId = (req as any).user?.id as number | undefined;
    const userRole = (req as any).user?.role as string | undefined;
    const allowed = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
    const rituals = ritualQueries.getByDate(today(), undefined, userId);
    const result: Record<string, unknown> = {};

    for (const ritual of rituals) {
      if (!ritual.conversation) continue;
      try {
        const raw = JSON.parse(ritual.conversation) as Record<string, unknown>;
        if (ritual.type === 'morning' && !result.morning) {
          result.morning = enrichMorning(raw, ritual.id, allowed);
        } else if (ritual.type === 'replan' && !result.replan) {
          result.replan = enrichReplan(raw, ritual.id, allowed);
        } else if (ritual.type === 'eod' && !result.eod) {
          result.eod = enrichEod(raw, ritual.id, allowed);
        }
      } catch { /* skip corrupt data */ }
    }

    res.json({ ok: true, data: result });
  });

  // Morning standup
  router.post('/morning', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const apiKey = requireApiKey(userId);
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'OpenAI API key not configured.' });
        return;
      }
      const tasks = filterTasksByAllowedSources(
        taskQueries.getAll({ userId }), userId, userRole, userSettingsQueries, settingsQueries
      );

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayRituals = ritualQueries.getByDate(yesterday.toISOString().split('T')[0], 'morning', userId);

      const briefing = await generateMorningBriefing(tasks, apiKey, yesterdayRituals[0] ?? null);

      const ritualId = ritualQueries.create({
        type: 'morning',
        date: today(),
        summary_md: briefing.summary,
        planned_items: JSON.stringify(briefing.top_priorities.map((p) => p.task_id)),
        conversation: JSON.stringify(briefing),
        user_id: userId,
      });

      const enriched = enrichMorning(briefing as unknown as Record<string, unknown>, ritualId);
      res.json({ ok: true, data: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `Morning briefing failed: ${message}` });
    }
  });

  // Re-plan
  router.post('/replan', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const apiKey = requireApiKey(userId);
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'OpenAI API key not configured.' });
        return;
      }
      const tasks = filterTasksByAllowedSources(
        taskQueries.getAll({ userId }), userId, userRole, userSettingsQueries, settingsQueries
      );
      const todayRituals = ritualQueries.getByDate(today(), 'morning', userId);

      const replan = await generateReplan(tasks, apiKey, todayRituals[0] ?? null);

      const ritualId = ritualQueries.create({
        type: 'replan',
        date: today(),
        summary_md: replan.summary,
        conversation: JSON.stringify(replan),
        user_id: userId,
      });

      const enriched = enrichReplan(replan as unknown as Record<string, unknown>, ritualId);
      res.json({ ok: true, data: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `Re-plan failed: ${message}` });
    }
  });

  // End of day
  router.post('/eod', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const apiKey = requireApiKey(userId);
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'OpenAI API key not configured.' });
        return;
      }
      const tasks = filterTasksByAllowedSources(
        taskQueries.getAll({ userId }), userId, userRole, userSettingsQueries, settingsQueries
      );
      const todayRituals = ritualQueries.getByDate(today(), 'morning', userId);

      const review = await generateEndOfDay(tasks, apiKey, todayRituals[0] ?? null);

      const ritualId = ritualQueries.create({
        type: 'eod',
        date: today(),
        summary_md: review.summary,
        completed_items: JSON.stringify(review.accomplished),
        conversation: JSON.stringify(review),
        user_id: userId,
      });

      const enriched = enrichEod(review as unknown as Record<string, unknown>, ritualId);
      res.json({ ok: true, data: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `End-of-day review failed: ${message}` });
    }
  });

  // Update ritual (add notes, blockers, completed items)
  router.patch('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid ritual ID' });
      return;
    }

    const { summary_md, planned_items, completed_items, blockers } = req.body;
    const updated = ritualQueries.update(id, { summary_md, planned_items, completed_items, blockers });

    if (!updated) {
      res.status(404).json({ ok: false, error: 'Ritual not found' });
      return;
    }
    res.json({ ok: true });
  });

  // History
  router.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const rituals = ritualQueries.getRecent(limit);
    res.json({ ok: true, data: rituals });
  });

  return router;
}
