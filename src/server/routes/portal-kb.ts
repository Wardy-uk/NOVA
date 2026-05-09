import { Router, type Request, type Response } from 'express';
import type { PortalKbService } from '../services/portal-kb.js';

export function createPortalKbRoutes(kbService: PortalKbService): Router {
  const router = Router();

  router.get('/search', async (req: Request, res: Response) => {
    const q = req.query.q as string;
    if (!q || q.length < 2) {
      res.status(400).json({ ok: false, error: 'Search query must be at least 2 characters' });
      return;
    }
    try {
      const results = await kbService.search(
        q,
        req.portalUser?.userId,
        req.portalUser?.orgId,
      );
      res.json({ ok: true, data: { articles: results, total: results.length } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  router.get('/articles/:id', async (req: Request, res: Response) => {
    try {
      const article = await kbService.getArticle(
        parseInt(req.params.id as string, 10),
        req.portalUser?.userId,
        req.portalUser?.orgId,
      );
      if (!article) { res.status(404).json({ ok: false, error: 'Article not found' }); return; }
      res.json({ ok: true, data: article });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get article' });
    }
  });

  router.post('/articles/:id/feedback', async (req: Request, res: Response) => {
    const { helpful } = req.body;
    if (typeof helpful !== 'boolean') {
      res.status(400).json({ ok: false, error: 'helpful (boolean) is required' });
      return;
    }
    try {
      await kbService.submitFeedback(parseInt(req.params.id as string, 10), helpful);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit feedback' });
    }
  });

  router.get('/categories', async (_req: Request, res: Response) => {
    try {
      const categories = await kbService.getCategories();
      res.json({ ok: true, data: categories });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get categories' });
    }
  });

  router.get('/popular', async (_req: Request, res: Response) => {
    try {
      const articles = await kbService.getPopularArticles();
      res.json({ ok: true, data: articles });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get popular articles' });
    }
  });

  return router;
}
