import { Router, type Request, type Response } from 'express';
import type { PortalChatService } from '../services/portal-chat.js';
import { trackEvent } from '../services/portal-analytics.js';
import { queryOne } from '../services/database.js';

export function createPortalChatRoutes(chatService: PortalChatService): Router {
  const router = Router();

  router.post('/chat/sessions', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const session = await chatService.startSession(req.portalUser.userId);
      await trackEvent('chat_started', req.portalUser.userId, req.portalUser.orgId);
      res.json({ ok: true, data: session });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to start session' });
    }
  });

  router.post('/chat/sessions/:id/messages', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      res.status(400).json({ ok: false, error: 'content is required' });
      return;
    }

    try {
      // Get org name for context
      const org = await queryOne<{ name: string }>(
        `SELECT name FROM portal_organisations WHERE id = ?`,
        [req.portalUser.orgId],
      );

      const message = await chatService.sendMessage(
        parseInt(req.params.id as string, 10),
        content,
        {
          orgName: org?.name || req.portalUser.orgName,
          userName: req.portalUser.email,
          userEmail: req.portalUser.email,
          orgId: req.portalUser.orgId,
          portalUserId: req.portalUser.userId,
        },
      );
      res.json({ ok: true, data: message });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send message' });
    }
  });

  router.get('/chat/sessions/:id', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const result = await chatService.getSession(parseInt(req.params.id as string, 10), req.portalUser.userId);
      if (!result) { res.status(404).json({ ok: false, error: 'Session not found' }); return; }
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get session' });
    }
  });

  router.get('/chat/sessions', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const sessions = await chatService.listSessions(req.portalUser.userId);
      res.json({ ok: true, data: sessions });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list sessions' });
    }
  });

  router.post('/chat/sessions/:id/end', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      await chatService.endSession(parseInt(req.params.id as string, 10));
      await trackEvent('chat_resolved', req.portalUser.userId, req.portalUser.orgId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to end session' });
    }
  });

  return router;
}
