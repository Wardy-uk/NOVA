import { query, execute, executeAndGetId } from './database.js';
import type { TicketLifecycle, TicketLifecycleState } from './agent-types.js';

const VALID_TRANSITIONS: Record<TicketLifecycle, TicketLifecycle[]> = {
  new:                  ['triaged'],
  triaged:              ['awaiting_approval', 'response_sent', 'awaiting_customer', 'resolved', 'closed'],
  awaiting_approval:    ['response_sent', 'awaiting_customer', 'resolved', 'closed'],
  response_sent:        ['awaiting_customer', 'customer_replied', 'resolved', 'closed'],
  awaiting_customer:    ['customer_replied', 'stale', 'resolved', 'closed'],
  customer_replied:     ['re_evaluating', 'triaged', 'awaiting_approval', 'resolved', 'closed'],
  re_evaluating:        ['awaiting_approval', 'response_sent', 'awaiting_customer', 'resolved', 'closed'],
  stale:                ['chase_sent', 'auto_close_candidate', 'customer_replied', 'resolved', 'closed'],
  chase_sent:           ['customer_replied', 'auto_close_candidate', 'resolved', 'closed'],
  auto_close_candidate: ['closed', 'customer_replied', 'resolved'],
  resolved:             ['customer_replied', 'closed'],
  closed:               ['customer_replied'],
  pre_empted:           [],
};

