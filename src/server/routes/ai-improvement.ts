import { Router, type Request, type Response } from 'express';
import type { AiImprovementService } from '../services/ai-improvement.js';

export function createAiImprovementRoutes(service: AiImprovementService): Router {
  const router = Router();

  router.get('/stats', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);
      const stats = await service.getStats(days);
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get stats' });
    }
  });

  router.get('/comparisons', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const data = await service.getComparisons(limit, offset);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/signals', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const data = await service.getSignals(limit, offset);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.post('/scan', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const [compared, signals] = await Promise.all([
        service.runComparisonScan(),
        service.detectHumanEdits(),
      ]);
      res.json({ ok: true, data: { compared, signals } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Scan failed' });
    }
  });

  return router;
}
