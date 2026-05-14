import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { trackEvent } from '../services/portal-analytics.js';
import type { PortalAnalyticsEventType, PortalAuthPayload } from '../../shared/portal-types.js';

const ALLOWED_CLIENT_EVENTS = new Set<PortalAnalyticsEventType>([
  'form_started', 'deflection', 'page_view', 'kb_search', 'kb_view',
]);

// SSE client registry per org
const sseClients = new Map<number, Set<Response>>();

export function broadcastPortalEvent(orgId: number, event: { type: string; ticketKey: string; data: Record<string, unknown> }): void {
  const clients = sseClients.get(orgId);
  if (!clients || clients.size === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function createPortalEventsRoutes(): Router {
  const router = Router();

  router.get('/events', (req: Request, res: Response) => {
    // EventSource can't send headers — accept token from query param for SSE
    if (!req.portalUser && req.query.token) {
      const token = req.query.token as string;
      const secrets = [
        process.env.PORTAL_JWT_SECRET,
        process.env.JWT_SECRET,
        'portal-default-secret',
      ].filter(Boolean) as string[];

      for (const secret of secrets) {
        try {
          const payload = jwt.verify(token, secret) as Record<string, unknown>;
          // Portal JWT has orgId; NOVA JWT has id+username
          if (payload.orgId) {
            req.portalUser = payload as unknown as PortalAuthPayload;
          } else if (payload.id && payload.username) {
            // NOVA JWT — minimal bridge (orgId 0 = internal)
            req.portalUser = {
              userId: payload.id as number,
              email: `${payload.username}@nurtur.tech`,
              orgId: 0,
              orgName: 'Nurtur Limited',
              role: 'admin',
            };
          }
          break;
        } catch { /* try next secret */ }
      }
    }
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }

    const orgId = req.portalUser.orgId;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    if (!sseClients.has(orgId)) sseClients.set(orgId, new Set());
    sseClients.get(orgId)!.add(res);

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      try { res.write(':ping\n\n'); } catch { clearInterval(keepAlive); }
    }, 30_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.get(orgId)?.delete(res);
      if (sseClients.get(orgId)?.size === 0) sseClients.delete(orgId);
    });
  });

  router.post('/analytics', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    const { event_type, metadata } = req.body ?? {};
    if (!event_type || !ALLOWED_CLIENT_EVENTS.has(event_type)) {
      res.status(400).json({ ok: false, error: 'Invalid event_type' });
      return;
    }
    try {
      await trackEvent(event_type, req.portalUser.userId, req.portalUser.orgId, metadata ?? {});
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'Failed to track event' });
    }
  });

  return router;
}
