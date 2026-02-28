import { Router } from 'express';
import type { NotificationQueries } from '../db/notifications.js';
import type { NotificationEngine } from '../services/notification-engine.js';

export function createNotificationRoutes(
  notificationQueries: NotificationQueries,
  notificationEngine: NotificationEngine,
): Router {
  const router = Router();

  // GET /api/notifications — list notifications for current user
  router.get('/', (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const notifications = notificationQueries.getForUser(userId, limit);
    const unreadCount = notificationQueries.getUnreadCount(userId);
    res.json({ ok: true, data: notifications, unreadCount });
  });

  // GET /api/notifications/count — just the unread count (lightweight)
  router.get('/count', (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    res.json({ ok: true, count: notificationQueries.getUnreadCount(userId) });
  });

  // PUT /api/notifications/:id/read — mark one as read
  router.put('/:id/read', (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const id = parseInt(req.params.id, 10);
    notificationQueries.markRead(id, userId);
    res.json({ ok: true });
  });

  // PUT /api/notifications/read-all — mark all as read
  router.put('/read-all', (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const count = notificationQueries.markAllRead(userId);
    res.json({ ok: true, count });
  });

  // POST /api/notifications/check — trigger notification generation
  router.post('/check', (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const created = notificationEngine.checkAndCreate(userId);
    res.json({ ok: true, created });
  });

  return router;
}
