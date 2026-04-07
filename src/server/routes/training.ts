import { Router, type Request, type Response } from 'express';
import type { TrainingQueries } from '../db/queries.js';
import type { FileUserQueries } from '../db/user-store.js';
import { isAdmin } from '../utils/role-helpers.js';
import type { AreaAccessGuard } from '../middleware/auth.js';

export function createTrainingRoutes(
  trainingQueries: TrainingQueries,
  userQueries: FileUserQueries,
  requireAreaAccess: AreaAccessGuard,
): Router {
  const router = Router();

  // All training routes require at least view access
  router.use(requireAreaAccess('training', 'view'));

  // ── Categories ──

  router.get('/categories', (_req: Request, res: Response) => {
    const categories = trainingQueries.getCategories();
    res.json({ ok: true, data: categories });
  });

  router.post('/categories', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { name, sort_order } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: 'Name required' }); return; }
    const id = trainingQueries.createCategory(name, sort_order ?? 0);
    res.json({ ok: true, data: { id } });
  });

  router.put('/categories/:id', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { name, sort_order } = req.body;
    trainingQueries.updateCategory(Number(req.params.id), name, sort_order ?? 0);
    res.json({ ok: true });
  });

  router.delete('/categories/:id', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    trainingQueries.deleteCategory(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Items ──

  router.get('/items', (req: Request, res: Response) => {
    const categoryId = req.query.category ? Number(req.query.category) : undefined;
    const items = trainingQueries.getItems(categoryId);
    res.json({ ok: true, data: items });
  });

  router.post('/items', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { category_id, section, name, tech_lead, max_score, sort_order } = req.body;
    if (!category_id || !name) { res.status(400).json({ ok: false, error: 'category_id and name required' }); return; }
    const id = trainingQueries.createItem({
      category_id, section: section ?? '', name,
      tech_lead: tech_lead ?? null, max_score: max_score ?? 5, sort_order: sort_order ?? 0,
    });
    res.json({ ok: true, data: { id } });
  });

  router.put('/items/:id', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    trainingQueries.updateItem(Number(req.params.id), req.body);
    res.json({ ok: true });
  });

  router.delete('/items/:id', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    trainingQueries.deleteItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Scores ──

  router.get('/scores', (req: Request, res: Response) => {
    const categoryId = req.query.category ? Number(req.query.category) : undefined;
    const userId = req.query.user ? Number(req.query.user) : undefined;
    const scores = trainingQueries.getScores(categoryId, userId);
    res.json({ ok: true, data: scores });
  });

  router.put('/scores', (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const { scores } = req.body as { scores: Array<{ item_id: number; user_id: number; score: number }> };
    if (!scores?.length) { res.status(400).json({ ok: false, error: 'scores array required' }); return; }

    const admin = isAdmin(req.user.role);
    // Non-admins can only edit their own scores
    if (!admin) {
      const hasOtherUsers = scores.some(s => s.user_id !== req.user!.id);
      if (hasOtherUsers) {
        res.status(403).json({ ok: false, error: 'You can only edit your own scores' });
        return;
      }
    }

    trainingQueries.bulkUpsertScores(scores);
    res.json({ ok: true });
  });

  // ── Users (people in the matrix) ──

  router.get('/users', (_req: Request, res: Response) => {
    const allUsers = userQueries.getAll();
    const users = allUsers.map(u => ({ id: u.id, username: u.username, display_name: u.display_name }));
    res.json({ ok: true, data: users });
  });

  // ── Bulk import (xlsx seeding) ──

  router.post('/import', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const result = trainingQueries.bulkImport(req.body);
    res.json({ ok: true, data: result });
  });

  // ── Summary stats ──

  router.get('/summary', (_req: Request, res: Response) => {
    const categories = trainingQueries.getCategories();
    const items = trainingQueries.getItems();
    const scores = trainingQueries.getScores();
    const allUsers = userQueries.getAll();

    // Per-user, per-category stats
    const summary = allUsers.map(u => {
      const userScores = scores.filter(s => s.user_id === u.id);
      const categoryStats = categories.map(cat => {
        const catItems = items.filter(i => i.category_id === cat.id);
        const catScores = userScores.filter(s => catItems.some(i => i.id === s.item_id));
        const totalPossible = catItems.reduce((sum, i) => sum + i.max_score, 0);
        const totalScored = catScores.reduce((sum, s) => sum + s.score, 0);
        return {
          category_id: cat.id,
          category_name: cat.name,
          items_count: catItems.length,
          scored_count: catScores.filter(s => s.score > 0).length,
          total_possible: totalPossible,
          total_scored: totalScored,
          percentage: totalPossible > 0 ? Math.round((totalScored / totalPossible) * 100) : 0,
        };
      });
      const overallPossible = categoryStats.reduce((s, c) => s + c.total_possible, 0);
      const overallScored = categoryStats.reduce((s, c) => s + c.total_scored, 0);
      return {
        user_id: u.id,
        username: u.username,
        display_name: u.display_name,
        categories: categoryStats,
        overall_percentage: overallPossible > 0 ? Math.round((overallScored / overallPossible) * 100) : 0,
        overall_scored: overallScored,
        overall_possible: overallPossible,
      };
    });

    res.json({ ok: true, data: { categories, summary } });
  });

  return router;
}
