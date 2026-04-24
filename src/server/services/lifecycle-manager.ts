import type { SettingsQueries } from '../db/settings-store.js';
import type { ApprovalQueries } from '../db/queries.js';
import type { JiraRestClient } from './jira-client.js';
import type { JiraCacheQueries } from './jira-cache-queries.js';
import type { AlertService } from './alert-service.js';
import type { Observer } from './observer.js';
import type { TicketLifecycle, AssignedTicketMode, AgentDecision } from './agent-types.js';
import { TicketStateStore } from './ticket-state.js';
import { query } from './database.js';
import { LlmService } from './llm-service.js';
import { ChaseResultSchema, type ChaseResult } from './chase-schema.js';
import { loadPrompt } from './prompt-loader.js';

interface LifecycleSweepResult {
  approvalTimeouts: number;
  approvalAlerts: number;
  staleTransitions: number;
  customerReplies: number;
  chaseSent: number;
  autoCloseCandidates: number;
  autoClosed: number;
}

export class LifecycleManager {
  private ticketState: TicketStateStore;
  private settings: SettingsQueries;
  private approvalQueries: ApprovalQueries | null;
  private jiraClient: JiraRestClient;
  private cache: JiraCacheQueries | null;
  private alertService: AlertService;
  private observer: Observer;
  private llmService: LlmService | null;

  constructor(
    settings: SettingsQueries,
    jiraClient: JiraRestClient,
    alertService: AlertService,
    observer: Observer,
    approvalQueries?: ApprovalQueries,
    cache?: JiraCacheQueries,
    llmService?: LlmService,
  ) {
    this.ticketState = new TicketStateStore();
    this.settings = settings;
    this.approvalQueries = approvalQueries ?? null;
    this.jiraClient = jiraClient;
    this.cache = cache ?? null;
    this.alertService = alertService;
    this.observer = observer;
    this.llmService = llmService ?? null;
  }

  getTicketState(): TicketStateStore {
    return this.ticketState;
  }

  getAssignedTicketMode(): AssignedTicketMode {
    const val = this.settings.get('agent_assigned_ticket_mode');
    if (val === 'active_assistant' || val === 'hands_off') return val;
    return 'observer';
  }

  private getNumber(key: string, fallback: number): number {
    const val = this.settings.get(key);
    if (!val) return fallback;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  }

  async sweep(shadow: boolean): Promise<LifecycleSweepResult> {
    const result: LifecycleSweepResult = {
      approvalTimeouts: 0,
      approvalAlerts: 0,
      staleTransitions: 0,
      customerReplies: 0,
      chaseSent: 0,
      autoCloseCandidates: 0,
      autoClosed: 0,
    };

    try {
      const timeoutResult = await this.checkApprovalTimeouts(shadow);
      result.approvalTimeouts = timeoutResult.timedOut;
      result.approvalAlerts = timeoutResult.alerted;
    } catch (err) {
      console.warn('[lifecycle] Approval timeout check failed:', err instanceof Error ? err.message : err);
    }

    try {
      result.customerReplies = await this.detectCustomerReplies();
    } catch (err) {
      console.warn('[lifecycle] Customer reply detection failed:', err instanceof Error ? err.message : err);
    }

    try {
      const staleResult = await this.checkStaleTickets(shadow);
      result.staleTransitions = staleResult.stale;
      result.chaseSent = staleResult.chased;
      result.autoCloseCandidates = staleResult.autoCloseCandidates;
      result.autoClosed = staleResult.autoClosed;
    } catch (err) {
      console.warn('[lifecycle] Stale ticket check failed:', err instanceof Error ? err.message : err);
    }

    return result;
  }

