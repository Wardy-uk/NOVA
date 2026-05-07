import type { JiraRestClient } from './jira-client.js';
import type { AgentDecision, ActionResult } from './agent-types.js';
import type { EscalationLogService } from './escalation-log-service.js';
import type { SettingsQueries } from '../db/settings-store.js';

export class Actor {
  private jiraClient: JiraRestClient;
  private escalationLog?: EscalationLogService;
  private settings: SettingsQueries;

  static looksLikeStructuredPayload(text: string): boolean {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { JSON.parse(trimmed); return true; } catch { /* not valid JSON, continue */ }
    }
    const structuredKeys = ['"recommended_action"', '"draft_response"', '"internal_note"', '"classification"', '"confidence"', '"kb_gap"', '"priority_assessment"'];
    return structuredKeys.filter(k => trimmed.includes(k)).length >= 2;
  }

  constructor(jiraClient: JiraRestClient, escalationLog: EscalationLogService | undefined, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.escalationLog = escalationLog;
    this.settings = settings;
    if (!settings.get('nova_ai_jira_account_id')) {
      console.error('[actor] WARNING: nova_ai_jira_account_id is not set in settings. AI-actioned tickets will NOT be assigned to NOVA.');
    }
  }

  private async assignToNovaServiceAccount(ticketKey: string): Promise<void> {
    const accountId = this.settings.get('nova_ai_jira_account_id');
    if (!accountId) {
      console.error('[actor] CRITICAL: nova_ai_jira_account_id not configured — ticket will not be assigned to NOVA');
      return;
    }
    try {
      await this.jiraClient.updateFields(ticketKey, { assignee: { accountId } });
    } catch (err) {
      console.warn(`[actor] Failed to assign ${ticketKey} to NOVA service account:`, err instanceof Error ? err.message : err);
    }
  }

  async execute(decision: AgentDecision): Promise<ActionResult> {
    try {
      // Remove [Action Required] prefix when a new action is taken (customer replied or ticket progressed)
      const recAction = decision.output.recommended_action as string | undefined;
      if (recAction !== 'gather_context' && decision.eventType === 'comment_added') {
        try {
          const issue = await this.jiraClient.getIssue(decision.ticketKey, ['summary']);
          const summary = (issue?.fields?.summary as string) || '';
          if (summary.startsWith('[Action Required] ')) {
            await this.jiraClient.updateFields(decision.ticketKey, {
              summary: summary.replace('[Action Required] ', ''),
            });
          }
        } catch { /* best effort */ }
      }

      // Assign to NOVA service account before any ticket-modifying action
      if (decision.action !== 'no_action' && decision.action !== 'assign') {
        await this.assignToNovaServiceAccount(decision.ticketKey);
      }

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

        case 'bug_redirect':
          return await this.bugRedirect(decision);

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
    // GUARDRAIL: Actor must NEVER post public comments. Public replies go through approval callback only.
    await this.jiraClient.addComment(decision.ticketKey, text, { internal: true });

    // Prefix subject with [Action Required] when AI is requesting customer info
    const recAction = decision.output.recommended_action as string | undefined;
    if (recAction === 'gather_context') {
      try {
        const issue = await this.jiraClient.getIssue(decision.ticketKey, ['summary']);
        const currentSummary = (issue?.fields?.summary as string) || '';
        if (!currentSummary.startsWith('[Action Required]')) {
          await this.jiraClient.updateFields(decision.ticketKey, {
            summary: `[Action Required] ${currentSummary}`,
          });
        }
      } catch (err) {
        console.warn(`[actor] Failed to add [Action Required] prefix to ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    return { success: true, action: decision.action, ticketKey: decision.ticketKey, detail: 'Posted internal comment.' };
  }

  private async transitionTicket(decision: AgentDecision): Promise<ActionResult> {
    const transitionId = decision.output.transitionId as string;
    if (!transitionId) {
      return { success: false, action: 'transition', ticketKey: decision.ticketKey, detail: 'No transitionId in decision output.' };
    }
    // Quick Resolve (17) requires resolution type — set default if not in fields
    if (transitionId === '17') {
      const fields = (decision.output.fields as Record<string, unknown>) ?? {};
      if (!fields['customfield_14494']) {
        try {
          await this.jiraClient.updateFields(decision.ticketKey, {
            customfield_14494: { value: 'No Fault Found' },
          });
        } catch (err) {
          console.warn(`[actor] Failed to set resolution type on ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
        }
      }
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
    if (Actor.looksLikeStructuredPayload(chaseText)) {
      console.error(`[actor] BLOCKED public chase on ${ticketKey}: text looks like structured/JSON data`);
      return { success: false, action: 'chase', ticketKey, detail: 'Blocked: chase text contained structured/JSON data.' };
    }
    await this.jiraClient.addComment(ticketKey, chaseText, { internal: false });
    return { success: true, action: 'chase', ticketKey, detail: `Sent chase message (${daysWaiting} days waiting).` };
  }

  private async escalate(decision: AgentDecision): Promise<ActionResult> {
    const briefText = `[AI Agent Escalation]\n\nTicket: ${decision.ticketKey}\nConfidence: ${decision.confidence}\nReasoning: ${decision.reasoning}`;
    await this.jiraClient.addComment(decision.ticketKey, briefText, { internal: true });

    try {
      await this.escalationLog?.log({
        ticket_key: decision.ticketKey,
        escalation_type: 'ai_agent',
        to_tier: (decision.output?.targetTier as string) ?? 'T2',
        reason_code: (decision.output?.reasonCode as string) ?? undefined,
        reason_label: decision.reasoning?.slice(0, 200),
        escalated_by: 'ai_agent',
        decision_id: undefined,
        source: 'nova_ai',
      });
    } catch (e) {
      console.warn('[actor] Failed to log escalation:', e instanceof Error ? e.message : e);
    }

    return { success: true, action: 'escalate', ticketKey: decision.ticketKey, detail: 'Escalation brief posted as internal comment.' };
  }

  private async bugRedirect(decision: AgentDecision): Promise<ActionResult> {
    const targetProject = (decision.output.targetProject as string) ?? 'NT';
    const summary = `[Bug from ${decision.ticketKey}] ${decision.inputs.summary ?? 'Bug report'}`;
    const description = (decision.output.bugDescription as string) ?? decision.reasoning;

    const created = await this.jiraClient.createIssue({
      fields: {
        project: { key: targetProject },
        summary,
        description,
        issuetype: { name: 'Bug' },
      },
    });

    if (created?.key) {
      await this.jiraClient.addComment(decision.ticketKey,
        `Bug ticket created: ${created.key}\n\nThis issue has been redirected to the ${targetProject} project for developer attention.`,
        { internal: true },
      );
      try {
        await this.jiraClient.createIssueLink({
          type: { name: 'Blocks' },
          inwardIssue: { key: decision.ticketKey },
          outwardIssue: { key: created.key },
        });
      } catch { /* linking is best-effort */ }
    }

    return {
      success: true,
      action: 'bug_redirect',
      ticketKey: decision.ticketKey,
      detail: `Created ${created?.key ?? 'unknown'} in ${targetProject} and linked.`,
    };
  }
}