export class TicketStateStore {
  async get(ticketId: string): Promise<TicketLifecycleState | null> {
    const rows = await query<{
      ticket_id: string;
      lifecycle: string;
      assignee: string | null;
      assignee_name: string | null;
      last_comment_id: string | null;
      last_triage_decision_id: number | null;
      last_respond_decision_id: number | null;
      comment_count: number;
      last_transition_at: string;
      last_agent_action_at: string | null;
      last_customer_reply_at: string | null;
      approval_id: number | null;
      approval_submitted_at: string | null;
    }>(
      `SELECT ticket_id, lifecycle, assignee, assignee_name,
              last_comment_id, last_triage_decision_id, last_respond_decision_id,
              comment_count, last_transition_at, last_agent_action_at,
              last_customer_reply_at, approval_id, approval_submitted_at
       FROM agent_ticket_state WHERE ticket_id = ?`,
      [ticketId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ticketId: r.ticket_id,
      lifecycle: r.lifecycle as TicketLifecycle,
      assignee: r.assignee,
      assigneeName: r.assignee_name,
      lastCommentId: r.last_comment_id,
      lastTriageDecisionId: r.last_triage_decision_id,
      lastRespondDecisionId: r.last_respond_decision_id,
      commentCount: r.comment_count ?? 0,
      lastTransitionAt: r.last_transition_at,
      lastAgentActionAt: r.last_agent_action_at,
      lastCustomerReplyAt: r.last_customer_reply_at,
      approvalId: r.approval_id,
      approvalSubmittedAt: r.approval_submitted_at,
    };
  }

  async getAll(lifecycle?: TicketLifecycle | TicketLifecycle[]): Promise<TicketLifecycleState[]> {
    let sql: string;
    let params: unknown[];

    if (!lifecycle) {
      sql = `SELECT * FROM agent_ticket_state ORDER BY last_transition_at DESC`;
      params = [];
    } else if (Array.isArray(lifecycle)) {
      const placeholders = lifecycle.map(() => '?').join(',');
      sql = `SELECT * FROM agent_ticket_state WHERE lifecycle IN (${placeholders}) ORDER BY last_transition_at DESC`;
      params = lifecycle;
    } else {
      sql = `SELECT * FROM agent_ticket_state WHERE lifecycle = ? ORDER BY last_transition_at DESC`;
      params = [lifecycle];
    }

    const rows = await query<any>(sql, params);
    return rows.map((r: any) => ({
      ticketId: r.ticket_id,
      lifecycle: r.lifecycle as TicketLifecycle,
      assignee: r.assignee,
      assigneeName: r.assignee_name,
      lastCommentId: r.last_comment_id,
      lastTriageDecisionId: r.last_triage_decision_id,
      lastRespondDecisionId: r.last_respond_decision_id,
      commentCount: r.comment_count ?? 0,
      lastTransitionAt: r.last_transition_at,
      lastAgentActionAt: r.last_agent_action_at,
      lastCustomerReplyAt: r.last_customer_reply_at,
      approvalId: r.approval_id,
      approvalSubmittedAt: r.approval_submitted_at,
    }));
  }

  async transition(ticketId: string, newLifecycle: TicketLifecycle, updates?: Partial<{
    assignee: string | null;
    assigneeName: string | null;
    lastCommentId: string;
    lastTriageDecisionId: number;
    lastRespondDecisionId: number;
    commentCount: number;
    lastAgentActionAt: string;
    lastCustomerReplyAt: string;
    approvalId: number | null;
    approvalSubmittedAt: string | null;
  }>): Promise<void> {
    const existing = await this.get(ticketId);

    if (existing) {
      const currentLifecycle = existing.lifecycle;
      const allowed = VALID_TRANSITIONS[currentLifecycle] ?? [];
      if (!allowed.includes(newLifecycle) && currentLifecycle !== newLifecycle) {
        console.warn(`[ticket-state] Invalid transition ${currentLifecycle} → ${newLifecycle} for ${ticketId}, forcing anyway`);
      }

      const setClauses: string[] = ['lifecycle = ?', 'last_transition_at = GETUTCDATE()', 'last_event_at = GETUTCDATE()'];
      const params: unknown[] = [newLifecycle];

      if (updates?.assignee !== undefined) { setClauses.push('assignee = ?'); params.push(updates.assignee); }
      if (updates?.assigneeName !== undefined) { setClauses.push('assignee_name = ?'); params.push(updates.assigneeName); }
      if (updates?.lastCommentId) { setClauses.push('last_comment_id = ?'); params.push(updates.lastCommentId); }
      if (updates?.lastTriageDecisionId) { setClauses.push('last_triage_decision_id = ?'); params.push(updates.lastTriageDecisionId); }
      if (updates?.lastRespondDecisionId) { setClauses.push('last_respond_decision_id = ?'); params.push(updates.lastRespondDecisionId); }
      if (updates?.commentCount !== undefined) { setClauses.push('comment_count = ?'); params.push(updates.commentCount); }
      if (updates?.lastAgentActionAt) { setClauses.push('last_agent_action_at = ?'); params.push(updates.lastAgentActionAt); }
      if (updates?.lastCustomerReplyAt) { setClauses.push('last_customer_reply_at = ?'); params.push(updates.lastCustomerReplyAt); }
      if (updates?.approvalId !== undefined) { setClauses.push('approval_id = ?'); params.push(updates.approvalId); }
      if (updates?.approvalSubmittedAt !== undefined) { setClauses.push('approval_submitted_at = ?'); params.push(updates.approvalSubmittedAt); }

      params.push(ticketId);
      await execute(
        `UPDATE agent_ticket_state SET ${setClauses.join(', ')} WHERE ticket_id = ?`,
        params,
      );
    } else {
      await execute(
        `INSERT INTO agent_ticket_state
           (ticket_id, lifecycle, assignee, assignee_name, last_comment_id,
            last_triage_decision_id, last_respond_decision_id, comment_count,
            last_transition_at, last_event_at, last_agent_action_at, last_customer_reply_at,
            approval_id, approval_submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE(), GETUTCDATE(), ?, ?, ?, ?)`,
        [
          ticketId,
          newLifecycle,
          updates?.assignee ?? null,
          updates?.assigneeName ?? null,
          updates?.lastCommentId ?? null,
          updates?.lastTriageDecisionId ?? null,
          updates?.lastRespondDecisionId ?? null,
          updates?.commentCount ?? 0,
          updates?.lastAgentActionAt ?? null,
          updates?.lastCustomerReplyAt ?? null,
          updates?.approvalId ?? null,
          updates?.approvalSubmittedAt ?? null,
        ],
      );
    }
  }

  async updateAfterDecision(
    ticketId: string,
    decisionId: number,
    eventType: string,
    lastCommentId?: string,
  ): Promise<void> {
    const existing = await this.get(ticketId);
    const updates: Record<string, unknown> = {};

    if (eventType === 'ticket_created') {
      updates.lastTriageDecisionId = decisionId;
    } else if (eventType === 'comment_added') {
      updates.lastRespondDecisionId = decisionId;
    }
    if (lastCommentId) {
      updates.lastCommentId = lastCommentId;
    }
    updates.lastAgentActionAt = new Date().toISOString();

    if (!existing) {
      await this.transition(ticketId, eventType === 'ticket_created' ? 'triaged' : 'new', updates as any);
    } else {
      const setClauses: string[] = ['last_event_at = GETUTCDATE()'];
      const params: unknown[] = [];

      if (updates.lastTriageDecisionId) { setClauses.push('last_triage_decision_id = ?'); params.push(updates.lastTriageDecisionId); }
      if (updates.lastRespondDecisionId) { setClauses.push('last_respond_decision_id = ?'); params.push(updates.lastRespondDecisionId); }
      if (updates.lastCommentId) { setClauses.push('last_comment_id = ?'); params.push(updates.lastCommentId); }
      if (updates.lastAgentActionAt) { setClauses.push('last_agent_action_at = ?'); params.push(updates.lastAgentActionAt); }

      params.push(ticketId);
      await execute(
        `UPDATE agent_ticket_state SET ${setClauses.join(', ')} WHERE ticket_id = ?`,
        params,
      );
    }
  }

  async getLifecycleBreakdown(): Promise<Record<TicketLifecycle, number>> {
    const rows = await query<{ lifecycle: string; cnt: number }>(
      `SELECT lifecycle, COUNT(*) as cnt FROM agent_ticket_state GROUP BY lifecycle`,
    );
    const breakdown: Record<string, number> = {};
    for (const r of rows) breakdown[r.lifecycle] = r.cnt;
    return breakdown as Record<TicketLifecycle, number>;
  }

  async getApprovalHealth(): Promise<{
    pendingCount: number;
    oldestPendingMins: number | null;
    avgWaitMins: number | null;
    autoApprovedToday: number;
    escalatedToday: number;
  }> {
    const [pending, autoApproved, escalated] = await Promise.all([
      query<{ cnt: number; oldest_mins: number | null; avg_mins: number | null }>(
        `SELECT COUNT(*) as cnt,
                DATEDIFF(minute, MIN(approval_submitted_at), GETUTCDATE()) as oldest_mins,
                AVG(DATEDIFF(minute, approval_submitted_at, GETUTCDATE())) as avg_mins
         FROM agent_ticket_state
         WHERE lifecycle = 'awaiting_approval' AND approval_submitted_at IS NOT NULL`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_decisions
         WHERE created_at >= CAST(GETUTCDATE() AS DATE)
           AND outcome LIKE '%auto-approved%'`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_decisions
         WHERE created_at >= CAST(GETUTCDATE() AS DATE)
           AND outcome LIKE '%approval timed out%'`,
      ),
    ]);

    return {
      pendingCount: pending[0]?.cnt ?? 0,
      oldestPendingMins: pending[0]?.oldest_mins ?? null,
      avgWaitMins: pending[0]?.avg_mins ?? null,
      autoApprovedToday: autoApproved[0]?.cnt ?? 0,
      escalatedToday: escalated[0]?.cnt ?? 0,
    };
  }
}
