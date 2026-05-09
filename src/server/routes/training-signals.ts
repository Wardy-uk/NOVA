import { Router } from 'express';
import type { TrainingSignalGenerator } from '../services/training-signal-generator.js';

export function createTrainingSignalRoutes(trainingSignals: TrainingSignalGenerator): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const agentId = req.query.agentId as string | undefined;
      const actioned = req.query.actioned === 'true' ? true : req.query.actioned === 'false' ? false : undefined;
      const signals = await trainingSignals.getSignals(agentId, actioned);
      res.json({ ok: true, data: signals });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get signals' });
    }
  });

  router.get('/heatmap', async (_req, res) => {
    try {
      const heatmap = await trainingSignals.getTeamHeatmap();
      res.json({ ok: true, data: heatmap });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get heatmap' });
    }
  });

  router.post('/generate', async (_req, res) => {
    try {
      const count = await trainingSignals.generateWeeklySignals();
      res.json({ ok: true, data: { signals_generated: count } });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Generation failed' });
    }
  });

  router.post('/:id/action', async (req, res) => {
    try {
      await trainingSignals.markActioned(parseInt(req.params.id, 10));
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to mark actioned' });
    }
  });

  return router;
}
