import { Router } from 'express';
import type { FeedbackQueries } from '../db/queries.js';

export function createFeedbackRoutes(feedbackQueries: FeedbackQueries): Router {
  const router = Router();

  // Submit feedback (any authenticated user)
  router.post('/', (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    const { type, title, description } = req.body;
    if (!type || !title) {
      res.status(400).json({ ok: false, error: 'type and title are required' });
      return;
    }
    if (!['bug', 'question', 'feature'].includes(type)) {
      res.status(400).json({ ok: false, error: 'type must be bug, question, or feature' });
      return;
    }

    const id = feedbackQueries.create({ user_id: userId, type, title, description });
    res.json({ ok: true, data: { id } });
  });

  // List all feedback (admin only)
  router.get('/', (req, res) => {
    const role = (req as any).user?.role;
    if (role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const status = req.query.status as string | undefined;
    const items = feedbackQueries.getAll(status ? { status } : undefined);
    res.json({ ok: true, data: items });
  });

  // Update feedback status (admin only)
  router.patch('/:id', (req, res) => {
    const role = (req as any).user?.role;
    if (role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!status) { res.status(400).json({ ok: false, error: 'status required' }); return; }

    feedbackQueries.updateStatus(id, status);
    res.json({ ok: true });
  });

  // Delete feedback (admin only)
  router.delete('/:id', (req, res) => {
    const role = (req as any).user?.role;
    if (role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    feedbackQueries.delete(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  return router;
}
