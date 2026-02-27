import { Router } from 'express';
import type { TaskQueries, MilestoneQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { TaskAggregator, SdFilter } from '../services/aggregator.js';
import { TaskUpdateSchema } from '../../shared/types.js';
import { evaluateAttention } from '../services/jira-sla.js';
import { getAllowedSources } from '../utils/source-filter.js';

/** Check if Jira is enabled for this user (per-user first, admin falls back to global). */
function isJiraEnabled(
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): boolean {
  if (!userId) return false;
  const userVal = userSettingsQueries?.get(userId, 'jira_enabled');
  if (userVal !== undefined && userVal !== null) return userVal === 'true';
  if (userRole === 'admin') return settingsQueries?.get('jira_enabled') === 'true';
  return false;
}

/** Get the Jira username for this user (per-user first, admin falls back to global). */
function getJiraUsername(
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): string | undefined {
  if (!userId) return undefined;
  const userVal = userSettingsQueries?.get(userId, 'jira_username');
  if (userVal) return userVal;
  if (userRole === 'admin') return settingsQueries?.get('jira_username') ?? undefined;
  return undefined;
}

export function createTaskRoutes(
  taskQueries: TaskQueries,
  aggregator: TaskAggregator,
  milestoneQueries?: MilestoneQueries,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): Router {
  const router = Router();

  // GET /api/tasks — List tasks (per-user, scoped to integrations the user has enabled)
  router.get('/', (req, res) => {
    const { status, source } = req.query;
    const userId = (req as any).user?.id as number | undefined;
    const userRole = (req as any).user?.role as string | undefined;
    const tasks = taskQueries.getAll({
      status: status as string | undefined,
      source: source as string | undefined,
      userId,
    });

    // Scope to sources the user has enabled (per-user; admin falls back to global)
    const allowedSources = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
    const filtered = tasks.filter((t) => allowedSources.has(t.source));

    res.json({ ok: true, data: filtered, _debug: { userId, userRole, allowedSources: [...allowedSources], totalBeforeFilter: tasks.length, totalAfterFilter: filtered.length } });
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
      const userRole = (req as any).user?.role as string | undefined;
      // "mine" requires Jira config (per-user, admin falls back to global)
      if (filter === 'mine') {
        if (!isJiraEnabled(userId, userRole, userSettingsQueries, settingsQueries)) {
          res.json({ ok: true, data: [] });
          return;
        }
      }
      const jiraUsername = getJiraUsername(userId, userRole, userSettingsQueries, settingsQueries);
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
      const userRole = (req as any).user?.role as string | undefined;
      const scope = (req.query.scope as string) || 'all';

      let tickets;
      if (scope === 'mine') {
        if (!isJiraEnabled(userId, userRole, userSettingsQueries, settingsQueries)) {
          res.json({ ok: true, data: [] });
          return;
        }
        const jiraUsername = getJiraUsername(userId, userRole, userSettingsQueries, settingsQueries);
        tickets = await aggregator.fetchServiceDeskTickets('mine', jiraUsername);
      } else {
        tickets = await aggregator.fetchServiceDeskTickets('all');
      }
      const now = new Date();

      // Diagnostic: log field shape for first 3 tickets to trace why overdue_update fires
      for (const t of tickets.slice(0, 3)) {
        const issue = (t.raw_data ?? {}) as Record<string, unknown>;
        const fields = issue.fields as Record<string, unknown> | undefined;
        const statusRaw = issue.status ?? fields?.status;
        const statusName = typeof statusRaw === 'string' ? statusRaw : (statusRaw as any)?.name;
        console.log(`[Attention DEBUG] ${t.source_id}:`, JSON.stringify({
          topLevelKeys: Object.keys(issue).slice(0, 15),
          hasFields: !!fields,
          fieldsKeys: fields ? Object.keys(fields).filter(k => k.startsWith('custom') || k === 'status' || k === 'created').slice(0, 10) : [],
          status: statusName ?? 'MISSING',
          created: issue.created ?? fields?.created ?? 'MISSING',
          cf14081: issue.customfield_14081 ?? fields?.customfield_14081 ?? 'MISSING',
          cf14185: issue.customfield_14185 ?? fields?.customfield_14185 ?? 'MISSING',
          cf14048: issue.customfield_14048 ? 'PRESENT' : (fields?.customfield_14048 ? 'IN_FIELDS' : 'MISSING'),
        }));
      }

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
        pinned: false,
        snoozed_until: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attention_reasons: attention.reasons,
      }));

      console.log(`[ServiceDesk] Attention: ${attentionTickets.length}/${tickets.length} tickets need attention`);
      res.json({ ok: true, data: mapped, total: tickets.length });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Attention fetch failed',
      });
    }
  });

  // GET /api/tasks/stats — must be before /:id
  router.get('/stats', (req, res) => {
    const userId = (req as any).user?.id as number | undefined;
    const userRole = (req as any).user?.role as string | undefined;
    const allowedSources = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
    const allTasks = taskQueries.getAllIncludingDone().filter((t) => allowedSources.has(t.source));
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
