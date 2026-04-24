import { Router } from 'express';
import type { NotificationQueries } from '../db/notifications.js';
import type { NotificationEngine } from '../services/notification-engine.js';

export function createNotificationRoutes(
  notificationQueries: NotificationQueries,
  notificationEngine: NotificationEngine,
): Router {
  const router = Router();

  // GET /api/notifications — list notifications for current user
  router.get('/', async (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const notifications = await notificationQueries.getForUser(userId, limit);
    const unreadCount = await notificationQueries.getUnreadCount(userId);
    res.json({ ok: true, data: notifications, unreadCount });
  });

  // GET /api/notifications/count — just the unread count (lightweight)
  router.get('/count', async (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    res.json({ ok: true, count: await notificationQueries.getUnreadCount(userId) });
  });

  // PUT /api/notifications/:id/read — mark one as read
  router.put('/:id/read', async (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const id = parseInt(req.params.id, 10);
    await notificationQueries.markRead(id, userId);
    res.json({ ok: true });
  });

  // PUT /api/notifications/read-all — mark all as read
  router.put('/read-all', async (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const count = await notificationQueries.markAllRead(userId);
    res.json({ ok: true, count });
  });

  // POST /api/notifications/check — trigger notification generation (5s timeout)
  router.post('/check', async (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    try {
      const result = await Promise.race([
        notificationEngine.checkAndCreate(userId),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ]);
      if (result === 'timeout') {
        console.warn('[notifications] /check timed out after 5s for user', userId);
        res.json({ ok: true, created: 0, timedOut: true });
        return;
      }
      res.json({ ok: true, created: result });
    } catch (err) {
      console.error('[notifications] /check error:', err);
      res.json({ ok: true, created: 0 });
    }
  });

  return router;
}
