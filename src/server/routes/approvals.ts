import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApprovalQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { CustomRole } from '../middleware/auth.js';

export function createApprovalRoutes(
  approvalQueries: ApprovalQueries,
  settingsQueries: FileSettingsQueries,
): Router {
  const router = Router();

  // Check if user is an AI approver (has edit access to 'ai_approvals' area)
  function isApprover(req: Request): boolean {
    const user = (req as any).user;
    if (!user) return false;
    if (user.role === 'admin') return true;

    const rolesRaw = settingsQueries.get('custom_roles');
    if (!rolesRaw) return false;
    try {
      const roles: CustomRole[] = JSON.parse(rolesRaw);
      const userRoles = (user.role || '').split(',').map((r: string) => r.trim());
      for (const role of roles) {
        if (userRoles.includes(role.id) && role.areas?.ai_approvals === 'edit') {
          return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  // GET /api/approvals — list approvals
  router.get('/', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const items = approvalQueries.getAll(status);
    const canInteract = isApprover(req);
    res.json({ ok: true, data: { items, canInteract } });
  });

  // GET /api/approvals/stats — get approval stats
  router.get('/stats', (_req: Request, res: Response) => {
    const stats = approvalQueries.getStats();
    res.json({ ok: true, data: stats });
  });

  // GET /api/approvals/count — get pending count (for badge)
  router.get('/count', (_req: Request, res: Response) => {
    const count = approvalQueries.getPendingCount();
    res.json({ ok: true, data: { count } });
  });

  // GET /api/approvals/:id — get single approval
  router.get('/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid ID' }); return; }
    const item = approvalQueries.getById(id);
    if (!item) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    const canInteract = isApprover(req);
    res.json({ ok: true, data: { item, canInteract } });
  });

  // POST /api/approvals/:id/decide — approve or decline
  router.post('/:id/decide', async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!isApprover(req)) {
      res.status(403).json({ ok: false, error: 'You do not have AI Approver permissions' });
      return;
    }

    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid ID' }); return; }

    const { action, editedResponse } = req.body;
    if (!action || !['approve', 'decline'].includes(action)) {
      res.status(400).json({ ok: false, error: 'action must be "approve" or "decline"' });
      return;
    }

    const item = approvalQueries.getById(id);
    if (!item) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    if (item.status !== 'pending') {
      res.status(409).json({ ok: false, error: `Already ${item.status}` });
      return;
    }

    // Update local status
    const updated = approvalQueries.decide(id, action === 'approve' ? 'approved' : 'declined', user.username, editedResponse);
    if (!updated) {
      res.status(500).json({ ok: false, error: 'Failed to update' });
      return;
    }

    // Hit the n8n resume URL to continue the workflow
    try {
      const resumeUrl = `${item.resume_url}?action=${action}`;
      const response = await fetch(resumeUrl, { method: 'GET' });
      if (!response.ok) {
        console.warn(`[Approvals] n8n resume returned ${response.status} for approval ${id}`);
      }
    } catch (err) {
      console.error(`[Approvals] Failed to hit n8n resume URL for approval ${id}:`, err instanceof Error ? err.message : err);
      // Don't fail the request — the decision is recorded locally even if n8n resume fails
    }

    res.json({ ok: true, data: { id, status: action === 'approve' ? 'approved' : 'declined' } });
  });

  return router;
}
