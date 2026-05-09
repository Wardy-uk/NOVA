import { Router, type Request, type Response } from 'express';

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

  return router;
}
