import { Router } from 'express';
import type { TaskQueries } from '../db/queries.js';
import type { TaskAggregator } from '../services/aggregator.js';
import { TaskUpdateSchema } from '../../shared/types.js';

export function createTaskRoutes(
  taskQueries: TaskQueries,
  aggregator: TaskAggregator
): Router {
  const router = Router();

  // GET /api/tasks — List tasks
  router.get('/', (req, res) => {
    const { status, source } = req.query;
    const tasks = taskQueries.getAll({
      status: status as string | undefined,
      source: source as string | undefined,
    });
    res.json({ ok: true, data: tasks });
  });

  // GET /api/tasks/:id — Get single task
  router.get('/:id', (req, res) => {
    const task = taskQueries.getById(req.params.id);
    if (!task) {
      res.status(404).json({ ok: false, error: 'Task not found' });
      return;
    }
    res.json({ ok: true, data: task });
  });

  // PATCH /api/tasks/:id — Update task (pin/snooze/dismiss)
  router.patch('/:id', (req, res) => {
    const parsed = TaskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }
    const updated = taskQueries.update(req.params.id, parsed.data);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'Task not found' });
      return;
    }
    res.json({ ok: true, data: taskQueries.getById(req.params.id) });
  });

  // POST /api/tasks/sync — Trigger manual sync
  router.post('/sync', async (_req, res) => {
    try {
      const results = await aggregator.syncAll();
      res.json({ ok: true, data: results });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  });

  return router;
}
