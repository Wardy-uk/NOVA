import { Router, type Request, type Response } from 'express';
import Busboy from 'busboy';
import type { PortalJiraService } from '../services/portal-jira.js';
import type { PortalIntakeService } from '../services/portal-intake.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { PortalTicketCreateSchema, PortalNetworkRequestSchema, PortalOnboardingRequestSchema, PortalMembershipApplicationSchema, PortalOnboardingSetupSchema } from '../../shared/portal-types.js';
import { trackEvent } from '../services/portal-analytics.js';
import { query } from '../services/database.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'xlsx', 'csv', 'txt', 'zip', 'log',
]);

// Portal role → the access level the onboarding form offers.
const ACCESS_LEVEL_BY_ROLE: Record<string, string> = {
  admin: 'Client Admin', org_admin: 'Client Admin',
  manager: 'Office Admin', leader: 'Office Admin',
  requester: 'Agent',
};

export function createPortalTicketRoutes(
  portalJira: PortalJiraService,
  intakeService: PortalIntakeService,
  settings?: FileSettingsQueries,
  llm?: import('../services/llm-service.js').LlmService | null,
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
      const detail = await portalJira.getTicketDetail(req.params.key as string, {
        orgId: req.portalUser.orgId,
        email: req.portalUser.email,
        role: req.portalUser.role,
      });
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

  // Guild / Fine & Country "Raise a ticket" intake → NT via JSM Service Desk API.
  router.post('/requests', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }

    const parsed = PortalNetworkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') });
      return;
    }

    try {
      const result = await intakeService.submitNetworkRequest(
        parsed.data,
        req.portalUser.userId,
        req.portalUser.orgId,
        req.portalUser.email,
      );
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to raise ticket' });
    }
  });

  // Onboarding Request → setup ticket + linked QA ticket.
  router.post('/onboarding-requests', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }

    const parsed = PortalOnboardingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') });
      return;
    }

    try {
      const result = await intakeService.submitOnboardingRequest(
        parsed.data,
        req.portalUser.userId,
        req.portalUser.orgId,
        req.portalUser.email,
        req.portalUser.orgName,
      );
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit onboarding request' });
    }
  });

  // Two-stage Guild onboarding (backlog #8).
  // Step 1 — Membership Application (record only, no tickets).
  router.post('/onboarding/application', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    const parsed = PortalMembershipApplicationSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') }); return; }
    try {
      const result = await intakeService.submitMembershipApplication(parsed.data, req.portalUser.userId, req.portalUser.orgId, req.portalUser.email, req.portalUser.orgName);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit application' });
    }
  });

  // Step 2 — Setup form (Standard / Multi-branch): attaches + fires tickets + SLA.
  // Multipart: 'payload' (JSON) + optional 'form' file (the imported Guild form,
  // attached to the QA ticket + onboarding email).
  router.post('/onboarding/setup', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    const pu = req.portalUser;
    let bb: ReturnType<typeof Busboy>;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE, files: 1 } }); }
    catch { res.status(400).json({ ok: false, error: 'Invalid upload' }); return; }
    let payloadRaw = '';
    let fileBuf: Buffer | null = null, filename = '', mimeType = '', tooBig = false;
    bb.on('field', (n: string, v: string) => { if (n === 'payload') payloadRaw = v; });
    bb.on('file', (_f: string, stream: NodeJS.ReadableStream & { on(e: 'limit', l: () => void): void }, info: { filename: string; mimeType: string }) => {
      filename = info.filename || 'form'; mimeType = info.mimeType || 'application/octet-stream';
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => { tooBig = true; });
      stream.on('end', () => { fileBuf = Buffer.concat(chunks); });
    });
    bb.on('finish', async () => {
      if (tooBig) { res.status(400).json({ ok: false, error: 'Attached form too large (max 10 MB).' }); return; }
      let body: unknown;
      try { body = JSON.parse(payloadRaw || '{}'); } catch { res.status(400).json({ ok: false, error: 'Invalid payload' }); return; }
      const parsed = PortalOnboardingSetupSchema.safeParse(body);
      if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues.map(i => i.message).join(', ') }); return; }
      const formFile = fileBuf ? { buffer: fileBuf, filename, mimeType } : null;
      try {
        const result = await intakeService.submitGuildSetup(parsed.data, pu.userId, pu.orgId, pu.email, pu.orgName, formFile);
        res.json({ ok: true, data: result });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit setup form' });
      }
    });
    bb.on('error', () => { if (!res.headersSent) res.status(400).json({ ok: false, error: 'Upload error' }); });
    req.pipe(bb);
  });

  // Import a Guild form (PDF/xlsx) → extract + LLM-map → pre-fill fields.
  router.post('/onboarding/import', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    if (!llm) { res.status(503).json({ ok: false, error: 'AI extraction is not configured.' }); return; }
    let formType: 'application' | 'setup' = 'application';
    let fileBuf: Buffer | null = null;
    let filename = '';
    let tooBig = false;
    let bb: ReturnType<typeof Busboy>;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE, files: 1 } }); }
    catch { res.status(400).json({ ok: false, error: 'Invalid upload' }); return; }
    bb.on('field', (name: string, val: string) => { if (name === 'formType' && (val === 'application' || val === 'setup')) formType = val; });
    bb.on('file', (_f: string, stream: NodeJS.ReadableStream & { on(e: 'limit', l: () => void): void }, info: { filename: string }) => {
      filename = info.filename || '';
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => { tooBig = true; });
      stream.on('end', () => { fileBuf = Buffer.concat(chunks); });
    });
    bb.on('finish', async () => {
      if (tooBig) { res.status(400).json({ ok: false, error: 'File too large (max 10 MB).' }); return; }
      if (!fileBuf) { res.status(400).json({ ok: false, error: 'No file uploaded.' }); return; }
      try {
        const { importGuildForm } = await import('../services/guild-form-import.js');
        const data = await importGuildForm(fileBuf, filename, formType, llm);
        res.json({ ok: true, data });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Import failed' });
      }
    });
    bb.on('error', () => { if (!res.headersSent) res.status(400).json({ ok: false, error: 'Upload error' }); });
    req.pipe(bb);
  });

  // The org's "include in setup" users, shaped for the onboarding form's "Users
  // to set up" grid. Pre-filling them means the team edits/deletes rather than
  // retypes every Guild user (customer feedback, Aug 2026).
  router.get('/onboarding/setup-users', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const rows = await query<{ display_name: string; email: string; role: string }>(
        `SELECT display_name, email, role FROM portal_users
         WHERE org_id = ? AND include_in_setup = 1 AND access_state <> 'removed'
         ORDER BY display_name`,
        [req.portalUser.orgId],
      );
      res.json({
        ok: true,
        data: rows.map(u => ({
          name: u.display_name || '',
          email: u.email,
          accessLevel: ACCESS_LEVEL_BY_ROLE[u.role] || 'Agent',
          jobTitle: '',
        })),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load users' });
    }
  });

  // Application-stage records the setup form can attach to.
  router.get('/onboarding/open-applications', async (req: Request, res: Response) => {
    if (!req.portalUser) { res.status(401).json({ ok: false }); return; }
    try {
      const data = await intakeService.listOpenApplications(req.portalUser.orgId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load applications' });
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
