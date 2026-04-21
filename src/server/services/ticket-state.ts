import { query, execute } from './database.js';

export interface TicketConversationState {
  lastCommentId?: string;
  lastTriageDecisionId?: number;
  lastRespondDecisionId?: number;
  commentCount?: number;
}

export class TicketStateStore {
  async get(ticketId: string): Promise<TicketConversationState | null> {
    const rows = await query<{ conversation_state: string }>(
      `SELECT conversation_state FROM agent_ticket_state WHERE ticket_id = ?`,
      [ticketId],
    );
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].conversation_state);
    } catch {
      return null;
    }
  }

  async upsert(ticketId: string, state: TicketConversationState): Promise<void> {
    const json = JSON.stringify(state);
    await execute(
      `MERGE agent_ticket_state AS target
       USING (SELECT ? AS ticket_id) AS source
       ON target.ticket_id = source.ticket_id
       WHEN MATCHED THEN UPDATE SET conversation_state = ?, last_event_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (ticket_id, conversation_state) VALUES (?, ?);`,
      [ticketId, json, ticketId, json],
    );
  }

  async updateAfterDecision(
    ticketId: string,
    decisionId: number,
    eventType: string,
    lastCommentId?: string,
  ): Promise<void> {
    const existing = await this.get(ticketId) ?? {};
    if (eventType === 'ticket_created') {
      existing.lastTriageDecisionId = decisionId;
    } else if (eventType === 'comment_added') {
      existing.lastRespondDecisionId = decisionId;
    }
    if (lastCommentId) {
      existing.lastCommentId = lastCommentId;
    }
    await this.upsert(ticketId, existing);
  }
}