  private async checkApprovalTimeouts(shadow: boolean): Promise<{ timedOut: number; alerted: number }> {
    if (!this.approvalQueries) return { timedOut: 0, alerted: 0 };

    const timeoutMins = this.getNumber('agent_approval_timeout_mins', 30);
    const autoApproveThreshold = this.getNumber('agent_auto_approve_threshold', 0.85);
    const alertMins = this.getNumber('agent_abandoned_approval_alert_mins', 15);

    const pendingApprovals = await this.approvalQueries.getPending();
    let timedOut = 0;
    let alerted = 0;

    for (const approval of pendingApprovals) {
      const createdAt = new Date(approval.created_at);
      const ageMs = Date.now() - createdAt.getTime();
      const ageMins = ageMs / 60_000;

      if (ageMins >= timeoutMins) {
        let confidence = 0;
        try {
          const conv = JSON.parse(approval.conversation_json ?? '{}');
          confidence = conv.classification?.confidence ?? 0;
        } catch { /* ignore */ }

        if (confidence >= autoApproveThreshold && !shadow) {
          await this.approvalQueries.decide(approval.id, 'approved', 'NOVA-lifecycle', approval.ai_response_adf ?? undefined);

          const responseText = approval.edited_response_adf || approval.ai_response_adf || '';
          if (responseText) {
            try {
              await this.jiraClient.addComment(approval.ticket_id, responseText, { internal: false });
            } catch (err) {
              console.warn(`[lifecycle] Failed to post auto-approved response on ${approval.ticket_id}:`, err instanceof Error ? err.message : err);
            }
          }

          await this.jiraClient.addComment(
            approval.ticket_id,
            `\u{1F916} Lifecycle Manager\n\nApproval timed out after ${Math.round(ageMins)} minutes. Auto-approved (confidence: ${(confidence * 100).toFixed(0)}%, threshold: ${(autoApproveThreshold * 100).toFixed(0)}%).`,
            { internal: true },
          );

          await this.ticketState.transition(approval.ticket_id, 'response_sent', {
            approvalId: null,
            approvalSubmittedAt: null,
          });

          const decisions = await this.observer.getDecisionsByTicket(approval.ticket_id, 1) as Array<{ id: number }>;
          if (decisions[0]) {
            await this.observer.logOutcome(decisions[0].id, {
              success: true, action: 'draft_response', ticketKey: approval.ticket_id,
              detail: `Approval timed out — auto-approved (confidence ${(confidence * 100).toFixed(0)}%). Response posted.`,
            });
          }

          console.log(`[lifecycle] Auto-approved ${approval.ticket_id} after ${Math.round(ageMins)}min timeout (confidence: ${confidence.toFixed(2)})`);
        } else {
          if (!shadow) {
            await this.approvalQueries.decide(approval.id, 'timed_out', 'NOVA-lifecycle');
          }

          await this.alertService.createAlert({
            alertType: 'approval_timeout',
            severity: 'warning',
            title: `Approval timed out: ${approval.ticket_id}`,
            detail: `Approval pending for ${Math.round(ageMins)} minutes. Confidence ${(confidence * 100).toFixed(0)}% below auto-approve threshold (${(autoApproveThreshold * 100).toFixed(0)}%). ${shadow ? '[SHADOW] Would escalate.' : 'Escalated.'}`,
            ticketKey: approval.ticket_id,
          });

          if (!shadow) {
            await this.jiraClient.addComment(
              approval.ticket_id,
              `\u{1F916} Lifecycle Manager\n\nApproval timed out after ${Math.round(ageMins)} minutes. Confidence (${(confidence * 100).toFixed(0)}%) is below the auto-approve threshold. This ticket needs human attention.`,
              { internal: true },
            );

            await this.ticketState.transition(approval.ticket_id, 'awaiting_customer', {
              approvalId: null,
              approvalSubmittedAt: null,
            });
          }

          console.log(`[lifecycle] Approval timed out for ${approval.ticket_id} — ${shadow ? '[SHADOW] would escalate' : 'escalated'} (confidence: ${confidence.toFixed(2)})`);
        }
        timedOut++;
      } else if (ageMins >= alertMins) {
        await this.alertService.createAlert({
          alertType: 'approval_abandoned',
          severity: 'info',
          title: `Approval awaiting review: ${approval.ticket_id}`,
          detail: `Pending for ${Math.round(ageMins)} minutes. Will auto-escalate at ${timeoutMins} minutes.`,
          ticketKey: approval.ticket_id,
        });
        alerted++;
      }
    }

    return { timedOut, alerted };
  }

