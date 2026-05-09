import { Router, type Request, type Response } from 'express';
import type { PortalJiraService } from '../services/portal-jira.js';
import type { PortalIntakeService } from '../services/portal-intake.js';
import { PortalTicketCreateSchema } from '../../shared/portal-types.js';
import { trackEvent } from '../services/portal-analytics.js';

export function createPortalTicketRoutes(
  portalJira: PortalJiraService,
  intakeService: PortalIntakeService,
): Router {
  const router = Router();

  router.get('/tickets', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const { status, page, pageSize, search } = req.query as Record<string, string>;
      const result = await portalJira.listTickets({
        orgId: req.portalUser.orgId,
        userId: req.query.mine === 'true' ? req.portalUser.userId : undefined,
        status: (status as 'open' | 'resolved' | 'all') || 'all',
        search: search || undefined,
        page: parseInt(page, 10) || 1,
        pageSize: parseInt(pageSize, 10) || 20,
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list tickets' });
    }
  });

  router.get('/tickets/:key', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const detail = await portalJira.getTicketDetail(req.params.key as string, req.portalUser.orgId);
      if (!detail) { res.status(404).json({ ok: false, error: 'Ticket not found' }); return; }
      res.json({ ok: true, data: detail });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get ticket' });
    }
  });

  router.post('/tickets/:key/comments', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    const { body } = req.body;
    if (!body || typeof body !== 'string') {
      res.status(400).json({ ok: false, error: 'body is required' });
      return;
    }
    try {
      await portalJira.addComment(req.params.key as string, req.portalUser.orgId, body, req.portalUser.email);
      await trackEvent('comment_added', req.portalUser.userId, req.portalUser.orgId, { ticket_key: req.params.key });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to add comment' });
    }
  });

  router.post('/tickets', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }

    const parsed = PortalTicketCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') });
      return;
    }

    try {
      const result = await intakeService.submitTicket(
        parsed.data,
        req.portalUser.userId,
        req.portalUser.orgId,
        req.portalUser.email,
        req.portalUser.orgName,
      );
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create ticket' });
    }
  });

  router.get('/categories', async (req: Request, res: Response) => {
    try {
      const categories = await intakeService.getCategories();
      res.json({ ok: true, data: categories });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load categories' });
    }
  });

  return router;
}
