import { Router } from 'express';
import { z } from 'zod';
import type { TaskQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { saveDb } from '../db/schema.js';

const M365_SOURCES = ['planner', 'todo', 'calendar', 'email'] as const;

const IngestTaskSchema = z.object({
  source: z.enum(M365_SOURCES),
  source_id: z.string().min(1),
  source_url: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  due_date: z.string().optional(),
  sla_breach_at: z.string().optional(),
  category: z.string().optional(),
  raw_data: z.unknown().optional(),
});

const IngestRequestSchema = z.object({
  source: z.enum(M365_SOURCES),
  tasks: z.array(IngestTaskSchema).max(500),
});

export function createIngestRoutes(taskQueries: TaskQueries, settingsQueries?: SettingsQueries): Router {
  const router = Router();

  // POST /api/ingest — Bulk ingest tasks from Power Automate Desktop
  router.post('/', (req, res) => {
    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }

    const { source, tasks } = parsed.data;

    // Check if PA bridge is disabled globally
    if (settingsQueries?.get('pa_bridge_enabled') === 'false') {
      res.json({ ok: true, data: { source, upserted: 0, removed: 0, skipped: true, reason: 'PA bridge disabled' } });
      return;
    }

    // Check if this source is enabled
    if (settingsQueries?.get(`sync_${source}_enabled`) === 'false') {
      res.json({ ok: true, data: { source, upserted: 0, removed: 0, skipped: true, reason: `${source} sync disabled` } });
      return;
    }
    const prune = String(req.query.prune ?? 'false').toLowerCase() === 'true';

    const mismatch = tasks.find(t => t.source !== source);
    if (mismatch) {
      res.status(400).json({
        ok: false,
        error: `Task source "${mismatch.source}" does not match declared source "${source}"`,
      });
      return;
    }

    const freshIds: string[] = [];
    for (const task of tasks) {
      taskQueries.upsertFromSource(task as any, { deferSave: true });
      freshIds.push(`${task.source}:${task.source_id}`);
    }

    const removed = (tasks.length > 0 || prune)
      ? taskQueries.deleteStaleBySource(source, freshIds, {
          allowEmpty: prune,
          deferSave: true,
        })
      : 0;

    if (tasks.length > 0 || removed > 0) {
      saveDb();
    }

    console.log(
      `[Ingest] ${source}: Received ${tasks.length} tasks, removed ${removed} stale`
    );

    res.json({
      ok: true,
      data: { source, upserted: tasks.length, removed },
    });
  });

  // GET /api/ingest/status — Health check for PA Desktop
  router.get('/status', (_req, res) => {
    res.json({ ok: true, message: 'Ingest endpoint ready' });
  });

  return router;
}
