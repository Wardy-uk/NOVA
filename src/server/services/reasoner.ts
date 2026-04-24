import type { TicketEvent, AgentDecision, AutonomyCheck } from './agent-types.js';
import type { LlmService } from './llm-service.js';
import type { KbSearchService } from './kb-search.js';
import type { AutonomyEngine } from './autonomy-engine.js';
import type { LifecycleManager } from './lifecycle-manager.js';
import { TriageResultSchema, type TriageResult } from './triage-schema.js';
import { RespondResultSchema, type RespondResult } from './respond-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { executeAndGetId } from './database.js';

const CONFIDENCE_HIGH = 0.8;
const CONFIDENCE_LOW = 0.4;

export class Reasoner {
  private llmService: LlmService;
  private kbSearch: KbSearchService;
  private autonomyEngine: AutonomyEngine | null;
  private lifecycleManager: LifecycleManager | null = null;
  private lastAutonomyCheck: AutonomyCheck | null = null;

  constructor(llmService: LlmService, kbSearch: KbSearchService, autonomyEngine?: AutonomyEngine) {
    this.llmService = llmService;
    this.kbSearch = kbSearch;
    this.autonomyEngine = autonomyEngine ?? null;
  }

  setLifecycleManager(manager: LifecycleManager): void {
    this.lifecycleManager = manager;
  }

  getLastAutonomyCheck(): AutonomyCheck | null {
    return this.lastAutonomyCheck;
  }

  async decide(event: TicketEvent): Promise<AgentDecision> {
    if (event.eventType === 'ticket_created') {
      return this.triageNewTicket(event);
    }
    if (event.eventType === 'comment_added') {
      return this.handleComment(event);
    }

    return this.noAction(event);
  }

  async decideMultiple(events: TicketEvent[]): Promise<AgentDecision[]> {
    const results: AgentDecision[] = [];
    for (const e of events) {
      try {
        results.push(await this.decide(e));
      } catch (err) {
        console.error(`[reasoner] Failed to decide on ${e.ticketKey}:`, err instanceof Error ? err.message : err);
        results.push(this.noAction(e, `Error: ${err instanceof Error ? err.message : 'unknown'}`));
      }
    }
    return results;
  }

  private async triageNewTicket(event: TicketEvent): Promise<AgentDecision> {
    const kbMatches = await this.kbSearch.search(`${event.summary} ${event.description.slice(0, 200)}`);
    const kbText = this.kbSearch.formatForPrompt(kbMatches);

    const customerContext = this.buildCustomerContext(event);

    const systemPrompt = loadPrompt('triage', {
      ticket_key: event.ticketKey,
      summary: event.summary,
      description: event.description || '(no description provided)',
      request_type: event.requestType || 'Not specified',
      priority: event.priority,
      reporter: event.reporter ?? 'Unknown',
      organisation: event.organisation ?? 'Unknown',
      created: event.created,
      customer_context: customerContext,
      kb_matches: kbText,
    });

    const userMessage = `Analyse this ticket and produce the structured JSON assessment.`;

    const result = await this.llmService.call<TriageResult>(
      systemPrompt,
      userMessage,
      TriageResultSchema,
      {
        ticketId: event.ticketKey,
        callType: 'triage',
        temperature: 0.2,
      },
    );

    const triage = result.data;
    const action = this.mapAction(triage);

    // Log KB gap if the LLM identified one and no good KB match exists
    const bestKbRelevance = kbMatches.length > 0 ? Math.max(...kbMatches.map(m => m.relevance)) : 0;
    if (triage.kb_gap.should_have_article && bestKbRelevance < 0.7) {
      this.logKbGap(
        event.ticketKey,
        triage.classification.category,
        triage.kb_gap.suggested_title,
        triage.kb_gap.reason,
      );
    }

    // Build the decision first so autonomy engine can inspect it
    const decision: AgentDecision = {
      ticketId: event.ticketId,
      ticketKey: event.ticketKey,
      eventType: event.eventType,
      action,
      confidence: triage.classification.confidence,
      reasoning: triage.reasoning_trace,
      approvalRequired: true, // default, overridden below
      shadowMode: false,
      inputs: {
        summary: event.summary,
        description: event.description?.slice(0, 500),
        status: event.status,
        priority: event.priority,
        requestType: event.requestType,
        reporter: event.reporter,
        organisation: event.organisation,
        assignee: event.assignee,
        created: event.created,
        classification: triage.classification,
        sentiment: triage.sentiment,
        sla_risk: triage.sla_risk,
        kb_matches: kbMatches,
      },
      output: {
        recommended_action: triage.recommended_action,
        draft_response: triage.draft_response,
        internal_note: triage.internal_note,
        priority_assessment: triage.priority_assessment,
        classification: triage.classification,
        kb_gap: triage.kb_gap,
      },
      provider: result.provider,
      model: result.model,
    };

    decision.approvalRequired = await this.needsApproval(triage, decision);
    return decision;
  }