  private async detectCustomerReplies(): Promise<number> {
    if (!this.cache) return 0;

    const awaitingStates: TicketLifecycle[] = ['awaiting_customer', 'response_sent', 'chase_sent', 'stale'];
    const tracked = await this.ticketState.getAll(awaitingStates);
    if (tracked.length === 0) return 0;

    const agentEmail = this.settings.get('jira_ob_email') ?? '';
    let detected = 0;

    for (const ticket of tracked) {
      try {
        const comments = await query<{
          jira_comment_id: string;
          author_account_id: string | null;
          author_email: string | null;
          is_public: boolean;
          jira_created: Date;
        }>(
          `SELECT TOP(5) jira_comment_id, author_account_id, author_email, is_public, jira_created
           FROM jira_comment_cache
           WHERE issue_key = ? AND is_public = 1
           ORDER BY jira_created DESC`,
          [ticket.ticketId],
        );

        const lastKnown = ticket.lastCommentId;
        const newCustomerComments = comments.filter(c => {
          if (lastKnown && c.jira_comment_id <= lastKnown) return false;
          if (agentEmail && c.author_email === agentEmail) return false;
          return true;
        });

        if (newCustomerComments.length > 0) {
          const latestComment = newCustomerComments[0];
          await this.ticketState.transition(ticket.ticketId, 'customer_replied', {
            lastCommentId: latestComment.jira_comment_id,
            lastCustomerReplyAt: new Date().toISOString(),
            commentCount: ticket.commentCount + newCustomerComments.length,
          });
          detected++;
          console.log(`[lifecycle] Detected customer reply on ${ticket.ticketId}`);
        }
      } catch (err) {
        console.warn(`[lifecycle] Reply detection failed for ${ticket.ticketId}:`, err instanceof Error ? err.message : err);
      }
    }

    return detected;
  }

