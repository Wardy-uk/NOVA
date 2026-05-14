import { Router, type Request, type Response } from 'express';
import type { PortalChatService } from '../services/portal-chat.js';
import type { PortalJiraService } from '../services/portal-jira.js';
import { trackEvent } from '../services/portal-analytics.js';
import { queryOne } from '../services/database.js';

export function createPortalChatRoutes(chatService: PortalChatService, portalJira?: PortalJiraService): Router {
  const router = Router();

  router.post('/chat/sessions', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const session = await chatService.startSession(req.portalUser.userId);
      await trackEvent('intake_started', req.portalUser.userId, req.portalUser.orgId);
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

  router.post('/chat/sessions/:id/confirm', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }

    const { fields } = req.body;
    if (!fields || typeof fields !== 'object') {
      res.status(400).json({ ok: false, error: 'fields object is required' });
      return;
    }

    try {
      const org = await queryOne<{ name: string }>(
        `SELECT name FROM portal_organisations WHERE id = ?`,
        [req.portalUser.orgId],
      );

      const result = await chatService.confirmAndSubmit(
        parseInt(req.params.id as string, 10),
        fields,
        {
          orgName: org?.name || req.portalUser.orgName,
          userName: req.portalUser.email,
          userEmail: req.portalUser.email,
          orgId: req.portalUser.orgId,
          portalUserId: req.portalUser.userId,
        },
      );

      // Handle file attachments if present and portalJira supports it
      if (req.body.fileKeys && Array.isArray(req.body.fileKeys) && portalJira) {
        for (const fileKey of req.body.fileKeys) {
          try {
            // File upload is handled client-side via the existing attachment endpoint
            // after ticket creation — this is just a placeholder for future inline upload
            console.log(`[portal-chat] Attachment ${fileKey} queued for ${result.ticketKey}`);
          } catch (err) {
            console.warn(`[portal-chat] Attachment upload failed:`, err instanceof Error ? err.message : err);
          }
        }
      }

      res.json({ ok: true, data: { ticketKey: result.ticketKey } });
    } catch (err) {
      console.error('[portal-chat] Confirm failed:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create ticket' });
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