  private async handleComment(event: TicketEvent): Promise<AgentDecision> {
    const kbMatches = await this.kbSearch.search(`${event.summary} ${(event.comments?.[0]?.body ?? '').slice(0, 200)}`);
    const kbText = this.kbSearch.formatForPrompt(kbMatches);
    const customerContext = this.buildCustomerContext(event);

    const conversationThread = (event.comments ?? [])
      .map(c => `[${c.created}] ${c.author}${c.isPublic ? '' : ' (internal)'}:\n${c.body}`)
      .join('\n\n---\n\n');

    // Decision continuity: load prior decisions for this ticket
    let priorDecisionText = 'No prior AI decisions for this ticket.';
    if (this.lifecycleManager) {
      try {
        const priorDecisions = await this.lifecycleManager.getPriorDecisions(event.ticketKey, 3);
        priorDecisionText = this.lifecycleManager.formatPriorDecisionContext(priorDecisions);
      } catch (err) {
        console.warn(`[reasoner] Failed to load prior decisions for ${event.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    const systemPrompt = loadPrompt('respond', {
      ticket_key: event.ticketKey,
      summary: event.summary,
      description: event.description || '(no description provided)',
      request_type: event.requestType || 'Not specified',
      priority: event.priority,
      status: event.status,
      assignee: event.assignee ?? 'Unassigned',
      reporter: event.reporter ?? 'Unknown',
      organisation: event.organisation ?? 'Unknown',
      created: event.created,
      previous_triage: priorDecisionText,
      conversation_thread: conversationThread || '(no comments)',
      customer_context: customerContext,
      kb_matches: kbText,
    });

    const result = await this.llmService.call<RespondResult>(
      systemPrompt,
      `Analyse the latest comment on this ticket and produce the structured JSON assessment.`,
      RespondResultSchema,
      {
        ticketId: event.ticketKey,
        callType: 'respond',
        temperature: 0.2,
      },
    );

    const respond = result.data;
    const action = this.mapRespondAction(respond);

    const decision: AgentDecision = {
      ticketId: event.ticketId,
      ticketKey: event.ticketKey,
      eventType: event.eventType,
      action,
      confidence: respond.confidence ?? respond.intent.confidence,
      reasoning: respond.reasoning_trace,
      approvalRequired: true,
      shadowMode: false,
      inputs: {
        summary: event.summary,
        description: event.description?.slice(0, 500),
        status: event.status,
        priority: event.priority,
        requestType: event.requestType,
        reporter: event.reporter,
        organisation: event.organisation,
        assignee: event.assignee,
        created: event.created,
        intent: respond.intent,
        sentiment: respond.sentiment,
        kb_matches: kbMatches,
        comment_count: event.comments?.length ?? 0,
      },
      output: {
        recommended_action: respond.recommended_action,
        draft_response: respond.draft_response,
        internal_note: respond.internal_note,
        intent: respond.intent,
      },
      provider: result.provider,
      model: result.model,
    };

    decision.approvalRequired = await this.needsRespondApproval(respond, decision);
    return decision;
  }

  private mapRespondAction(respond: RespondResult): AgentDecision['action'] {
    switch (respond.recommended_action) {
      case 'respond': return 'draft_response';
      case 'escalate': return 'escalate';
      case 'gather_context': return 'draft_response';
      case 'close': return 'transition';
      case 'assign': return 'assign';
      case 'no_action': return 'no_action';
      default: return 'no_action';
    }
  }

  private async needsRespondApproval(respond: RespondResult, decision: AgentDecision): Promise<boolean> {
    if (respond.recommended_action === 'escalate') return false;
    if (respond.recommended_action === 'assign') return false;
    if (respond.recommended_action === 'no_action') return false;

    if (this.autonomyEngine) {
      try {
        const check = await this.autonomyEngine.checkAutonomy(decision);
        this.lastAutonomyCheck = check;
        if (check.allowed) {
          console.log(`[reasoner] Autonomy approved for respond on ${decision.ticketKey}: ${check.reason}`);
          return false;
        }
      } catch (err) {
        console.warn(`[reasoner] Autonomy check failed for respond, falling back to approval:`, err instanceof Error ? err.message : err);
      }
    }

    return true;
  }

  private mapAction(triage: TriageResult): AgentDecision['action'] {
    switch (triage.recommended_action) {
      case 'respond': return 'draft_response';
      case 'escalate': return 'escalate';
      case 'gather_context': return 'draft_response';
      case 'assign': return 'assign';
      default: return 'no_action';
    }
  }

  private async needsApproval(triage: TriageResult, decision: AgentDecision): Promise<boolean> {
    if (triage.recommended_action === 'escalate') return false;
    if (triage.recommended_action === 'assign') return false;

    // Phase 2: check autonomy engine for eligible categories
    if (this.autonomyEngine) {
      try {
        const check = await this.autonomyEngine.checkAutonomy(decision);
        this.lastAutonomyCheck = check;
        if (check.allowed) {
          console.log(`[reasoner] Autonomy approved for ${decision.ticketKey}: ${check.reason}`);
          return false;
        }
      } catch (err) {
        console.warn(`[reasoner] Autonomy check failed, falling back to approval:`, err instanceof Error ? err.message : err);
      }
    }

    return true;
  }

  private buildCustomerContext(event: TicketEvent): string {
    // D365 enrichment will be added here when the integration is wired in.
    // For now, use what we have from the Jira ticket itself.
    const parts: string[] = [];
    if (event.organisation) parts.push(`Organisation: ${event.organisation}`);
    if (event.reporter) parts.push(`Reporter: ${event.reporter}`);
    if (event.slaBreachTime) {
      const breachDate = new Date(event.slaBreachTime);
      const minsToBreak = Math.round((breachDate.getTime() - Date.now()) / 60000);
      parts.push(`SLA breach in: ${minsToBreak} minutes`);
    }
    return parts.length > 0 ? parts.join('\n') : 'No additional customer context available.';
  }

  private logKbGap(ticketKey: string, category: string, suggestedTitle: string | null, reason: string): void {
    executeAndGetId(
      `INSERT INTO kb_gap_log (ticket_id, category, suggested_title, reason)
       VALUES (?, ?, ?, ?)`,
      [ticketKey, category, suggestedTitle, reason],
    ).catch(err => {
      console.warn(`[reasoner] Failed to log KB gap for ${ticketKey}:`, err instanceof Error ? err.message : err);
    });
  }

  private noAction(event: TicketEvent, reason?: string): AgentDecision {
    return {
      ticketId: event.ticketId,
      ticketKey: event.ticketKey,
      eventType: event.eventType,
      action: 'no_action',
      confidence: 0,
      reasoning: reason ?? `No handler for event type: ${event.eventType}`,
      approvalRequired: false,
      shadowMode: false,
      inputs: { summary: event.summary, status: event.status },
      output: {},
    };
  }
}