  private async checkStaleTickets(shadow: boolean): Promise<{
    stale: number; chased: number; autoCloseCandidates: number; autoClosed: number;
  }> {
    const awaitingHours = this.getNumber('agent_awaiting_customer_hours', 48);
    const chaseDays = 5;
    const closeDays = 10;
    const project = this.settings.get('agent_jira_project') ?? 'NT';
    const now = new Date();

    let stale = 0;
    let chased = 0;
    let autoCloseCandidates = 0;
    let autoClosed = 0;

    // Check awaiting_customer → stale
    const awaitingCustomer = await this.ticketState.getAll('awaiting_customer');
    for (const ticket of awaitingCustomer) {
      const transitionAt = new Date(ticket.lastTransitionAt);
      const hoursWaiting = (now.getTime() - transitionAt.getTime()) / (60 * 60 * 1000);
      if (hoursWaiting >= awaitingHours) {
        await this.ticketState.transition(ticket.ticketId, 'stale');
        stale++;
      }
    }

    // Check stale → chase_sent
    const staleTickets = await this.ticketState.getAll('stale');
    for (const ticket of staleTickets) {
      const transitionAt = new Date(ticket.lastTransitionAt);
      const daysStale = (now.getTime() - transitionAt.getTime()) / (24 * 60 * 60 * 1000);

      if (daysStale >= 1) {
        const chaseDecision = await this.buildChaseDecision(ticket.ticketId, Math.round(daysStale + (awaitingHours / 24)));
        if (chaseDecision) {
          chaseDecision.shadowMode = shadow;
          if (!shadow) {
            const draftResponse = chaseDecision.output.draft_response as string | undefined;
            if (draftResponse) {
              try {
                await this.jiraClient.addComment(ticket.ticketId, draftResponse, { internal: false });
              } catch (err) {
                console.warn(`[lifecycle] Failed to post chase on ${ticket.ticketId}:`, err instanceof Error ? err.message : err);
              }
            }
          }

          const internalNote = chaseDecision.output.internal_note as string;
          if (internalNote) {
            try {
              await this.jiraClient.addComment(ticket.ticketId, internalNote, { internal: true });
            } catch { /* best effort */ }
          }

          const decisionId = await this.observer.logDecision(chaseDecision);
          await this.observer.logOutcome(decisionId, {
            success: true, action: 'chase', ticketKey: ticket.ticketId,
            detail: shadow ? '[SHADOW] Would send chase' : 'Chase sent via lifecycle manager',
          });

          await this.ticketState.transition(ticket.ticketId, 'chase_sent', {
            lastAgentActionAt: now.toISOString(),
          });
          chased++;
        }
      }
    }

    // Check chase_sent → auto_close_candidate
    const chaseSent = await this.ticketState.getAll('chase_sent');
    for (const ticket of chaseSent) {
      const transitionAt = new Date(ticket.lastTransitionAt);
      const daysSinceChase = (now.getTime() - transitionAt.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceChase >= chaseDays) {
        await this.ticketState.transition(ticket.ticketId, 'auto_close_candidate');
        autoCloseCandidates++;
      }
    }

    // Check auto_close_candidate → closed
    const closeCandidates = await this.ticketState.getAll('auto_close_candidate');
    for (const ticket of closeCandidates) {
      const transitionAt = new Date(ticket.lastTransitionAt);
      const daysSinceCandidate = (now.getTime() - transitionAt.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceCandidate >= (closeDays - chaseDays)) {
        if (!shadow) {
          try {
            await this.jiraClient.addComment(
              ticket.ticketId,
              `This ticket has had no customer response for over ${closeDays} days. Closing per SOP-003. If you still need help, please raise a new ticket or reply to reopen.`,
              { internal: false },
            );
          } catch (err) {
            console.warn(`[lifecycle] Failed to post close message on ${ticket.ticketId}:`, err instanceof Error ? err.message : err);
          }
        }

        await this.jiraClient.addComment(
          ticket.ticketId,
          `\u{1F916} Lifecycle Manager\n\nNo customer response for ${closeDays}+ days. ${shadow ? '[SHADOW] Would auto-close per SOP-003.' : 'Auto-closing per SOP-003.'}`,
          { internal: true },
        ).catch(() => { /* best effort */ });

        await this.ticketState.transition(ticket.ticketId, 'closed');
        autoClosed++;
      }
    }

    return { stale, chased, autoCloseCandidates, autoClosed };
  }

