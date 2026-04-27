import { Router, type Request, type Response } from 'express';
import type { KbArticleService } from '../services/kb-article-service.js';

export function createKbArticleRoutes(kbService: KbArticleService): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const status = req.query.status as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const drafts = await kbService.listDrafts(status, limit);
      res.json({ ok: true, data: drafts });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list drafts' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const draft = await kbService.getById(parseInt(String(req.params.id), 10));
      if (!draft) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
      res.json({ ok: true, data: draft });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get draft' });
    }
  });

  router.post('/generate', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const { category, suggestedTitle, reason, ticketIds } = req.body;
    if (!category) { res.status(400).json({ ok: false, error: 'category is required' }); return; }
    try {
      const draft = await kbService.generateFromGap(
        category,
        suggestedTitle || null,
        reason || null,
        ticketIds || [],
        req.user.id,
      );
      res.json({ ok: true, data: draft });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate article' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const { title, body, labels } = req.body;
    if (!title || !body) { res.status(400).json({ ok: false, error: 'title and body are required' }); return; }
    try {
      await kbService.updateDraft(parseInt(String(req.params.id), 10), title, body, labels);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update draft' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      await kbService.deleteDraft(parseInt(String(req.params.id), 10));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to delete draft' });
    }
  });

  router.post('/:id/publish', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const result = await kbService.publishToConfluence(parseInt(String(req.params.id), 10));
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to publish' });
    }
  });

  return router;
}
