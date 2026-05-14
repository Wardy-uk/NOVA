import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import type { PortalChatService } from '../services/portal-chat.js';
import type { PortalJiraService } from '../services/portal-jira.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { trackEvent } from '../services/portal-analytics.js';
import { queryOne, execute } from '../services/database.js';

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

// Widget-specific routes (separate router, different auth model)
export function createWidgetChatRoutes(chatService: PortalChatService, settings: FileSettingsQueries): Router {
  const router = Router();

  // CORS middleware for widget routes
  router.use((req: Request, res: Response, next) => {
    const allowed = settings.get('portal_widget_allowed_origins') || '';
    const origin = req.headers.origin || '';
    const origins = allowed.split(',').map(o => o.trim()).filter(Boolean);

    if (origins.length === 0 || origins.includes(origin) || origins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });

  // Identify by email — upsert user, return short-lived token + session
  router.post('/identify', async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ ok: false, error: 'Valid email is required' });
      return;
    }

    try {
      const domain = email.split('@')[1];

      // Find or create org by domain
      let org = await queryOne<{ id: number; name: string }>(
        `SELECT id, name FROM portal_organisations WHERE domain = ?`,
        [domain],
      );
      if (!org) {
        org = await queryOne<{ id: number; name: string }>(
          `INSERT INTO portal_organisations (external_id, name, domain)
           OUTPUT INSERTED.id, INSERTED.name VALUES (?, ?, ?)`,
          [`widget_${domain}`, domain, domain],
        );
      }

      // Find or create user
      let user = await queryOne<{ id: number }>(
        `SELECT id FROM portal_users WHERE email = ?`,
        [email],
      );
      if (!user) {
        user = await queryOne<{ id: number }>(
          `INSERT INTO portal_users (external_id, org_id, email, display_name, role)
           OUTPUT INSERTED.id VALUES (?, ?, ?, ?, 'requester')`,
          [`widget_${email}`, org!.id, email, email.split('@')[0]],
        );
      }

      // Start a chat session
      const session = await chatService.startSession(user!.id);

      // Issue a short-lived widget token (1h)
      const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';
      const token = jwt.sign(
        { userId: user!.id, email, orgId: org!.id, orgName: org!.name, role: 'requester', widget: true },
        secret,
        { expiresIn: '1h' },
      );

      res.json({ ok: true, data: { token, sessionId: session.id } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Identification failed' });
    }
  });

  // Chat message via widget token
  router.post('/chat', async (req: Request, res: Response) => {
    const { token, sessionId, message } = req.body;
    if (!token || !message) {
      res.status(400).json({ ok: false, error: 'token and message are required' });
      return;
    }

    try {
      const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';
      const payload = jwt.verify(token, secret) as { userId: number; email: string; orgId: number; orgName: string };

      const org = await queryOne<{ name: string }>(
        `SELECT name FROM portal_organisations WHERE id = ?`,
        [payload.orgId],
      );

      const result = await chatService.sendMessage(
        sessionId,
        message,
        {
          orgName: org?.name || payload.orgName,
          userName: payload.email,
          userEmail: payload.email,
          orgId: payload.orgId,
          portalUserId: payload.userId,
        },
      );

      res.json({ ok: true, data: { reply: result.content, sessionId } });
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ ok: false, error: 'Invalid or expired token' });
        return;
      }
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Chat failed' });
    }
  });

  return router;
}
