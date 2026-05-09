import { Router } from 'express';
import type { EscalationPredictor } from '../services/escalation-predictor.js';
import { requireRole } from '../middleware/auth.js';

export function createPredictionRoutes(predictor: EscalationPredictor): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/active', async (_req, res) => {
    try {
      const predictions = await predictor.getActivePredictions();
      res.json({ ok: true, data: predictions });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.get('/accuracy', async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const stats = await predictor.getAccuracyStats(days);
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/test', async (req, res) => {
    try {
      const { ticketKey } = req.body;
      if (!ticketKey) return res.status(400).json({ ok: false, error: 'ticketKey required' });
      const result = await predictor.predictForTicket(ticketKey);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/resolve', async (req, res) => {
    try {
      const { ticketKey, didEscalate } = req.body;
      if (!ticketKey || typeof didEscalate !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'ticketKey and didEscalate required' });
      }
      await predictor.resolveOutcome(ticketKey, didEscalate);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
