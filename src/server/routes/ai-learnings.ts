import { Router } from 'express';
import type { AiLearningService } from '../services/ai-learning-service.js';

function isAdmin(req: any): boolean {
  return req.user?.role === 'admin';
}

export function createAiLearningRoutes(service: AiLearningService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
      const category = req.query.category as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await service.list({ active, category, limit, offset });
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/categories', async (_req, res) => {
    try {
      const { query } = await import('../services/database.js');
      const rows = await query<{ category: string; cnt: number }>(
        `SELECT category, COUNT(*) as cnt FROM ai_learnings WHERE active = 1 AND category IS NOT NULL GROUP BY category ORDER BY cnt DESC`
      );
      res.json({ ok: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const learning = await service.getById(parseInt(req.params.id, 10));
      if (!learning) return res.status(404).json({ ok: false, error: 'Not found' });
      res.json({ ok: true, data: learning });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { ticket_key, ai_draft, learning, category, organisation, tags } = req.body;
      if (!ticket_key || !learning) {
        return res.status(400).json({ ok: false, error: 'ticket_key and learning are required' });
      }

      const username = (req as any).user?.username ?? 'unknown';
      const id = await service.submit({
        ticket_key,
        ai_draft,
        learning,
        category,
        organisation,
        tags,
        submitted_by: username,
      });

      res.json({ ok: true, data: { id } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await service.getById(id);
      if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

      const { learning, category, tags, organisation } = req.body;
      await service.update(id, { learning, category, tags, organisation });
      res.json({ ok: true, data: { updated: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.put('/:id/toggle', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await service.getById(id);
      if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

      await service.toggleActive(id, !existing.active);
      res.json({ ok: true, data: { active: !existing.active } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/:id/applications', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
      const applications = await service.getApplicationHistory(id, limit);
      res.json({ ok: true, data: applications });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      await service.delete(parseInt(req.params.id, 10));
      res.json({ ok: true, data: { deleted: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
