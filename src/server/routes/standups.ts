import { Router } from 'express';
import type { TaskQueries, SettingsQueries, RitualQueries } from '../db/queries.js';
import { generateMorningBriefing, generateReplan, generateEndOfDay } from '../services/ai-standup.js';

export function createStandupRoutes(
  taskQueries: TaskQueries,
  settingsQueries: SettingsQueries,
  ritualQueries: RitualQueries,
) {
  const router = Router();

  const today = () => new Date().toISOString().split('T')[0];

  const requireApiKey = (): string | null => {
    // DB is the source of truth (seeded from env on startup)
    const fromDb = settingsQueries.get('openai_api_key');
    if (fromDb?.trim()) return fromDb.trim();
    // Read-only fallback to env vars
    const fromEnv = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? null;
    if (fromEnv?.trim()) return fromEnv.trim();
    return null;
  };

  // Check if morning standup exists today
  router.get('/today', (_req, res) => {
    const rituals = ritualQueries.getByDate(today());
    const hasMorning = rituals.some((r) => r.type === 'morning');
    res.json({ ok: true, data: { rituals, hasMorning, date: today() } });
  });

  // Morning standup
  router.post('/morning', async (_req, res) => {
    try {
      const apiKey = requireApiKey();
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'OpenAI API key not configured.' });
        return;
      }

      const tasks = taskQueries.getAll();

      // Get yesterday's latest ritual for rollover context
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayRituals = ritualQueries.getByDate(yesterdayStr, 'morning');
      const previousRitual = yesterdayRituals[0] ?? null;

      const briefing = await generateMorningBriefing(tasks, apiKey, previousRitual);

      // Enrich task references with full task data
      const enrichTask = (item: { task_id: string }) => {
        const task = taskQueries.getById(item.task_id);
        return { ...item, task: task ?? null };
      };

      const enriched = {
        summary: briefing.summary,
        overdue: briefing.overdue.map(enrichTask).filter((i) => i.task),
        due_today: briefing.due_today.map(enrichTask).filter((i) => i.task),
        top_priorities: briefing.top_priorities.map(enrichTask).filter((i) => i.task),
        rolled_over: briefing.rolled_over.map(enrichTask).filter((i) => i.task),
      };

      // Save ritual
      const plannedIds = enriched.top_priorities.map((p) => p.task_id);
      const ritualId = ritualQueries.create({
        type: 'morning',
        date: today(),
        summary_md: briefing.summary,
        planned_items: JSON.stringify(plannedIds),
      });

      res.json({ ok: true, data: { ...enriched, ritual_id: ritualId } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `Morning briefing failed: ${message}` });
    }
  });

  // Re-plan
  router.post('/replan', async (_req, res) => {
    try {
      const apiKey = requireApiKey();
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'OpenAI API key not configured.' });
        return;
      }

      const tasks = taskQueries.getAll();
      const todayRituals = ritualQueries.getByDate(today(), 'morning');
      const morningRitual = todayRituals[0] ?? null;

      const replan = await generateReplan(tasks, apiKey, morningRitual);

      const enrichTask = (item: { task_id: string }) => {
        const task = taskQueries.getById(item.task_id);
        return { ...item, task: task ?? null };
      };

      const enriched = {
        summary: replan.summary,
        adjusted_priorities: replan.adjusted_priorities.map(enrichTask).filter((i) => i.task),
      };

      res.json({ ok: true, data: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, error: `Re-plan failed: ${message}` });
    }
  });

  // End of day
  router.post('/eod', async (_req, res) => {
    try {
      const apiKey = requireApiKey();
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'OpenAI API key not configured.' });
        return;
      }

      const tasks = taskQueries.getAll();
      const todayRituals = ritualQueries.getByDate(today(), 'morning');
      const morningRitual = todayRituals[0] ?? null;

      const review = await generateEndOfDay(tasks, apiKey, morningRitual);

      const enrichTask = (item: { task_id: string }) => {
        const task = taskQueries.getById(item.task_id);
        return { ...item, task: task ?? null };
      };

      const enriched = {
        summary: review.summary,
        accomplished: review.accomplished,
        rolling_over: review.rolling_over.map(enrichTask).filter((i) => i.task),
        insights: review.insights,
      };

      // Save ritual
      const ritualId = ritualQueries.create({
        type: 'eod',
        date: today(),
        summary_md: review.summary,
        completed_items: JSON.stringify(review.accomplished),
      });

      res.json({ ok: true, data: { ...enriched, ritual_id: ritualId } });
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
