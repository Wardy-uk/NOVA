import type { JiraRestClient } from './jira-client.js';
import type { AgentDecision, ActionResult } from './agent-types.js';

export class Actor {
  private jiraClient: JiraRestClient;

  constructor(jiraClient: JiraRestClient) {
    this.jiraClient = jiraClient;
  }

  async execute(decision: AgentDecision): Promise<ActionResult> {
    try {
      switch (decision.action) {
        case 'no_action':
          return { success: true, action: 'no_action', ticketKey: decision.ticketKey, detail: 'No action required.' };

        case 'comment':
        case 'respond':
        case 'draft_response':
          return await this.postComment(decision);

        case 'transition':
          return await this.transitionTicket(decision);

        case 'assign':
          return await this.assignTicket(decision);

        case 'update_fields':
          return await this.updateFields(decision);

        case 'chase':
          return await this.chaseCustomer(decision);

        case 'escalate':
          return await this.escalate(decision);

        default:
          return { success: false, action: decision.action, ticketKey: decision.ticketKey, detail: `Unhandled action: ${decision.action}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[actor] Failed to execute ${decision.action} on ${decision.ticketKey}:`, message);
      return { success: false, action: decision.action, ticketKey: decision.ticketKey, detail: 'Action execution failed.', error: message };
    }
  }

  private async postComment(decision: AgentDecision): Promise<ActionResult> {
    const text = (decision.output.response as string) ?? (decision.output.comment as string) ?? decision.reasoning;
    const internal = decision.output.internal !== false;
    await this.jiraClient.addComment(decision.ticketKey, text, { internal });
    return { success: true, action: decision.action, ticketKey: decision.ticketKey, detail: `Posted ${internal ? 'internal' : 'public'} comment.` };
  }

  private async transitionTicket(decision: AgentDecision): Promise<ActionResult> {
    const transitionId = decision.output.transitionId as string;
    if (!transitionId) {
      return { success: false, action: 'transition', ticketKey: decision.ticketKey, detail: 'No transitionId in decision output.' };
    }
    await this.jiraClient.transitionIssue(decision.ticketKey, transitionId, {
      fields: (decision.output.fields as Record<string, unknown>) ?? undefined,
    });
    return { success: true, action: 'transition', ticketKey: decision.ticketKey, detail: `Transitioned with ID ${transitionId}.` };
  }

  private async assignTicket(decision: AgentDecision): Promise<ActionResult> {
    const accountId = decision.output.assigneeAccountId as string;
    if (!accountId) {
      return { success: false, action: 'assign', ticketKey: decision.ticketKey, detail: 'No assigneeAccountId in decision output.' };
    }
    await this.jiraClient.updateFields(decision.ticketKey, { assignee: { accountId } });
    return { success: true, action: 'assign', ticketKey: decision.ticketKey, detail: `Assigned to ${accountId}.` };
  }

  private async updateFields(decision: AgentDecision): Promise<ActionResult> {
    const fields = decision.output.fields as Record<string, unknown>;
    if (!fields || Object.keys(fields).length === 0) {
      return { success: false, action: 'update_fields', ticketKey: decision.ticketKey, detail: 'No fields to update.' };
    }
    await this.jiraClient.updateFields(decision.ticketKey, fields);
    return { success: true, action: 'update_fields', ticketKey: decision.ticketKey, detail: `Updated ${Object.keys(fields).length} field(s).` };
  }

  private async chaseCustomer(decision: AgentDecision): Promise<ActionResult> {
    const ticketKey = decision.ticketKey;
    const summary = (decision.inputs.summary as string) ?? ticketKey;
    const daysWaiting = decision.inputs.updated
      ? Math.round((Date.now() - new Date(decision.inputs.updated as string).getTime()) / (24 * 60 * 60 * 1000))
      : 0;
    const chaseText = (decision.output.draft_response as string) ??
      `Hi,\n\nWe're following up on ${ticketKey} — "${summary}".\n\nWe've been waiting for your reply for ${daysWaiting} days. Could you let us know if you still need help with this issue?\n\nIf we don't hear back within a few days, we'll close this ticket automatically. You can always raise a new ticket or reply to this one to reopen it.\n\nThanks,\nNurtur Support`;
    await this.jiraClient.addComment(ticketKey, chaseText, { internal: false });
    return { success: true, action: 'chase', ticketKey, detail: `Sent chase message (${daysWaiting} days waiting).` };
  }

  private async escalate(decision: AgentDecision): Promise<ActionResult> {
    const briefText = `[AI Agent Escalation]\n\nTicket: ${decision.ticketKey}\nConfidence: ${decision.confidence}\nReasoning: ${decision.reasoning}`;
    await this.jiraClient.addComment(decision.ticketKey, briefText, { internal: true });
    return { success: true, action: 'escalate', ticketKey: decision.ticketKey, detail: 'Escalation brief posted as internal comment.' };
  }
}
