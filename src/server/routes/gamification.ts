import { Router, type Request, type Response } from 'express';
import type { GamificationService } from '../services/gamification.js';

export function createGamificationRoutes(service: GamificationService): Router {
  const router = Router();

  router.get('/profile', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const profile = await service.getProfile(req.user.id);
      res.json({ ok: true, data: profile });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/profile/:userId', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const profile = await service.getProfile(parseInt(String(req.params.userId), 10));
      res.json({ ok: true, data: profile });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/leaderboard', async (_req: Request, res: Response) => {
    try {
      const data = await service.getLeaderboard();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/achievements', async (_req: Request, res: Response) => {
    try {
      const data = await service.getAchievementDefs();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.post('/check', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const awarded = await service.checkAndAwardAchievements(req.user.id);
      res.json({ ok: true, data: { awarded } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/points', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const points = await service.getPoints(req.user.id);
      res.json({ ok: true, data: { points } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  return router;
}
