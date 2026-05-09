import { Router } from 'express';
import type { OpsPackService } from '../services/ops-pack.js';

export function createOpsPackRoutes(opsPack: OpsPackService): Router {
  const router = Router();

  router.post('/generate', async (req, res) => {
    try {
      const userId = req.user?.id ?? null;
      const pack = await opsPack.generate(userId);
      res.json({ ok: true, data: pack });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate ops pack' });
    }
  });

  router.get('/latest', async (_req, res) => {
    try {
      const pack = await opsPack.getLatest();
      res.json({ ok: true, data: pack });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get latest pack' });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) ?? '10', 10);
      const history = await opsPack.getHistory(limit);
      res.json({ ok: true, data: history });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get history' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const pack = await opsPack.getById(parseInt(req.params.id, 10));
      if (!pack) { res.json({ ok: false, error: 'Pack not found' }); return; }
      res.json({ ok: true, data: pack });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get pack' });
    }
  });

  return router;
}
