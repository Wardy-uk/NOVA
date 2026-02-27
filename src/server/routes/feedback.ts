import { Router } from 'express';
import type { FeedbackQueries, TaskQueries } from '../db/queries.js';
import { saveDb } from '../db/schema.js';

export function createFeedbackRoutes(feedbackQueries: FeedbackQueries, taskQueries?: TaskQueries): Router {
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

  // Reply to feedback (admin only)
  router.post('/:id/reply', (req, res) => {
    const role = (req as any).user?.role;
    if (role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const id = parseInt(req.params.id, 10);
    const adminUserId = (req as any).user?.id;
    const { reply } = req.body;
    if (!reply?.trim()) { res.status(400).json({ ok: false, error: 'reply is required' }); return; }

    feedbackQueries.reply(id, reply.trim(), adminUserId);
    const updated = feedbackQueries.getById(id);
    res.json({ ok: true, data: updated });
  });

  // Create task from feedback (admin only)
  router.post('/:id/to-task', (req, res) => {
    const role = (req as any).user?.role;
    if (role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    if (!taskQueries) { res.status(503).json({ ok: false, error: 'Task system not available' }); return; }

    const id = parseInt(req.params.id, 10);
    const feedback = feedbackQueries.getById(id);
    if (!feedback) { res.status(404).json({ ok: false, error: 'Feedback not found' }); return; }

    // Create a task from this feedback
    taskQueries.upsertFromSource({
      source: 'feedback',
      source_id: `feedback-${id}`,
      title: `[${feedback.type}] ${feedback.title}`,
      description: feedback.description ?? undefined,
      status: 'open',
      priority: feedback.type === 'bug' ? 70 : 50,
      category: 'internal',
    });
    saveDb();

    // Link feedback to the task
    const task = taskQueries.getById(`feedback:feedback-${id}`);
    if (task) {
      feedbackQueries.linkTask(id, parseInt(task.id.replace('feedback:', ''), 10) || id);
    }

    res.json({ ok: true, data: { taskCreated: true } });
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
