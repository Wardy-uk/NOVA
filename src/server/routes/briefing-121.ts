import { Router } from 'express';
import type { Briefing121Service } from '../services/briefing-121.js';

export function createBriefing121Routes(briefing121: Briefing121Service): Router {
  const router = Router();

  router.post('/:agentId', async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const agentName = (req.query.name as string) ?? agentId;
      const periodDays = parseInt((req.query.days as string) ?? '14', 10);
      const userId = req.user?.id ?? 0;
      const brief = await briefing121.generate(userId, agentId, agentName, periodDays);
      res.json({ ok: true, data: brief });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate 1-2-1 brief' });
    }
  });

  router.get('/:agentId/history', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) ?? '10', 10);
      const history = await briefing121.getHistory(req.params.agentId, limit);
      res.json({ ok: true, data: history });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get history' });
    }
  });

  router.get('/detail/:briefId', async (req, res) => {
    try {
      const brief = await briefing121.getById(parseInt(req.params.briefId, 10));
      if (!brief) { res.json({ ok: false, error: 'Brief not found' }); return; }
      res.json({ ok: true, data: brief });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get brief' });
    }
  });

  return router;
}
