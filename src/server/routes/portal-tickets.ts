import { Router, type Request, type Response } from 'express';
import Busboy from 'busboy';
import type { PortalJiraService } from '../services/portal-jira.js';
import type { PortalIntakeService } from '../services/portal-intake.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { PortalTicketCreateSchema } from '../../shared/portal-types.js';
import { trackEvent } from '../services/portal-analytics.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'xlsx', 'csv', 'txt', 'zip', 'log',
]);

export function createPortalTicketRoutes(
  portalJira: PortalJiraService,
  intakeService: PortalIntakeService,
  settings?: FileSettingsQueries,
): Router {
  const router = Router();

  router.get('/home-summary', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const orgOpenCount = await portalJira.getOrgOpenTicketCount(req.portalUser.orgId);
      const announcement = settings?.get('portal_announcement_html') || null;
      res.json({ ok: true, data: { orgOpenCount, announcement } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get summary' });
    }
  });

  router.get('/tickets', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const { status, page, pageSize, search, priority, dateRange } = req.query as Record<string, string>;
      const result = await portalJira.listTickets({
        orgId: req.portalUser.orgId,
        userId: req.query.mine === 'true' ? req.portalUser.userId : undefined,
        status: (status as 'open' | 'resolved' | 'all') || 'all',
        search: search || undefined,
        priority: priority || undefined,
        dateRange: (dateRange as 'today' | 'week' | 'month' | 'all') || undefined,
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

  router.get('/tickets/:key/attachments/:attachmentId', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const { body, contentType, contentLength, filename } = await portalJira.proxyAttachment(
        req.params.key as string,
        req.params.attachmentId as string,
        req.portalUser.orgId,
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const reader = body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(value);
        return pump();
      };
      await pump();
    } catch (err) {
      if (!res.headersSent) {
        res.status(404).json({ ok: false, error: err instanceof Error ? err.message : 'Attachment not found' });
      }
    }
  });

  router.post('/tickets/:key/attachments', (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }

    const ticketKey = req.params.key as string;
    const { userId, orgId } = req.portalUser;

    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE, files: 5 } });
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid multipart request' });
      return;
    }

    const uploads: Promise<void>[] = [];
    const results: string[] = [];
    const errors: string[] = [];
    let responded = false;

    busboy.on('file', (_fieldname: string, stream: NodeJS.ReadableStream & { on(event: 'limit', listener: () => void): void }, info: { filename: string; mimeType: string }) => {
      const { filename, mimeType } = info;
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        stream.resume();
        errors.push(`${filename}: file type .${ext} not allowed`);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      stream.on('limit', () => { truncated = true; });

      const done = new Promise<void>((resolve) => {
        stream.on('end', async () => {
          if (truncated) {
            errors.push(`${filename}: exceeds 10 MB limit`);
            resolve();
            return;
          }
          try {
            const buffer = Buffer.concat(chunks);
            await portalJira.uploadAttachment(ticketKey, orgId, filename, buffer, mimeType);
            results.push(filename);
            trackEvent('attachment_uploaded', userId, orgId, { ticket_key: ticketKey, filename }).catch(() => {});
          } catch (err) {
            console.error(`[portal-tickets] Attachment upload failed for ${filename}:`, err instanceof Error ? err.message : err);
            errors.push(`${filename}: upload failed`);
          }
          resolve();
        });
      });
      uploads.push(done);
    });

    busboy.on('finish', async () => {
      if (responded) return;
      responded = true;
      try {
        await Promise.all(uploads);
        if (results.length === 0 && errors.length > 0) {
          res.status(400).json({ ok: false, error: errors.join('; ') });
        } else {
          res.json({ ok: true, data: { uploaded: results, errors } });
        }
      } catch (err) {
        res.status(500).json({ ok: false, error: 'Attachment upload failed' });
      }
    });

    busboy.on('error', (err: Error) => {
      if (responded) return;
      responded = true;
      console.error('[portal-tickets] Busboy error:', err.message);
      res.status(500).json({ ok: false, error: 'File upload error' });
    });

    req.pipe(busboy);
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
