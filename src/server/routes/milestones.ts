import { Router } from 'express';
import { z } from 'zod';
import type { MilestoneQueries, DeliveryQueries, TaskQueries } from '../db/queries.js';
import { requireRole } from '../middleware/auth.js';

const TemplateCreateSchema = z.object({
  name: z.string().min(1),
  day_offset: z.number().int(),
  sort_order: z.number().int().optional(),
  checklist_json: z.string().optional(),
});

const TemplateUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  day_offset: z.number().int().optional(),
  sort_order: z.number().int().optional(),
  checklist_json: z.string().optional(),
  active: z.number().int().min(0).max(1).optional(),
});

const MilestoneUpdateSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'complete']).optional(),
  actual_date: z.string().nullable().optional(),
  checklist_state_json: z.string().optional(),
  notes: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
});

function calculateMilestonePriority(targetDate: string | null, status: string): number {
  if (status === 'complete') return 20;
  if (!targetDate) return 50;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 80;   // overdue
  if (diffDays <= 3) return 70;   // due very soon
  if (diffDays <= 7) return 60;   // due this week
  return 50;
}

/** Sync a single milestone instance to the tasks table */
function syncMilestoneToTask(
  milestone: { id: number; delivery_id: number; template_id: number; template_name: string; target_date: string | null; status: string },
  account: string,
  taskQueries: TaskQueries,
) {
  const statusMap: Record<string, string> = { pending: 'open', in_progress: 'in_progress', complete: 'done' };
  const sourceId = `milestone:${milestone.delivery_id}:${milestone.template_id}`;

  taskQueries.upsertFromSource({
    source: 'milestone',
    source_id: sourceId,
    title: `${account} — ${milestone.template_name}`,
    description: `Delivery milestone for ${account}`,
    status: statusMap[milestone.status] ?? 'open',
    priority: calculateMilestonePriority(milestone.target_date, milestone.status),
    due_date: milestone.target_date ?? undefined,
    category: 'project',
  }, { deferSave: true });
}

/** Sync all milestones for a delivery to the tasks table */
export function syncDeliveryMilestonesToTasks(
  deliveryId: number,
  account: string,
  milestoneQueries: MilestoneQueries,
  taskQueries: TaskQueries,
) {
  const milestones = milestoneQueries.getByDelivery(deliveryId);
  for (const m of milestones) {
    syncMilestoneToTask(m, account, taskQueries);
  }
}

/** Re-sync all active milestone tasks (recalculates priorities based on current date) */
export function resyncAllMilestoneTasks(
  milestoneQueries: MilestoneQueries,
  taskQueries: TaskQueries,
) {
  const all = milestoneQueries.getAllWithDelivery();
  let synced = 0;
  for (const m of all) {
    if (m.status === 'complete') continue;
    syncMilestoneToTask(m, m.account, taskQueries);
    synced++;
  }
  console.log(`[Milestones] Re-synced ${synced} active milestone tasks`);
}