  private async buildChaseDecision(ticketKey: string, totalDaysWaiting: number): Promise<AgentDecision | null> {
    if (!this.llmService) {
      return {
        ticketId: '', ticketKey, eventType: 'stale', action: 'chase',
        confidence: 1.0, reasoning: `No customer reply for ${totalDaysWaiting} days`,
        approvalRequired: false, shadowMode: false,
        inputs: { summary: '', status: 'Waiting On Requestor', sweep_type: 'lifecycle_chase' },
        output: {
          internal_note: `\u{1F916} Lifecycle Manager\n\nNo customer response for ${totalDaysWaiting} days. Sending follow-up.`,
          draft_response: `Hi there,\n\nJust checking in on ${ticketKey} — we haven't heard back and want to make sure this is resolved for you.\n\nCould you let us know if you still need help with this?\n\nThanks`,
        },
      };
    }

    try {
      const issue = await this.jiraClient.getIssue(ticketKey, [
        'summary', 'description', 'status', 'priority', 'reporter', 'assignee', 'comment',
      ]);
      if (!issue) return null;
      const f = issue.fields;

      const comments = (f.comment as any)?.comments as Array<{
        author?: { displayName?: string }; body?: string; created?: string;
      }> | undefined;

      const conversationThread = (comments ?? []).slice(-5)
        .map(c => `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}:\n${typeof c.body === 'string' ? c.body.slice(0, 300) : '(complex body)'}`)
        .join('\n\n---\n\n');

      const systemPrompt = loadPrompt('chase', {
        ticket_key: ticketKey,
        summary: (f.summary as string) ?? ticketKey,
        description: ((f.description as string) ?? '').slice(0, 500),
        priority: (f.priority as any)?.name ?? 'Medium',
        reporter: (f.reporter as any)?.displayName ?? 'Unknown',
        organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? 'Unknown',
        status: (f.status as any)?.name ?? 'Unknown',
        days_waiting: String(totalDaysWaiting),
        conversation_thread: conversationThread || '(no comments)',
      });

      const result = await this.llmService.call<ChaseResult>(
        systemPrompt,
        'Draft a contextual follow-up message for this stale ticket.',
        ChaseResultSchema,
        { ticketId: ticketKey, callType: 'chase', temperature: 0.3 },
      );

      return {
        ticketId: issue.id, ticketKey, eventType: 'stale', action: 'chase',
        confidence: 1.0,
        reasoning: `No customer reply for ${totalDaysWaiting} days. LLM-drafted chase (${result.data.tone_check}).`,
        approvalRequired: false, shadowMode: false,
        inputs: {
          summary: (f.summary as string) ?? '',
          status: (f.status as any)?.name ?? 'Unknown',
          priority: (f.priority as any)?.name ?? 'Medium',
          assignee: (f.assignee as any)?.displayName ?? null,
          reporter: (f.reporter as any)?.displayName ?? null,
          sweep_type: 'lifecycle_chase',
        },
        output: {
          internal_note: `\u{1F916} Lifecycle Manager\n\nNo customer response for ${totalDaysWaiting} days. Sending LLM-drafted follow-up.`,
          draft_response: result.data.draft_response,
        },
        provider: result.provider,
        model: result.model,
      };
    } catch (err) {
      console.warn(`[lifecycle] LLM chase draft failed for ${ticketKey}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getPriorDecisions(ticketKey: string, limit = 3): Promise<Array<{
    id: number; action: string; confidence: number; reasoning: string;
    eventType: string; createdAt: string; output: Record<string, unknown>;
  }>> {
    const rows = await query<{
      id: number; action: string; confidence: number; reasoning: string;
      event_type: string; created_at: string; output: string;
    }>(
      `SELECT TOP(?) id, action, confidence, reasoning, event_type, created_at, output
       FROM agent_decisions WHERE ticket_id = ? ORDER BY created_at DESC`,
      [limit, ticketKey],
    );
    return rows.map(r => ({
      id: r.id,
      action: r.action,
      confidence: r.confidence,
      reasoning: r.reasoning,
      eventType: r.event_type,
      createdAt: r.created_at,
      output: (() => { try { return JSON.parse(r.output); } catch { return {}; } })(),
    }));
  }

  formatPriorDecisionContext(decisions: Array<{
    action: string; confidence: number; reasoning: string;
    eventType: string; createdAt: string; output: Record<string, unknown>;
  }>): string {
    if (decisions.length === 0) return 'No prior AI decisions for this ticket.';

    return decisions.map((d, i) => {
      const actionLabels: Record<string, string> = {
        draft_response: 'Draft reply', escalate: 'Escalate', assign: 'Assign',
        gather_context: 'Gather context', no_action: 'No action', chase: 'Chase',
      };
      const label = actionLabels[d.action] ?? d.action;
      const classification = d.output.classification as { category?: string } | undefined;
      const cat = classification?.category ? ` (${classification.category})` : '';
      return `Decision ${i + 1} [${d.createdAt}]: ${label}${cat}, confidence ${(d.confidence * 100).toFixed(0)}%. Reasoning: ${d.reasoning.slice(0, 200)}`;
    }).join('\n\n');
  }
}
