import { Router } from 'express';
import { z } from 'zod';
import type { TaskQueries } from '../db/queries.js';

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

export function createIngestRoutes(taskQueries: TaskQueries): Router {
  const router = Router();

  // POST /api/ingest — Bulk ingest tasks from Power Automate Desktop
  router.post('/', (req, res) => {
    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }

    const { source, tasks } = parsed.data;

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
      taskQueries.upsertFromSource(task);
      freshIds.push(`${task.source}:${task.source_id}`);
    }

    const removed = taskQueries.deleteStaleBySource(source, freshIds);

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
