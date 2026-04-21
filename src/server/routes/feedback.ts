import { Router } from 'express';
import type { FeedbackQueries, TaskQueries } from '../db/queries.js';
import type { FileUserQueries } from '../db/user-store.js';
import type { NotificationQueries } from '../db/notifications.js';
import { isAdmin } from '../utils/role-helpers.js';

export function createFeedbackRoutes(feedbackQueries: FeedbackQueries, taskQueries?: TaskQueries, userQueries?: FileUserQueries, notificationQueries?: NotificationQueries): Router {
  const router = Router();

  /** Enrich feedback items with username from the file-based user store */
  function enrichWithUsernames<T extends { user_id: number; username?: string }>(items: T[]): T[] {
    if (!userQueries) return items;
    for (const item of items) {
      if (!item.username) {
        const user = userQueries.getById(item.user_id);
        if (user) item.username = user.display_name || user.username;
      }
    }
    return items;
  }

  // Submit feedback (any authenticated user)
  router.post('/', async (req, res) => {
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

    const id = await feedbackQueries.create({ user_id: userId, type, title, description });
    res.json({ ok: true, data: { id } });
  });

  // Get current user's own feedback
  router.get('/mine', async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const hideResolved = req.query.hideResolved === 'true';
    const items = await feedbackQueries.getByUser(userId, { hideResolved });
    res.json({ ok: true, data: items });
  });

  // List all feedback (admin only)
  router.get('/', async (req, res) => {
    const role = (req as any).user?.role;
    if (!isAdmin(role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const status = req.query.status as string | undefined;
    const items = await feedbackQueries.getAll(status ? { status } : undefined);
    res.json({ ok: true, data: enrichWithUsernames(items) });
  });

  // Reply to feedback (admin only)
  router.post('/:id/reply', async (req, res) => {
    const role = (req as any).user?.role;
    if (!isAdmin(role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const id = parseInt(req.params.id, 10);
    const adminUserId = (req as any).user?.id;
    const { reply } = req.body;
    if (!reply?.trim()) { res.status(400).json({ ok: false, error: 'reply is required' }); return; }

    await feedbackQueries.reply(id, reply.trim(), adminUserId);
    const updated = await feedbackQueries.getById(id);
    if (updated) enrichWithUsernames([updated]);

    // Notify the feedback author that they received a reply
    if (updated && notificationQueries) {
      const truncatedReply = reply.trim().length > 80 ? reply.trim().slice(0, 80) + '...' : reply.trim();
      await notificationQueries.create({
        user_id: updated.user_id,
        type: 'feedback_reply',
        title: 'Your feedback received a reply',
        message: `"${updated.title}" — ${truncatedReply}`,
        entity_type: 'feedback',
        entity_id: String(id),
      });
    }

    res.json({ ok: true, data: updated });
  });

  // Create task from feedback (admin only)
  router.post('/:id/to-task', async (req, res) => {
    const role = (req as any).user?.role;
    if (!isAdmin(role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    if (!taskQueries) { res.status(503).json({ ok: false, error: 'Task system not available' }); return; }

    const id = parseInt(req.params.id, 10);
    const feedback = await feedbackQueries.getById(id);
    if (!feedback) { res.status(404).json({ ok: false, error: 'Feedback not found' }); return; }

    // Create a task from this feedback
    await taskQueries.upsertFromSource({
      source: 'feedback',
      source_id: `feedback-${id}`,
      title: `[${feedback.type}] ${feedback.title}`,
      description: feedback.description ?? undefined,
      status: 'open',
      priority: feedback.type === 'bug' ? 70 : 50,
      category: 'internal',
    });

    // Link feedback to the task
    const task = await taskQueries.getById(`feedback:feedback-${id}`);
    if (task) {
      await feedbackQueries.linkTask(id, parseInt(task.id.replace('feedback:', ''), 10) || id);
    }

    res.json({ ok: true, data: { taskCreated: true } });
  });

  // Update feedback status (admin only)
  router.patch('/:id', async (req, res) => {
    const role = (req as any).user?.role;
    if (!isAdmin(role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!status) { res.status(400).json({ ok: false, error: 'status required' }); return; }

    await feedbackQueries.updateStatus(id, status);
    res.json({ ok: true });
  });

  // Delete feedback (admin only)
  router.delete('/:id', async (req, res) => {
    const role = (req as any).user?.role;
    if (!isAdmin(role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    await feedbackQueries.delete(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  return router;
}
