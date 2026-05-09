import { Router } from 'express';
import type { SelfDirectedLearning } from '../services/self-directed-learning.js';

export function createLearningRoutes(learning: SelfDirectedLearning): Router {
  const router = Router();

  router.get('/velocity', async (req, res) => {
    try {
      const days = parseInt((req.query.days as string) ?? '30', 10);
      const velocity = await learning.getLearningVelocity(days);
      res.json({ ok: true, data: velocity });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get velocity' });
    }
  });

  router.get('/novel-tickets', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) ?? '20', 10);
      const tickets = await learning.getNovelTickets(limit);
      res.json({ ok: true, data: tickets });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get novel tickets' });
    }
  });

  router.post('/check-novelty', async (req, res) => {
    try {
      const { request_type, component } = req.body;
      const result = await learning.checkNovelty(request_type, component);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Novelty check failed' });
    }
  });

  router.post('/check-expansion', async (req, res) => {
    try {
      const { request_type, component } = req.body;
      const result = await learning.checkAutonomyExpansion(request_type, component);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Expansion check failed' });
    }
  });

  return router;
}
