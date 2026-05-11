import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApprovalQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { CustomRole } from '../middleware/auth.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';

const QUICK_RESOLVE_TRANSITION_ID = '17';

export type ApprovalCallbackFn = (
  action: string, ticketKey: string, approvalId?: number,
  editedResponse?: string, decidedBy?: string,
) => Promise<void>;

export function createApprovalRoutes(
  approvalQueries: ApprovalQueries,
  settingsQueries: FileSettingsQueries,
  jiraClient?: JiraRestClient,
  onApprovalCallback?: ApprovalCallbackFn,
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
  router.get('/', async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const items = await approvalQueries.getAll(status);
    const canInteract = isApprover(req);
    res.json({ ok: true, data: { items, canInteract } });
  });

  // GET /api/approvals/stats — get approval stats
  router.get('/stats', async (_req: Request, res: Response) => {
    const stats = await approvalQueries.getStats();
    res.json({ ok: true, data: stats });
  });

  // GET /api/approvals/count — get pending count (for badge)
  router.get('/count', async (_req: Request, res: Response) => {
    const count = await approvalQueries.getPendingCount();
    res.json({ ok: true, data: { count } });
  });

  // GET /api/approvals/by-ticket/:ticketId — find pending approval for a ticket
  router.get('/by-ticket/:ticketId', async (req: Request, res: Response) => {
    const item = await approvalQueries.getPendingByTicket(req.params.ticketId as string);
    if (!item) { res.json({ ok: true, data: null }); return; }
    const canInteract = isApprover(req);
    res.json({ ok: true, data: { item, canInteract } });
  });

  // GET /api/approvals/:id — get single approval
  router.get('/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid ID' }); return; }
    const item = await approvalQueries.getById(id);
    if (!item) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    const canInteract = isApprover(req);
    res.json({ ok: true, data: { item, canInteract } });
  });

  // POST /api/approvals/bulk-decline — decline all pending approvals
  router.post('/bulk-decline', async (req: Request, res: Response) => {
    if (!isApprover(req)) {
      res.status(403).json({ ok: false, error: 'You do not have AI Approver permissions' });
      return;
    }
    const user = (req as any).user;
    const reason = req.body?.reason || 'Bulk declined';
    const pending = await approvalQueries.getPending();
    let declined = 0;
    for (const item of pending) {
      const ok = await approvalQueries.decide(item.id, 'declined', user.username, undefined, reason);
      if (ok) declined++;
    }
    res.json({ ok: true, data: { declined, total: pending.length } });
  });

  // POST /api/approvals/:id/decide — approve or decline
  router.post('/:id/decide', async (req: Request, res: Response) => {
    const user = (req as any).user;

    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid ID' }); return; }

    const { action, editedResponse, declineReason } = req.body;
    if (!action || !['approve', 'decline', 'cancel'].includes(action)) {
      res.status(400).json({ ok: false, error: 'action must be "approve", "decline", or "cancel"' });
      return;
    }

    // Decline requires a reason
    if (action === 'decline' && (!declineReason || !declineReason.trim())) {
      res.status(400).json({ ok: false, error: 'A reason is required when declining' });
      return;
    }

    // Cancel (dismiss) is allowed for any authenticated user; approve/decline requires approver permissions
    if (action !== 'cancel' && !isApprover(req)) {
      res.status(403).json({ ok: false, error: 'You do not have AI Approver permissions' });
      return;
    }

    const item = await approvalQueries.getById(id);
    if (!item) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    if (item.status !== 'pending') {
      res.status(409).json({ ok: false, error: `Already ${item.status}` });
      return;
    }

    // Update local status
    const statusMap: Record<string, string> = { approve: 'approved', decline: 'declined', cancel: 'cancelled' };
    const newStatus = statusMap[action] as 'approved' | 'declined' | 'cancelled';
    const updated = await approvalQueries.decide(id, newStatus, user.username, editedResponse, action === 'decline' ? declineReason.trim() : undefined);
    if (!updated) {
      res.status(500).json({ ok: false, error: 'Failed to update' });
      return;
    }

    // Hit the n8n resume URL to continue the workflow (n8n-sourced approvals only)
    if (action !== 'cancel' && item.resume_url) {
      try {
        const resumeUrl = `${item.resume_url}${item.resume_url.includes('?') ? '&' : '?'}action=${action}&approvalId=${id}&decidedBy=${encodeURIComponent(user.username)}`;
        const response = await fetch(resumeUrl, { method: 'GET' });
        if (!response.ok) {
          console.warn(`[Approvals] n8n resume returned ${response.status} for approval ${id}`);
        }
      } catch (err) {
        console.error(`[Approvals] Failed to hit n8n resume URL for approval ${id}:`, err instanceof Error ? err.message : err);
      }
    }

    // For abuse report approvals: transition the Jira ticket to Resolved
    if (item.action_type === 'abuse_report' && action === 'approve' && item.ticket_id && jiraClient) {
      try {
        const novaAccountId = settingsQueries.get('nova_ai_jira_account_id');
        if (novaAccountId) {
          await jiraClient.updateFields(item.ticket_id, { assignee: { accountId: novaAccountId } });
        }
        const { fields, comment } = buildResolveFields({
          tldr: 'Abuse report approved and processed by NOVA',
          resolution: 'Done',
          comment: `Abuse report approved by ${user.username}. Processed automatically.`,
        });
        await jiraClient.transitionIssue(item.ticket_id, QUICK_RESOLVE_TRANSITION_ID, { fields, comment });
        console.log(`[Approvals] Resolved Jira ticket ${item.ticket_id} after abuse report approval`);
      } catch (err) {
        console.error(`[Approvals] Failed to resolve Jira ticket ${item.ticket_id}:`, err instanceof Error ? err.message : err);
      }
    }

    // For draft_response approvals: post reply to Jira via agent callback
    if (item.action_type !== 'abuse_report' && action !== 'cancel' && item.ticket_id && onApprovalCallback) {
      try {
        const responseText = editedResponse || item.ai_response_adf || '';
        await onApprovalCallback(action, item.ticket_id, id, responseText, user.username);
      } catch (err) {
        console.error(`[Approvals] Agent callback failed for ${item.ticket_id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ ok: false, error: `Approval saved but Jira action failed: ${err instanceof Error ? err.message : 'unknown error'}` });
        return;
      }
    }

    res.json({ ok: true, data: { id, status: newStatus } });
  });

  return router;
}