export function createMilestoneRoutes(
  milestoneQueries: MilestoneQueries,
  deliveryQueries: DeliveryQueries,
  taskQueries: TaskQueries,
): Router {
  const router = Router();
  const writeGuard = requireRole('admin', 'editor');

  // ── Templates ──

  router.get('/templates', (_req, res) => {
    const activeOnly = _req.query.active === '1';
    res.json({ ok: true, data: milestoneQueries.getAllTemplates(activeOnly) });
  });

  router.get('/templates/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const tmpl = milestoneQueries.getTemplateById(id);
    if (!tmpl) { res.status(404).json({ ok: false, error: 'Template not found' }); return; }
    res.json({ ok: true, data: tmpl });
  });

  router.post('/templates', writeGuard, (req, res) => {
    const parsed = TemplateCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const id = milestoneQueries.createTemplate(parsed.data);
    res.json({ ok: true, data: milestoneQueries.getTemplateById(id) });
  });

  router.put('/templates/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const parsed = TemplateUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const ok = milestoneQueries.updateTemplate(id, parsed.data);
    if (!ok) { res.status(404).json({ ok: false, error: 'Template not found or no changes' }); return; }
    res.json({ ok: true, data: milestoneQueries.getTemplateById(id) });
  });

  router.delete('/templates/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    milestoneQueries.deleteTemplate(id);
    res.json({ ok: true });
  });

  // ── Sale Type Matrix (must be before /:id catch-all) ──

  router.get('/matrix', (_req, res) => {
    try {
      const offsets = milestoneQueries.getMatrixOffsets();
      res.json({ ok: true, data: offsets });
    } catch (err) {
      console.error('[Milestones] Matrix read error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to read matrix' });
    }
  });

  router.put('/matrix', writeGuard, (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) { res.status(400).json({ ok: false, error: 'updates must be an array' }); return; }
    for (const u of updates) {
      if (typeof u.sale_type_id !== 'number' || typeof u.template_id !== 'number' || typeof u.day_offset !== 'number') {
        res.status(400).json({ ok: false, error: 'Each update must have sale_type_id, template_id, and day_offset (all numbers)' });
        return;
      }
    }
    try {
      milestoneQueries.batchSetMatrixOffsets(updates);
      res.json({ ok: true, data: milestoneQueries.getMatrixOffsets() });
    } catch (err) {
      console.error('[Milestones] Matrix update error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update matrix' });
    }
  });

  router.delete('/matrix/:saleTypeId', writeGuard, (req, res) => {
    const saleTypeId = parseInt(req.params.saleTypeId, 10);
    if (isNaN(saleTypeId)) { res.status(400).json({ ok: false, error: 'Invalid saleTypeId' }); return; }
    milestoneQueries.deleteMatrixRow(saleTypeId);
    res.json({ ok: true });
  });

  // ── Calendar — all milestones with delivery info ──

  router.get('/calendar', (_req, res) => {
    const milestones = milestoneQueries.getAllWithDelivery();
    res.json({ ok: true, data: milestones });
  });

  // ── Summary ──

  router.get('/summary', (_req, res) => {
    res.json({ ok: true, data: milestoneQueries.getSummary() });
  });

  // ── Delivery Milestone Instances ──

  router.get('/delivery/:deliveryId', (req, res) => {
    const deliveryId = parseInt(req.params.deliveryId, 10);
    if (isNaN(deliveryId)) { res.status(400).json({ ok: false, error: 'Invalid deliveryId' }); return; }
    res.json({ ok: true, data: milestoneQueries.getByDelivery(deliveryId) });
  });

  router.post('/backfill', writeGuard, (req, res) => {
    try {
      const allEntries = deliveryQueries.getAll();
      let created = 0;
      let skipped = 0;
      const results: Array<{ id: number; account: string; milestones: number }> = [];

      for (const entry of allEntries) {
        const existing = milestoneQueries.getByDelivery(entry.id);
        if (existing.length > 0) { skipped++; continue; }

        const startDate = entry.order_date || new Date().toISOString().split('T')[0];
        const milestones = milestoneQueries.createForDelivery(entry.id, startDate);
        syncDeliveryMilestonesToTasks(entry.id, entry.account, milestoneQueries, taskQueries);
        created++;
        results.push({ id: entry.id, account: entry.account, milestones: milestones.length });
      }

      console.log(`[Milestones] Backfill: created for ${created} deliveries, skipped ${skipped} (already had milestones)`);
      res.json({ ok: true, data: { created, skipped, total: allEntries.length, results } });
    } catch (err) {
      console.error('[Milestones] Backfill error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backfill failed' });
    }
  });

  router.post('/delivery/:deliveryId/create', writeGuard, (req, res) => {
    const deliveryId = parseInt(req.params.deliveryId, 10);
    if (isNaN(deliveryId)) { res.status(400).json({ ok: false, error: 'Invalid deliveryId' }); return; }

    // Check if milestones already exist
    const existing = milestoneQueries.getByDelivery(deliveryId);
    if (existing.length > 0) {
      res.status(409).json({ ok: false, error: 'Milestones already exist for this delivery. Delete them first to recreate.' });
      return;
    }

    const entry = deliveryQueries.getById(deliveryId);
    if (!entry) { res.status(404).json({ ok: false, error: 'Delivery entry not found' }); return; }

    // Use order_date as start, fallback to today
    const startDate = entry.order_date || new Date().toISOString().split('T')[0];
    const milestones = milestoneQueries.createForDelivery(deliveryId, startDate);

    // Sync to tasks
    syncDeliveryMilestonesToTasks(deliveryId, entry.account, milestoneQueries, taskQueries);

    res.json({ ok: true, data: milestones });
  });

  // ── Single milestone update (catch-all /:id — must be LAST) ──

  router.put('/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const parsed = MilestoneUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }

    const updates = { ...parsed.data } as Record<string, unknown>;

    // Auto-set actual_date when completing
    if (parsed.data.status === 'complete' && parsed.data.actual_date === undefined) {
      updates.actual_date = new Date().toISOString().split('T')[0];
    }
    // Clear actual_date when reverting from complete
    if (parsed.data.status && parsed.data.status !== 'complete' && parsed.data.actual_date === undefined) {
      updates.actual_date = null;
    }

    const ok = milestoneQueries.updateMilestone(id, updates as any);
    if (!ok) { res.status(404).json({ ok: false, error: 'Milestone not found' }); return; }

    // Sync updated milestone to task
    const milestone = milestoneQueries.getMilestoneById(id);
    if (milestone) {
      const entry = deliveryQueries.getById(milestone.delivery_id);
      if (entry) {
        syncMilestoneToTask(milestone, entry.account, taskQueries);
      }
    }

    res.json({ ok: true, data: milestone });
  });

  router.delete('/delivery/:deliveryId', writeGuard, (req, res) => {
    const deliveryId = parseInt(req.params.deliveryId, 10);
    if (isNaN(deliveryId)) { res.status(400).json({ ok: false, error: 'Invalid deliveryId' }); return; }

    const count = milestoneQueries.deleteByDelivery(deliveryId);
    // Also remove milestone tasks for this delivery
    taskQueries.deleteBySourcePrefix('milestone', `milestone:${deliveryId}:`);

    res.json({ ok: true, data: { deleted: count } });
  });

  return router;
}
