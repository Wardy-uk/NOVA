import { Router } from 'express';
import type { TaskQueries, MilestoneQueries, OnboardingRunQueries, UserSettingsQueries, ProblemTicketQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { TaskAggregator, SdFilter, SyncContext } from '../services/aggregator.js';
import { JiraRestClient } from '../services/jira-client.js';
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

/** Build a JiraRestClient from the user's personal Jira credentials (My Settings). */
function buildUserJiraClient(
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): JiraRestClient | null {
  if (!userId) return null;
  // Per-user credentials
  const url = userSettingsQueries?.get(userId, 'jira_url');
  const email = userSettingsQueries?.get(userId, 'jira_username');
  const token = userSettingsQueries?.get(userId, 'jira_token');
  if (url && email && token) {
    return new JiraRestClient({ baseUrl: url, email, apiToken: token });
  }
  // Admin fallback to global seeded creds
  if (userRole === 'admin' || (userRole ?? '').includes('admin')) {
    const gUrl = settingsQueries?.get('jira_url');
    const gEmail = settingsQueries?.get('jira_username');
    const gToken = settingsQueries?.get('jira_token');
    if (gUrl && gEmail && gToken) {
      return new JiraRestClient({ baseUrl: gUrl, email: gEmail, apiToken: gToken });
    }
  }
  return null;
}

export function createTaskRoutes(
  taskQueries: TaskQueries,
  aggregator: TaskAggregator,
  milestoneQueries?: MilestoneQueries,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
  onboardingRunQueries?: OnboardingRunQueries,
  problemTicketQueries?: ProblemTicketQueries,
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

    res.json({ ok: true, data: filtered });
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
      // "mine" requires personal Jira config
      if (filter === 'mine') {
        if (!isJiraEnabled(userId, userRole, userSettingsQueries, settingsQueries)) {
          res.json({ ok: true, data: [] });
          return;
        }
      }
      // "all" / "unassigned" require the global Jira (Admin) to be configured
      if (filter === 'all' || filter === 'unassigned') {
        if (settingsQueries?.get('jira_ob_enabled') !== 'true') {
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
        // scope=all requires global Jira (Admin) to be configured
        if (settingsQueries?.get('jira_ob_enabled') !== 'true') {
          res.json({ ok: true, data: [] });
          return;
        }
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
          const result = evaluateAttention(issue, now, t.priority ?? 50);
          return { ticket: t, attention: result };
        })
        .filter(({ attention }) => attention.needsAttention)
        .sort((a, b) => b.attention.urgencyScore - a.attention.urgencyScore);

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
        urgency_score: attention.urgencyScore,
        sla_remaining_ms: attention.slaRemainingMs,
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

  // GET /api/tasks/service-desk/dashboard — aggregated dashboard KPIs
  router.get('/service-desk/dashboard', async (_req, res) => {
    try {
      // Dashboard requires global Jira (Admin) — it shows all tickets
      if (settingsQueries?.get('jira_ob_enabled') !== 'true') {
        res.json({ ok: true, data: { total: 0, slaBreached: 0, overdueUpdates: 0, byStatus: {}, byPriority: {}, byAssignee: {}, customers: 0 } });
        return;
      }
      const tickets = await aggregator.fetchServiceDeskTickets('all');
      const now = new Date();

      let slaBreached = 0;
      let overdueUpdates = 0;
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byAssignee: Record<string, number> = {};
      const customers = new Set<string>();
      let totalAgeDays = 0;

      for (const t of tickets) {
        const issue = (t.raw_data ?? {}) as Record<string, unknown>;
        const result = evaluateAttention(issue, now);
        if (result.reasons.includes('sla_breached')) slaBreached++;
        if (result.reasons.includes('overdue_update')) overdueUpdates++;

        const status = t.status ?? 'unknown';
        byStatus[status] = (byStatus[status] ?? 0) + 1;

        const prio = t.priority ?? 50;
        const prioLabel = prio >= 80 ? 'High' : prio >= 50 ? 'Medium' : 'Low';
        byPriority[prioLabel] = (byPriority[prioLabel] ?? 0) + 1;

        // Extract assignee from raw_data
        const fields = (issue.fields as Record<string, unknown>) ?? issue;
        const assigneeObj = fields.assignee as Record<string, unknown> | undefined;
        const assigneeName = (assigneeObj?.displayName as string) ?? (assigneeObj?.name as string) ?? 'Unassigned';
        byAssignee[assigneeName] = (byAssignee[assigneeName] ?? 0) + 1;

        // Extract customer/reporter org
        const reporter = fields.reporter as Record<string, unknown> | undefined;
        const orgName = (reporter?.displayName as string) ?? (reporter?.emailAddress as string);
        if (orgName) customers.add(orgName);

        // Age calculation
        const created = (fields.created as string) ?? (issue.created as string);
        if (created) {
          const ageMs = now.getTime() - new Date(created).getTime();
          totalAgeDays += ageMs / (1000 * 60 * 60 * 24);
        }
      }

      // Problem ticket stats
      const ptStats = problemTicketQueries?.getStats();
      const problemTickets = ptStats
        ? { p1: ptStats.p1, p2: ptStats.p2, p3: ptStats.p3, total: ptStats.total }
        : { p1: 0, p2: 0, p3: 0, total: 0 };

      res.json({
        ok: true,
        data: {
          totalOpen: tickets.length,
          slaBreached,
          overdueUpdates,
          distinctCustomers: customers.size,
          avgAgeDays: tickets.length > 0 ? Math.round(totalAgeDays / tickets.length) : 0,
          problemTickets: { p1: problemTickets.p1, p2: problemTickets.p2, p3: problemTickets.p3, total: problemTickets.total },
          byStatus,
          byPriority,
          byAssignee: Object.entries(byAssignee)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count })),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Dashboard fetch failed' });
    }
  });

  // GET /api/tasks/service-desk/wallboard — queue health tiles + drill-down
  // Returns tier×metric grid with counts, and optionally the matching tickets for a specific tile.
  // Query params for drill-down: ?tier=Customer Care&metric=no_update (or over_sla, total)
  router.get('/service-desk/wallboard', async (req, res) => {
    try {
      if (settingsQueries?.get('jira_ob_enabled') !== 'true') {
        res.json({ ok: true, data: { tiers: [], drillDown: null } });
        return;
      }
      const tickets = await aggregator.fetchServiceDeskTickets('all');
      const now = new Date();

      // Helper: extract current tier from raw_data
      function extractTier(t: { raw_data?: unknown }): string {
        const rd = (t.raw_data && typeof t.raw_data === 'object') ? t.raw_data as Record<string, unknown> : null;
        if (!rd) return 'Unknown';
        const raw = rd.customfield_12981;
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') return (raw as any).value ?? (raw as any).name ?? 'Unknown';
        return 'Unknown';
      }

      // Helper: extract issue type (Incident / Service Request etc.)
      function extractIssueType(t: { raw_data?: unknown }): string {
        const rd = (t.raw_data && typeof t.raw_data === 'object') ? t.raw_data as Record<string, unknown> : null;
        if (!rd) return 'Unknown';
        const fields = rd.fields as Record<string, unknown> | undefined;
        const it = fields?.issuetype ?? rd.issuetype;
        if (it && typeof it === 'object') return (it as any).name ?? 'Unknown';
        if (typeof it === 'string') return it;
        return 'Unknown';
      }

      // Evaluate each ticket
      const evaluated = tickets.map(t => {
        const issue = (t.raw_data ?? {}) as Record<string, unknown>;
        const att = evaluateAttention(issue, now, t.priority ?? 50);
        return { ticket: t, tier: extractTier(t), issueType: extractIssueType(t), attention: att };
      });

      // Build tier summary: group by tier, then count total / no_update / over_sla
      const tierMap = new Map<string, { total: number; noUpdate: number; overSla: number }>();
      for (const e of evaluated) {
        let entry = tierMap.get(e.tier);
        if (!entry) { entry = { total: 0, noUpdate: 0, overSla: 0 }; tierMap.set(e.tier, entry); }
        entry.total++;
        if (e.attention.reasons.includes('overdue_update')) entry.noUpdate++;
        if (e.attention.reasons.includes('sla_breached')) entry.overSla++;
      }

      const tiers = Array.from(tierMap.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([name, counts]) => ({ name, ...counts }));

      // Drill-down: if ?tier= and ?metric= are provided, return matching tickets
      const drillTier = req.query.tier as string | undefined;
      const drillMetric = req.query.metric as string | undefined; // total | no_update | over_sla
      let drillDown: unknown[] | null = null;

      if (drillTier && drillMetric) {
        const matching = evaluated.filter(e => {
          if (e.tier !== drillTier) return false;
          if (drillMetric === 'no_update') return e.attention.reasons.includes('overdue_update');
          if (drillMetric === 'over_sla') return e.attention.reasons.includes('sla_breached');
          return true; // 'total' — all tickets in this tier
        });

        drillDown = matching
          .sort((a, b) => b.attention.urgencyScore - a.attention.urgencyScore)
          .map(({ ticket: t, attention, issueType }) => {
            const issue = (t.raw_data ?? {}) as Record<string, unknown>;
            const fields = (issue.fields as Record<string, unknown>) ?? issue;
            const assigneeObj = fields.assignee as Record<string, unknown> | undefined;
            const assignee = (assigneeObj?.displayName as string) ?? (assigneeObj?.name as string) ?? 'Unassigned';
            return {
              key: t.source_id,
              summary: t.title,
              status: t.status,
              priority: t.priority,
              assignee,
              issueType,
              source_url: t.source_url,
              urgency_score: attention.urgencyScore,
              sla_remaining_ms: attention.slaRemainingMs,
              attention_reasons: attention.reasons,
              created: (fields.created as string) ?? (issue.created as string) ?? null,
            };
          });
      }

      res.json({ ok: true, data: { tiers, drillDown } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Wallboard fetch failed' });
    }
  });

  // GET /api/tasks/stats — must be before /:id
  router.get('/stats', (req, res) => {
    const userId = (req as any).user?.id as number | undefined;
    const userRole = (req as any).user?.role as string | undefined;
    const allowedSources = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
    const allTasks = taskQueries.getAllIncludingDone(userId).filter((t) => allowedSources.has(t.source));
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

    // Onboarding metrics — milestone summary + recent runs
    const milestoneSummary = milestoneQueries?.getSummary() ?? null;
    const recentRuns = onboardingRunQueries?.getRecent(5) ?? [];

    res.json({
      ok: true,
      data: {
        total, active: activeCount, byStatus, bySource, byCategory,
        overdue, dueToday, dueThisWeek, completedToday, completedThisWeek,
        completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
        avgAgeDays, highPriorityOpen, slaBreach,
        onboarding: {
          milestones: milestoneSummary,
          recentRuns: recentRuns.map((r) => ({
            id: r.id,
            ref: r.onboarding_ref,
            status: r.status,
            parentKey: r.parent_key,
            createdCount: r.created_count,
            dryRun: r.dry_run === 1,
            createdAt: r.created_at,
          })),
        },
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

  // POST /api/tasks/sync — Trigger manual sync (only sources this user has enabled)
  router.post('/sync', async (req, res) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const allowedSources = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
      const jiraClient = buildUserJiraClient(userId, userRole, userSettingsQueries, settingsQueries);
      const jiraBaseUrl = userSettingsQueries?.get(userId!, 'jira_url') ?? settingsQueries?.get('jira_url') ?? undefined;
      const ctx: SyncContext = { jiraClient, jiraBaseUrl };
      const results = await aggregator.syncAllForUser(userId, allowedSources, ctx);
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
    const userId = (req as any).user?.id as number | undefined;
    const userRole = (req as any).user?.role as string | undefined;
    const allowedSources = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
    if (!allowedSources.has(source)) {
      res.json({ ok: true, data: { source, count: 0 } });
      return;
    }
    try {
      const jiraClient = buildUserJiraClient(userId, userRole, userSettingsQueries, settingsQueries);
      const jiraBaseUrl = userSettingsQueries?.get(userId!, 'jira_url') ?? settingsQueries?.get('jira_url') ?? undefined;
      const result = await aggregator.syncSource(source, userId, { jiraClient, jiraBaseUrl });
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
