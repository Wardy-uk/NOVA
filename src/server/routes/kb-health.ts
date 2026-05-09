import { Router } from 'express';
import type { KbHealthService } from '../services/kb-health.js';
import type { KbGapClosureService } from '../services/kb-gap-closure.js';

export function createKbHealthRoutes(kbHealth: KbHealthService, gapClosure: KbGapClosureService): Router {
  const router = Router();

  router.get('/stats', async (_req, res) => {
    try {
      const stats = await kbHealth.getHealthStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get KB health stats' });
    }
  });

  router.get('/articles', async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const articles = await kbHealth.getArticleHealth(status);
      res.json({ ok: true, data: articles });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get articles' });
    }
  });

  router.get('/coverage', async (_req, res) => {
    try {
      const heatmap = await kbHealth.getCoverageHeatmap();
      res.json({ ok: true, data: heatmap });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get coverage' });
    }
  });

  router.post('/scan', async (_req, res) => {
    try {
      const processed = await kbHealth.runStalenessCheck();
      res.json({ ok: true, data: { processed } });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Scan failed' });
    }
  });

  router.post('/draft-update/:articleId', async (req, res) => {
    try {
      const draftId = await kbHealth.draftUpdateForArticle(req.params.articleId);
      res.json({ ok: true, data: { draftId } });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Draft update failed' });
    }
  });

  router.get('/closure-stats', async (_req, res) => {
    try {
      const stats = await gapClosure.getClosureStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get closure stats' });
    }
  });

  return router;
}
