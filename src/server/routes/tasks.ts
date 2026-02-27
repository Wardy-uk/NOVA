import { Router } from 'express';
import type { TaskQueries, MilestoneQueries, UserSettingsQueries } from '../db/queries.js';
import type { TaskAggregator, SdFilter } from '../services/aggregator.js';
import { TaskUpdateSchema } from '../../shared/types.js';
import { evaluateAttention } from '../services/jira-sla.js';

export function createTaskRoutes(
  taskQueries: TaskQueries,
  aggregator: TaskAggregator,
  milestoneQueries?: MilestoneQueries,
  userSettingsQueries?: UserSettingsQueries,
): Router {
  const router = Router();

  // GET /api/tasks — List tasks (per-user focus via user_task_pins)
  router.get('/', (req, res) => {
    const { status, source } = req.query;
    const userId = (req as any).user?.id as number | undefined;
    const tasks = taskQueries.getAll({
      status: status as string | undefined,
      source: source as string | undefined,
      userId,
    });
    res.json({ ok: true, data: tasks });
  });

  // GET /api/tasks/service-desk — live Jira search with ownership filter
  router.get('/service-desk', async (req, res) => {
    try {
      const filter = (req.query.filter as string) || 'mine';
      if (!['mine', 'unassigned', 'all'].includes(filter)) {
        res.status(400).json({ ok: false, error: 'filter must be mine, unassigned, or all' });
        return;
      }
      const userId = (req as any).user?.id as number | undefined;
      // "mine" requires personal Jira config; global views just need MCP connected
      if (filter === 'mine') {
        const userJiraEnabled = userId && userSettingsQueries
          ? userSettingsQueries.get(userId, 'jira_enabled') === 'true'
          : false;
        if (!userJiraEnabled) {
          res.json({ ok: true, data: [] });
          return;
        }
      }
      const jiraUsername = userId && userSettingsQueries
        ? (userSettingsQueries.get(userId, 'jira_username') ?? undefined)
        : undefined;
      const tickets = await aggregator.fetchServiceDeskTickets(filter as SdFilter, jiraUsername);
      // Map to task-like objects for the frontend
      const mapped = tickets.map((t) => ({
        id: `jira:${t.source_id}`,
        source: t.source,
        source_id: t.source_id,
        source_url: t.source_url ?? null,
        title: t.title,
        description: t.description ?? null,
        status: t.status ?? 'open',
        priority: t.priority ?? 50,
        due_date: t.due_date ?? null,
        sla_breach_at: t.sla_breach_at ?? null,
        category: t.category ?? null,
        raw_data: t.raw_data ?? null,
        pinned: false,
        snoozed_until: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      res.json({ ok: true, data: mapped });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Service desk fetch failed',
      });
    }
  });

  // GET /api/tasks/service-desk/attention — tickets that need attention (scope=mine|all)
  router.get('/service-desk/attention', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const scope = (req.query.scope as string) || 'all';

      let tickets;
      if (scope === 'mine') {
        // "mine" requires personal Jira config
        const userJiraEnabled = userId && userSettingsQueries
          ? userSettingsQueries.get(userId, 'jira_enabled') === 'true'
          : false;
        if (!userJiraEnabled) {
          res.json({ ok: true, data: [] });
          return;
        }
        const jiraUsername = userId && userSettingsQueries
          ? (userSettingsQueries.get(userId, 'jira_username') ?? undefined)
          : undefined;
        tickets = await aggregator.fetchServiceDeskTickets('mine', jiraUsername);
      } else {
        tickets = await aggregator.fetchServiceDeskTickets('all');
      }
      const now = new Date();

      const attentionTickets = tickets
        .map((t) => {
          const issue = (t.raw_data ?? {}) as Record<string, unknown>;
          const result = evaluateAttention(issue, now);
          return { ticket: t, attention: result };
        })
        .filter(({ attention }) => attention.needsAttention);

      const mapped = attentionTickets.map(({ ticket: t, attention }) => ({
        id: `jira:${t.source_id}`,
        source: t.source,
        source_id: t.source_id,
        source_url: t.source_url ?? null,
        title: t.title,
        description: t.description ?? null,
        status: t.status ?? 'open',
        priority: t.priority ?? 50,
        due_date: t.due_date ?? null,
        sla_breach_at: t.sla_breach_at ?? null,
        category: t.category ?? null,
        raw_data: t.raw_data ?? null,
        pinned: false,
        snoozed_until: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attention_reasons: attention.reasons,
      }));

      console.log(`[ServiceDesk] Attention: ${attentionTickets.length}/${tickets.length} tickets need attention`);
      res.json({ ok: true, data: mapped });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Attention fetch failed',
      });
    }
  });

  // GET /api/tasks/stats — must be before /:id
  router.get('/stats', (_req, res) => {
    const allTasks = taskQueries.getAllIncludingDone();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let overdue = 0;
    let dueToday = 0;
    let dueThisWeek = 0;
    let completedToday = 0;
    let completedThisWeek = 0;
    let totalAgeMs = 0;
    let activeCount = 0;
    let highPriorityOpen = 0;
    let slaBreach = 0;

    for (const t of allTasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      bySource[t.source] = (bySource[t.source] ?? 0) + 1;
      if (t.category) byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;

      const isActive = !['done', 'dismissed'].includes(t.status);

      if (isActive) {
        activeCount++;
        totalAgeMs += now.getTime() - new Date(t.created_at).getTime();
        if (t.priority > 75) highPriorityOpen++;

        if (t.due_date) {
          const dueDate = t.due_date.split('T')[0];
          if (dueDate < todayStr) overdue++;
          else if (dueDate === todayStr) dueToday++;
          else {
            const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            if (dueDate <= weekFromNow) dueThisWeek++;
          }
        }

        if (t.sla_breach_at && new Date(t.sla_breach_at).getTime() < now.getTime()) {
          slaBreach++;
        }
      }

      if (t.status === 'done') {
        const updatedDate = t.updated_at.split('T')[0];
        if (updatedDate === todayStr) completedToday++;
        if (t.updated_at >= weekAgo) completedThisWeek++;
      }
    }

    const total = allTasks.length;
    const done = byStatus['done'] ?? 0;
    const avgAgeDays = activeCount > 0 ? Math.round(totalAgeMs / activeCount / 86400000) : 0;

    res.json({
      ok: true,
      data: {
        total, active: activeCount, byStatus, bySource, byCategory,
        overdue, dueToday, dueThisWeek, completedToday, completedThisWeek,
        completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
        avgAgeDays, highPriorityOpen, slaBreach,
      },
    });
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
    const userId = (req as any).user?.id as number | undefined;
    const updated = taskQueries.update(req.params.id, parsed.data, userId);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'Task not found' });
      return;
    }

    // Bidirectional milestone sync: when a milestone task status changes, update the milestone
    if (parsed.data.status && milestoneQueries) {
      const task = taskQueries.getById(req.params.id);
      if (task?.source === 'milestone' && task.source_id?.startsWith('milestone:')) {
        const parts = task.source_id.split(':');
        // source_id format: milestone:{deliveryId}:{templateId}
        const deliveryId = parseInt(parts[1], 10);
        const templateId = parseInt(parts[2], 10);
        if (!isNaN(deliveryId) && !isNaN(templateId)) {
          const milestones = milestoneQueries.getByDelivery(deliveryId);
          const milestone = milestones.find(m => m.template_id === templateId);
          if (milestone) {
            const statusMap: Record<string, string> = { open: 'pending', in_progress: 'in_progress', done: 'complete' };
            const newMilestoneStatus = statusMap[parsed.data.status] ?? milestone.status;
            const milestoneUpdates: Record<string, unknown> = { status: newMilestoneStatus };
            if (newMilestoneStatus === 'complete') {
              milestoneUpdates.actual_date = new Date().toISOString().split('T')[0];
            } else {
              milestoneUpdates.actual_date = null;
            }
            milestoneQueries.updateMilestone(milestone.id, milestoneUpdates as any);
          }
        }
      }
    }

    res.json({ ok: true, data: taskQueries.getById(req.params.id) });
  });

  // POST /api/tasks/sync — Trigger manual sync (all sources)
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

  // POST /api/tasks/sync/:source — Trigger manual sync for a single source
  router.post('/sync/:source', async (req, res) => {
    const source = req.params.source;
    if (!aggregator.sourceNames.includes(source)) {
      res.status(400).json({ ok: false, error: `Unknown source: ${source}` });
      return;
    }
    try {
      const result = await aggregator.syncSource(source);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : `Sync ${source} failed`,
      });
    }
  });

  return router;
}
