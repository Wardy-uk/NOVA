import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import type { BacklogQueries } from '../db/queries.js';

export function createBacklogRoutes(backlogQueries: BacklogQueries): Router {
  const router = Router();
  const adminOnly = requireRole('admin', 'super_admin');

  // ── Columns ──

  router.get('/columns', async (_req, res) => {
    try {
      const columns = await backlogQueries.getColumns();
      res.json({ ok: true, data: columns });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/columns', adminOnly, async (req, res) => {
    try {
      const { title, color } = req.body;
      if (!title) { res.status(400).json({ ok: false, error: 'title is required' }); return; }
      const id = await backlogQueries.createColumn(title, color);
      const col = await backlogQueries.getColumnById(id);
      res.json({ ok: true, data: col });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/columns/reorder', adminOnly, async (req, res) => {
    try {
      const { columnIds } = req.body;
      if (!Array.isArray(columnIds)) { res.status(400).json({ ok: false, error: 'columnIds array required' }); return; }
      await backlogQueries.reorderColumns(columnIds);
      res.json({ ok: true, data: { reordered: columnIds.length } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/columns/:id', adminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { title, color, sort_order } = req.body;
      await backlogQueries.updateColumn(id, { title, color, sort_order });
      const col = await backlogQueries.getColumnById(id);
      res.json({ ok: true, data: col });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete('/columns/:id', adminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const count = await backlogQueries.columnItemCount(id);
      if (count > 0) {
        res.status(400).json({ ok: false, error: `Column has ${count} items — move or delete them first` });
        return;
      }
      await backlogQueries.deleteColumn(id);
      res.json({ ok: true, data: { deleted: id } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Items ──

  router.get('/items', async (req, res) => {
    try {
      const column_id = req.query.column_id ? parseInt(req.query.column_id as string) : undefined;
      const type = req.query.type as string | undefined;
      const items = await backlogQueries.getItems({ column_id, type });
      res.json({ ok: true, data: items });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/items/:id', async (req, res) => {
    try {
      const item = await backlogQueries.getItemById(parseInt(req.params.id));
      if (!item) { res.status(404).json({ ok: false, error: 'Item not found' }); return; }
      res.json({ ok: true, data: item });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/items', adminOnly, async (req, res) => {
    try {
      const { column_id, title, description, wp_ref, effort, type, priority } = req.body;
      if (!title) { res.status(400).json({ ok: false, error: 'title is required' }); return; }
      if (!column_id) { res.status(400).json({ ok: false, error: 'column_id is required' }); return; }
      const id = await backlogQueries.createItem({
        column_id, title, description, wp_ref, effort, type, priority,
        created_by: req.user?.username,
      });
      const item = await backlogQueries.getItemById(id);
      res.json({ ok: true, data: item });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/items/reorder', adminOnly, async (req, res) => {
    try {
      const { column_id, itemIds } = req.body;
      if (!column_id || !Array.isArray(itemIds)) {
        res.status(400).json({ ok: false, error: 'column_id and itemIds array required' });
        return;
      }
      await backlogQueries.reorderItems(column_id, itemIds);
      res.json({ ok: true, data: { reordered: itemIds.length } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/items/:id/move', adminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { column_id, priority } = req.body;
      if (!column_id) { res.status(400).json({ ok: false, error: 'column_id is required' }); return; }
      await backlogQueries.moveItem(id, column_id, priority);
      const item = await backlogQueries.getItemById(id);
      res.json({ ok: true, data: item });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/items/:id', adminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { title, description, wp_ref, effort, type, blocked_reason } = req.body;
      await backlogQueries.updateItem(id, { title, description, wp_ref, effort, type, blocked_reason });
      const item = await backlogQueries.getItemById(id);
      res.json({ ok: true, data: item });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete('/items/:id', adminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const item = await backlogQueries.getItemById(id);
      if (!item) { res.status(404).json({ ok: false, error: 'Item not found' }); return; }
      await backlogQueries.deleteItem(id);
      res.json({ ok: true, data: { deleted: id, title: item.title } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── One-time seed (admin only, idempotent) ──

  router.post('/seed', adminOnly, async (_req, res) => {
    try {
      const existing = await backlogQueries.getItems();
      if (existing.length > 0) {
        res.json({ ok: true, data: { message: `Already seeded (${existing.length} items exist)`, seeded: 0 } });
        return;
      }

      const SEED: Array<{ column: string; title: string; description?: string; wp_ref?: string; effort?: string; type?: string }> = [
        // Done
        { column: 'Done', title: 'Git template push to AzDO', wp_ref: 'WP-01', type: 'code', effort: '2-4hr' },
        { column: 'Done', title: 'Jira REST client: POST /search → /search/jql migration', wp_ref: 'WP-02', type: 'code', effort: '1hr' },
        { column: 'Done', title: 'Release notes popup (auto-show on deploy)', wp_ref: 'WP-03', type: 'code', effort: '2hr' },
        { column: 'Done', title: 'Problem ticket scanner — rule engine + LLM scoring', wp_ref: 'WP-04', type: 'code', effort: '1-2 days' },
        { column: 'Done', title: 'Security hardening — settings redaction, admin guards', wp_ref: 'WP-05', type: 'code', effort: '4hr' },
        { column: 'Done', title: 'SharePoint bi-directional sync', wp_ref: 'WP-06', type: 'code', effort: '1 day' },
        { column: 'Done', title: 'Milestone workflow engine', wp_ref: 'WP-07', type: 'code', effort: '1 day' },
        { column: 'Done', title: 'AI Agent autonomy engine + coaching loop', wp_ref: 'WP-08', type: 'code', effort: '3 days' },
        { column: 'Done', title: 'KPI pipeline + QA pipeline', wp_ref: 'WP-09', type: 'code', effort: '2 days' },
        { column: 'Done', title: 'Entra SSO (PKCE auth code flow)', wp_ref: 'WP-10', type: 'code', effort: '1 day' },
        { column: 'Done', title: 'Gamification system (achievements, streaks, leaderboard)', wp_ref: 'WP-11', type: 'code', effort: '1 day' },
        { column: 'Done', title: 'Escalation logging + SOP-002 gate', wp_ref: 'WP-12', type: 'code', effort: '1 day' },
        { column: 'Done', title: 'Replace MCP SharePoint sync with direct Graph API', wp_ref: 'WP-14', type: 'code', effort: '4hr' },
        { column: 'Done', title: 'People HR sync + rate limit throttle', wp_ref: 'WP-16', type: 'code', effort: '4hr' },

        // This Sprint
        { column: 'This Sprint', title: 'Add 15-min timer to ProblemTicketScanner', wp_ref: 'WP-13', type: 'bugfix', effort: '1hr', description: 'Decision 13: scanner has no explicit recurring timer — runs on-demand only. Should be a 15min interval.' },
        { column: 'This Sprint', title: 'Verify actor.ts sets assignee on autonomous resolve', wp_ref: 'WP-15', type: 'code', effort: '2hr', description: 'Decision 15 pre-req: verify actor.ts sets assignee = NOVA Jira service account on every autonomous resolve.' },
        { column: 'This Sprint', title: 'Add NOVA AI service account to dbo.Agent', wp_ref: 'WP-52', type: 'manual', effort: '30min', description: 'Decision 15: add NOVA AI service account as synthetic agent with own pseudo-tier.' },

        // Backlog
        { column: 'Backlog', title: 'Wire AI Improvement Scan hourly', wp_ref: 'WP-23i', type: 'code', effort: 'Half day', description: 'Decision 9: hourly schedule, feeds ai_comparison_log and coaching nudges.' },
        { column: 'Backlog', title: 'Add kb_article_drafts table + lifecycle', wp_ref: 'WP-42', type: 'code', effort: 'Half day', description: 'Decision 10: hybrid persistence — body stored pre-publish, nulled on publish, kept on rejection.' },
        { column: 'Backlog', title: 'Delete Plaud stubs from people.ts', wp_ref: 'WP-17', type: 'code', effort: '15min' },
        { column: 'Backlog', title: 'Remove dead chat.ts route + service', wp_ref: 'WP-18', type: 'code', effort: '15min' },
        { column: 'Backlog', title: 'Migrate CRM, Contracts, Adobe Sign, Sales Hotbox out', wp_ref: 'WP-19', type: 'code', effort: '2-3 days', description: 'Decision 1: migrate to separate tooling.' },
        { column: 'Backlog', title: 'Gamification BA + consolidation', wp_ref: 'WP-20', type: 'workshop', effort: '1 day', description: 'Decision 3: two gamification stores exist. BA required first.' },
        { column: 'Backlog', title: 'Jira OAuth login for personal Jira', wp_ref: 'WP-21', type: 'code', effort: '1 day' },
        { column: 'Backlog', title: 'Enhanced permissions — global admin + team admin', wp_ref: 'WP-22', type: 'code', effort: '1 day' },
        { column: 'Backlog', title: 'User-configurable homepage', type: 'code', effort: '2hr' },
        { column: 'Backlog', title: 'Fix onboarding tasks showing as mine in command centre', type: 'bugfix', effort: '2hr' },
        { column: 'Backlog', title: 'KPI targets + individual targets', type: 'code', effort: '4hr' },
        { column: 'Backlog', title: 'Capture time worked via isAvailable polling', type: 'code', effort: '4hr' },
        { column: 'Backlog', title: 'Add SLAs to daily history > agent KPIs', type: 'code', effort: '2hr' },
        { column: 'Backlog', title: 'WP-49 plugin_to_tpj detector inconsistency', wp_ref: 'WP-49', type: 'bugfix', effort: '4hr' },
        { column: 'Backlog', title: 'Fix production SPA fallback route', wp_ref: 'TD3', type: 'bugfix', effort: '30min' },
        { column: 'Backlog', title: 'Jira OAuth base URL resolution', wp_ref: 'TD4', type: 'bugfix', effort: '30min' },
        { column: 'Backlog', title: 'Remove sensitive debug logging', wp_ref: 'TD5', type: 'code', effort: '30min' },
        { column: 'Backlog', title: 'Settings file-store durability', wp_ref: 'TD6', type: 'infrastructure', effort: '4hr' },
        { column: 'Backlog', title: 'Architecture review for 50+ users', wp_ref: 'TD7', type: 'research', effort: '1 day' },

        // Parked
        { column: 'Parked', title: 'Dynamics 365 full migrate', wp_ref: 'WP-30', type: 'code', effort: '3-5 days', description: 'Deferred — Dynamics being rebuilt as new CRM.' },
        { column: 'Parked', title: 'Dynamic checkpoint dates in trends.ts', wp_ref: 'WP-31', type: 'code', effort: '4hr', description: 'Revisit post-probation (post 31 May 2026).' },
        { column: 'Parked', title: 'KPI view pagination', wp_ref: 'WP-32', type: 'code', effort: '1 day', description: 'Defer — trigger on perf regression or headcount jump.' },
        { column: 'Parked', title: 'Customer 360 timeline', type: 'code', effort: '2-3 days' },
        { column: 'Parked', title: 'Email attachments (list/get/add)', type: 'code', effort: '4hr' },
        { column: 'Parked', title: 'Multi-calendar support UI', type: 'code', effort: '4hr' },
        { column: 'Parked', title: 'Global search across all entities', type: 'code', effort: '1-2 days' },
        { column: 'Parked', title: 'CSV/PDF export for stakeholders', type: 'code', effort: '4hr' },
        { column: 'Parked', title: 'Keyboard shortcuts', type: 'code', effort: '4hr' },
      ];

      const columns = await backlogQueries.getColumns();
      const colMap = new Map(columns.map(c => [c.title.toLowerCase(), c.id]));
      let count = 0;

      for (const item of SEED) {
        const colId = colMap.get(item.column.toLowerCase());
        if (!colId) continue;
        await backlogQueries.createItem({
          column_id: colId,
          title: item.title,
          description: item.description,
          wp_ref: item.wp_ref,
          effort: item.effort,
          type: item.type,
          created_by: 'seed',
        });
        count++;
      }

      res.json({ ok: true, data: { message: `Seeded ${count} items`, seeded: count } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
