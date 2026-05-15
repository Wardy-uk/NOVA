import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApprovalQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { CustomRole } from '../middleware/auth.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import { query } from '../services/database.js';
import { buildBcClient } from '../services/bc-client.js';

const QUICK_RESOLVE_TRANSITION_ID = '17';

export type ApprovalCallbackFn = (
  action: string, ticketKey: string, approvalId?: number,
  editedResponse?: string, decidedBy?: string,
) => Promise<void>;

export type ReReviewFn = (
  approvalId: number, declineReason: string, requestedBy: string,
) => Promise<{ ok: boolean; newApprovalId?: number; error?: string }>;

export function createApprovalRoutes(
  approvalQueries: ApprovalQueries,
  settingsQueries: FileSettingsQueries,
  jiraClient?: JiraRestClient,
  onApprovalCallback?: ApprovalCallbackFn,
  onReReview?: ReReviewFn,
): Router {
  const router = Router();

  // Check if user is an AI approver (has edit access to 'ai_approvals' area)
  function isApprover(req: Request): boolean {
    const user = (req as any).user;
    if (!user) return false;
    if ((user.role || '').split(',').some((r: string) => r.trim() === 'admin' || r.trim() === 'super_admin')) return true;

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

    // Ensure assignee_name and bc_account_number are always present
    for (const item of items) {
      (item as any).assignee_name = null;
      (item as any).bc_account_number = null;
    }

    // Enrich with assignee from Jira cache
    const ticketKeys = items.map(i => i.ticket_id).filter(Boolean);
    if (ticketKeys.length > 0) {
      try {
        const placeholders = ticketKeys.map(() => '?').join(',');
        const rows = await query<{ issue_key: string; assignee_display: string | null; bc_account_number: string | null }>(
          `SELECT issue_key, assignee_display, bc_account_number FROM jira_issue_cache WHERE issue_key IN (${placeholders})`,
          ticketKeys,
        );
        const cacheMap = new Map(rows.map(r => [r.issue_key, r]));
        for (const item of items) {
          const cached = cacheMap.get(item.ticket_id);
          (item as any).assignee_name = cached?.assignee_display ?? null;
          (item as any).bc_account_number = cached?.bc_account_number ?? null;
        }
      } catch { /* cache miss is fine — assignee stays null */ }
    }

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

  // GET /api/approvals/mine — approvals assigned to the current user's tickets (My Tickets)
  router.get('/mine', async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    // Resolve Jira account ID from agent_roster via email or display_name
    let jiraAccountId: string | null = null;
    try {
      const roster = user.email
        ? await query<{ jira_account_id: string }>(
            `SELECT jira_account_id FROM agent_roster WHERE email = ? AND active = 1`,
            [user.email],
          ).then(rows => rows[0] ?? null)
        : null;
      if (roster) {
        jiraAccountId = roster.jira_account_id;
      } else {
        const displayName = user.display_name ?? user.username;
        const fallback = await query<{ jira_account_id: string }>(
          `SELECT jira_account_id FROM agent_roster WHERE display_name = ? AND active = 1`,
          [displayName],
        ).then(rows => rows[0] ?? null);
        jiraAccountId = fallback?.jira_account_id ?? null;
      }
    } catch { /* roster lookup failed */ }

    if (!jiraAccountId) {
      res.json({ ok: true, data: { items: [], canInteract: false } });
      return;
    }

    const status = req.query.status as string | undefined;
    const items = await approvalQueries.getByAgent(jiraAccountId, status);
    const canInteract = isApprover(req);
    res.json({ ok: true, data: { items, canInteract } });
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
        let responseText = editedResponse || item.ai_response_adf || '';
        // Safety: extract draft_response if the stored value is a full JSON blob
        if (responseText && responseText.trim().startsWith('{') && responseText.includes('"draft_response"')) {
          try {
            const parsed = JSON.parse(responseText.trim());
            if (parsed.draft_response) {
              console.warn(`[Approvals] Extracted draft_response from JSON blob for ${item.ticket_id}`);
              responseText = parsed.draft_response;
            }
          } catch { /* not valid JSON, use as-is */ }
        }
        await onApprovalCallback(action, item.ticket_id, id, responseText, user.username);
      } catch (err) {
        console.error(`[Approvals] Agent callback failed for ${item.ticket_id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ ok: false, error: `Approval saved but Jira action failed: ${err instanceof Error ? err.message : 'unknown error'}` });
        return;
      }
    }

    res.json({ ok: true, data: { id, status: newStatus } });
  });

  // POST /api/approvals/:id/re-review — re-run AI triage with decline feedback
  router.post('/:id/re-review', async (req: Request, res: Response) => {
    if (!isApprover(req)) {
      res.status(403).json({ ok: false, error: 'You do not have AI Approver permissions' });
      return;
    }
    if (!onReReview) {
      res.status(501).json({ ok: false, error: 'Re-review not available — agent loop not running' });
      return;
    }

    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid ID' }); return; }

    const item = await approvalQueries.getById(id);
    if (!item) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    if (item.status !== 'declined') {
      res.status(409).json({ ok: false, error: 'Can only re-review declined approvals' });
      return;
    }

    const user = (req as any).user;
    const declineReason = item.decline_reason || 'No reason provided';

    const result = await onReReview(id, declineReason, user.username);
    if (!result.ok) {
      res.status(500).json({ ok: false, error: result.error });
      return;
    }

    res.json({ ok: true, data: { newApprovalId: result.newApprovalId } });
  });

  // GET /api/approvals/bc/lookup/:accountNumber — look up BC customer by account number
  router.get('/bc/lookup/:accountNumber', async (req: Request, res: Response) => {
    const settings = settingsQueries.getAll();
    const bc = buildBcClient(settings);
    if (!bc) { res.json({ ok: false, error: 'Business Central integration not configured' }); return; }

    try {
      const customer = await bc.getCustomerByNumber(req.params.accountNumber as string);
      if (!customer) { res.json({ ok: true, data: null }); return; }
      res.json({ ok: true, data: { number: customer.number, displayName: customer.displayName, email: customer.email, phoneNumber: customer.phoneNumber, city: customer.city, balance: customer.balance, blocked: customer.blocked } });
    } catch (err) {
      console.error('[approvals/bc] Lookup failed:', err instanceof Error ? err.message : err);
      res.json({ ok: false, error: 'BC lookup failed' });
    }
  });

  // GET /api/approvals/bc/search?q=... — search BC customers by name/email/number
  router.get('/bc/search', async (req: Request, res: Response) => {
    const q = (String(req.query.q ?? '') || '').trim();
    if (!q || q.length < 2) { res.json({ ok: false, error: 'Search query too short (min 2 chars)' }); return; }

    const settings = settingsQueries.getAll();
    const bc = buildBcClient(settings);
    if (!bc) { res.json({ ok: false, error: 'Business Central integration not configured' }); return; }

    try {
      const results = await bc.searchCustomers(q);
      res.json({ ok: true, data: results.map(c => ({ number: c.number, displayName: c.displayName, email: c.email, phoneNumber: c.phoneNumber, city: c.city, blocked: c.blocked })) });
    } catch (err) {
      console.error('[approvals/bc] Search failed:', err instanceof Error ? err.message : err);
      res.json({ ok: false, error: 'BC search failed' });
    }
  });

  // POST /api/approvals/bc/link — link a BC account number to a Jira ticket
  router.post('/bc/link', async (req: Request, res: Response) => {
    const { ticketKey, accountNumber } = req.body as { ticketKey?: string; accountNumber?: string };
    if (!ticketKey || !accountNumber) { res.status(400).json({ ok: false, error: 'ticketKey and accountNumber required' }); return; }
    if (!jiraClient) { res.status(500).json({ ok: false, error: 'Jira client not available' }); return; }

    try {
      await jiraClient.updateFields(ticketKey, { customfield_14626: accountNumber });
      res.json({ ok: true });
    } catch (err) {
      console.error(`[approvals/bc] Failed to link BC account to ${ticketKey}:`, err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, error: 'Failed to update Jira ticket' });
    }
  });

  return router;
}
