import type { JiraRestClient } from './jira-client.js';
import type { AgentDecision, ActionResult } from './agent-types.js';
import type { EscalationLogService } from './escalation-log-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { AssignmentEngine } from './assignment-engine.js';
import { query, executeAndGetId } from './database.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';

const HIGH_STAKES_ACTIONS = ['close', 'resolve', 'draft_response', 'escalate', 'quick_win_close', 'transition'];

export class Actor {
  private jiraClient: JiraRestClient;
  private escalationLog?: EscalationLogService;
  private settings: SettingsQueries;
  private llmService?: LlmService;
  private assignmentEngine?: AssignmentEngine;

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

  setLlmService(llmService: LlmService): void {
    this.llmService = llmService;
  }

  setAssignmentEngine(engine: AssignmentEngine): void {
    this.assignmentEngine = engine;
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

  async runCritic(decision: AgentDecision): Promise<{ approved: boolean; reason: string; model?: string }> {
    if (!this.llmService) return { approved: true, reason: 'No LLM service available — skipping critic' };

    const criticEnabled = this.settings.get('agent_critic_enabled') !== 'false';
    if (!criticEnabled) return { approved: true, reason: 'Critic disabled' };

    const allowedActionsRaw = this.settings.get('agent_critic_actions') ?? 'close,resolve,draft_response,escalate,quick_win_close,transition';
    const allowedActions = allowedActionsRaw.split(',').map(a => a.trim());
    if (!allowedActions.includes(decision.action)) return { approved: true, reason: `Action ${decision.action} not subject to critic` };

    try {
      const prompt = `You are a quality gate for an AI support agent at Nurtur (proptech SaaS).
The agent wants to perform this action on a Jira service desk ticket.

Action: ${decision.action}
Ticket: ${decision.ticketKey}
Confidence: ${(decision.confidence * 100).toFixed(0)}%
Reasoning: ${decision.reasoning?.slice(0, 500) ?? 'None'}
Draft response (if any): ${((decision.output.draft_response as string) ?? 'None').slice(0, 1000)}

Guardrails to check:
- No refund/credit/compensation promises
- No blaming product, team, or individuals
- No internal process disclosure to customers
- No timeline commitments for fixes
- No cross-customer data leakage
- Response addresses the customer's actual issue (if responding)
- Tone is professional and warm (Nurtur voice)
- Escalation has documented reasoning

Should this action proceed? Reply with JSON only: { "approved": true/false, "reason": "..." }`;

      const result = await this.llmService.call<{ approved: boolean; reason: string }>(
        prompt,
        'Evaluate this action and return your verdict as JSON.',
        undefined as any,
        { callType: 'critic', temperature: 0.1, tier: 'cheap' as any },
      );

      return { approved: result.data.approved, reason: result.data.reason, model: result.model };
    } catch (err) {
      console.warn('[actor] Critic call failed, allowing action to proceed:', err instanceof Error ? err.message : err);
      return { approved: true, reason: `Critic error: ${err instanceof Error ? err.message : 'unknown'}` };
    }
  }

  async validateEscalation(decision: AgentDecision): Promise<{ valid: boolean; missing: string[] }> {
    const missing: string[] = [];

    const hasDecision = await query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM agent_decisions WHERE ticket_id = ?', [decision.ticketKey],
    );
    if (!hasDecision[0] || hasDecision[0].cnt === 0) missing.push('No AI triage on this ticket');

    const internalComments = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM jira_comment_cache
       WHERE issue_key = ? AND is_public = 0 AND author_display != 'NOVA AI'`,
      [decision.ticketKey],
    );
    if (!internalComments[0] || internalComments[0].cnt === 0) missing.push('No troubleshooting documented (no internal comments from agent)');

    const escalationReason = decision.output?.reasonCode as string | undefined;
    if (!escalationReason || escalationReason === 'None') {
      if (!decision.reasoning || decision.reasoning.length < 20) {
        missing.push('No escalation reason provided');
      }
    }

    return { valid: missing.length === 0, missing };
  }

  async execute(decision: AgentDecision): Promise<ActionResult> {
    try {
      // A2: Critic gate — run on high-stakes actions before execution
      if (HIGH_STAKES_ACTIONS.includes(decision.action) && !(decision.output as any).critic_approved) {
        const criticResult = await this.runCritic(decision);
        try {
          await executeAndGetId(
            `UPDATE agent_decisions SET critic_approved = ?, critic_reason = ?, critic_model = ? WHERE ticket_id = ? AND id = (SELECT MAX(id) FROM agent_decisions WHERE ticket_id = ?)`,
            [criticResult.approved ? 1 : 0, criticResult.reason?.slice(0, 500) ?? null, criticResult.model ?? null, decision.ticketKey, decision.ticketKey],
          );
        } catch { /* best effort logging */ }

        if (!criticResult.approved) {
          console.warn(`[actor] Critic BLOCKED ${decision.action} on ${decision.ticketKey}: ${criticResult.reason}`);
          return { success: false, action: decision.action, ticketKey: decision.ticketKey, detail: `Critic blocked: ${criticResult.reason}`, error: 'CRITIC_BLOCKED' };
        }
        (decision.output as any).critic_approved = true;
      }

      // D2: Escalation gate — validate SOP-002 compliance
      if (decision.action === 'escalate') {
        const validation = await this.validateEscalation(decision);
        if (!validation.valid) {
          const violationDetail = validation.missing.join('; ');
          console.warn(`[actor] Escalation gate violation on ${decision.ticketKey}: ${violationDetail}`);
          try {
            await executeAndGetId(
              `INSERT INTO agent_alerts (alert_type, severity, title, detail, ticket_key) VALUES (?, ?, ?, ?, ?)`,
              ['error', 'warning', `Escalation gate: SOP-002 violation on ${decision.ticketKey}`, violationDetail, decision.ticketKey],
            );
          } catch { /* best effort */ }
        }
      }

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
    const text = (decision.output.draft_response as string) ?? (decision.output.response as string) ?? (decision.output.comment as string) ?? decision.reasoning;
    // GUARDRAIL: Actor must NEVER post public comments. Public replies go through approval callback only.
    if (Actor.looksLikeStructuredPayload(text)) {
      console.error(`[actor] BLOCKED internal postComment on ${decision.ticketKey}: text looks like structured/JSON data`);
      return { success: false, action: decision.action, ticketKey: decision.ticketKey, detail: 'Blocked: comment text contained structured/JSON data.' };
    }
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

    // Validate transition is available for current ticket status
    try {
      const transResult = await this.jiraClient.getTransitionsWithFields(decision.ticketKey);
      const available = (transResult as any)?.transitions as Array<{ id: string; name: string }> | undefined;
      if (available && !available.some(t => t.id === transitionId)) {
        const availableNames = available.map(t => `${t.name} (${t.id})`).join(', ');
        console.warn(`[actor] Transition ${transitionId} not available for ${decision.ticketKey}. Available: ${availableNames}`);
        return { success: false, action: 'transition', ticketKey: decision.ticketKey, detail: `Transition ${transitionId} not available. Available: ${availableNames}`, error: 'TRANSITION_NOT_FOUND' };
      }
    } catch (err) {
      console.warn(`[actor] Could not verify transitions for ${decision.ticketKey}, proceeding anyway:`, err instanceof Error ? err.message : err);
    }

    if (transitionId === '17') {
      const existingFields = (decision.output.fields as Record<string, unknown>) ?? {};
      if (!existingFields['customfield_14494']) {
        try {
          const resMapRaw = this.settings.get('agent_resolution_type_map');
          let resMap: Record<string, string> = {};
          try { if (resMapRaw) resMap = JSON.parse(resMapRaw); } catch {}
          const resolution = resMap[decision.action] || 'Tech Services Fix';
          const { fields: resolveFields } = buildResolveFields({
            tldr: (decision.output.tldr as string) || `Resolved by NOVA agent (${decision.action})`,
            resolution,
            comment: '',
          });
          Object.assign(existingFields, resolveFields);
        } catch (err) {
          console.warn(`[actor] Failed to build resolve fields for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
        }
      }
      await this.jiraClient.transitionIssue(decision.ticketKey, transitionId, { fields: existingFields });
    } else {
      await this.jiraClient.transitionIssue(decision.ticketKey, transitionId, {
        fields: (decision.output.fields as Record<string, unknown>) ?? undefined,
      });
    }
    return { success: true, action: 'transition', ticketKey: decision.ticketKey, detail: `Transitioned with ID ${transitionId}.` };
  }

  private async assignTicket(decision: AgentDecision): Promise<ActionResult> {
    // If LLM provided an explicit accountId, use it directly
    const accountId = decision.output.assigneeAccountId as string | undefined;
    if (accountId) {
      await this.jiraClient.updateFields(decision.ticketKey, { assignee: { accountId } });
      return { success: true, action: 'assign', ticketKey: decision.ticketKey, detail: `Assigned to ${accountId}.` };
    }

    // Delegate to round-robin assignment engine
    if (!this.assignmentEngine) {
      console.warn(`[actor] AssignmentEngine is null for ${decision.ticketKey} — cannot delegate assign action. Was setAssignmentEngine() called?`);
      return { success: false, action: 'assign', ticketKey: decision.ticketKey, detail: 'No AssignmentEngine configured and no assigneeAccountId in decision output.' };
    }

    const project = this.assignmentEngine.resolveProjectFromTicketKey(decision.ticketKey);
    const pool = (decision.output.pool as string as import('./assignment-engine.js').Pool) || 'cc';
    const result = await this.assignmentEngine.assignWithFallback(decision.ticketKey, pool, project);
    if (result) {
      await this.assignmentEngine.postAssignmentComment(decision.ticketKey, result);
      return { success: true, action: 'assign', ticketKey: decision.ticketKey, detail: `Round-robin assigned to ${result.agent.display_name} (${result.reason}).` };
    }
    return { success: false, action: 'assign', ticketKey: decision.ticketKey, detail: 'Round-robin exhausted — no available agents in any pool.' };
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
    const targetTier = (decision.output?.targetTier as string) ?? this.settings.get('agent_escalation_tier_value') ?? 'Tier 2';
    const briefText = `[AI Agent Escalation]\n\nTicket: ${decision.ticketKey}\nConfidence: ${decision.confidence}\nReasoning: ${decision.reasoning}`;
    await this.jiraClient.addComment(decision.ticketKey, briefText, { internal: true });

    // Update Current Tier in Jira (customfield_12981)
    const tierIds: Record<string, string> = {
      'Customer Care': '13061', 'Tier 2': '13062', 'Tier 3': '13063',
      'Development': '13064', 'Production': '13700',
    };
    const tierId = tierIds[targetTier];
    if (tierId) {
      try {
        await this.jiraClient.updateFields(decision.ticketKey, {
          customfield_12981: { id: tierId },
        });
        console.log(`[actor] Updated Current Tier to "${targetTier}" on ${decision.ticketKey}`);
      } catch (err) {
        console.warn(`[actor] Failed to update Current Tier on ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    try {
      await this.escalationLog?.log({
        ticket_key: decision.ticketKey,
        escalation_type: 'ai_agent',
        to_tier: targetTier,
        reason_code: (decision.output?.reasonCode as string) ?? undefined,
        reason_label: decision.reasoning?.slice(0, 200),
        escalated_by: 'ai_agent',
        decision_id: undefined,
        source: 'nova_ai',
      });
    } catch (e) {
      console.warn('[actor] Failed to log escalation:', e instanceof Error ? e.message : e);
    }

    return { success: true, action: 'escalate', ticketKey: decision.ticketKey, detail: `Escalation brief posted + tier set to ${targetTier}.` };
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
