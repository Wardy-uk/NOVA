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

  return router;
}
