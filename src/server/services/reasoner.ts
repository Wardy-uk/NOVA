import { z } from 'zod';
import type { TicketEvent, AgentDecision, AutonomyCheck } from './agent-types.js';
import type { LlmService } from './llm-service.js';
import type { KbSearchService } from './kb-search.js';
import type { AutonomyEngine } from './autonomy-engine.js';
import type { LifecycleManager } from './lifecycle-manager.js';
import type { AiLearningService } from './ai-learning-service.js';
import type { EscalationPolicy } from './escalation-policy.js';
import type { TriageTuningFeedback } from './triage-tuning-feedback.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { TriageResultSchema, type TriageResult } from './triage-schema.js';
import { RespondResultSchema, type RespondResult } from './respond-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { executeAndGetId, query } from './database.js';
import {
  detectCancellationIntent,
  isCancellationGuardrailEnabled,
  buildCancellationHoldingResponse,
} from './cancellation-guardrail.js';

const CONFIDENCE_HIGH = 0.8;
const CONFIDENCE_LOW = 0.4;

export class Reasoner {
  private llmService: LlmService;
  private kbSearch: KbSearchService;
  private autonomyEngine: AutonomyEngine | null;
  private lifecycleManager: LifecycleManager | null = null;
  private lastAutonomyCheck: AutonomyCheck | null = null;
  private learningService: AiLearningService | null = null;
  private escalationPolicy: EscalationPolicy | null = null;
  private tuningFeedback: TriageTuningFeedback | null = null;
  private settings: SettingsQueries | null = null;

  constructor(llmService: LlmService, kbSearch: KbSearchService, autonomyEngine?: AutonomyEngine) {
    this.llmService = llmService;
    this.kbSearch = kbSearch;
    this.autonomyEngine = autonomyEngine ?? null;
  }

  setLearningService(service: AiLearningService): void {
    this.learningService = service;
  }

  setLifecycleManager(manager: LifecycleManager): void {
    this.lifecycleManager = manager;
  }

  setEscalationPolicy(policy: EscalationPolicy): void {
    this.escalationPolicy = policy;
  }

  setTuningFeedback(feedback: TriageTuningFeedback): void {
    this.tuningFeedback = feedback;
  }

  setSettings(settings: SettingsQueries): void {
    this.settings = settings;
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

  async triageBackfill(event: TicketEvent): Promise<AgentDecision> {
    return this.triageNewTicket(event);
  }

  async reReview(event: TicketEvent, feedback: { reason: string; previousAction: string; previousResponse: string }): Promise<AgentDecision> {
    return this.triageNewTicket(event, feedback);
  }

  private shouldUseCheapTier(event: TicketEvent): boolean {
    const summary = (event.summary || '').toLowerCase();
    const patterns = [
      /^(re|fw|fwd):\s/i,
      /test\s*ticket/i,
      /please\s*ignore/i,
      /out\s*of\s*office/i,
      /unsubscribe/i,
      /auto[- ]?reply/i,
      /delivery\s*(status|failure)\s*notification/i,
      /mail\s*delivery\s*(failed|subsystem)/i,
    ];
    return patterns.some(p => p.test(summary));
  }

  private async triageNewTicket(event: TicketEvent, priorFeedback?: { reason: string; previousAction: string; previousResponse: string }): Promise<AgentDecision> {
    const kbMatches = await this.kbSearch.search(`${event.summary} ${event.description.slice(0, 200)}`);
    const kbText = this.kbSearch.formatForPrompt(kbMatches);

    const confluenceMatches = await this.searchConfluence(event.summary);

    const customerContext = this.buildCustomerContext(event);
    const learningsCtx = await this.buildLearningsContext(event);
    const patternsCtx = await this.buildPatternsContext(event);

    // Gap 8: Inject tuning signals for this category
    let tuningSignalsCtx = '';
    if (this.tuningFeedback) {
      try {
        tuningSignalsCtx = await this.tuningFeedback.getSignalsForCategory(
          (event as any).classification?.category ?? event.summary,
        );
      } catch { /* non-critical */ }
    }

    const attachmentsText = event.attachments?.length
      ? event.attachments.map(a => {
        const contentNote = a.base64Content ? ' [content provided as image below]' : '';
        return `- ${a.filename} (${a.mimeType}, ${(a.size / 1024).toFixed(1)}KB)${contentNote}`;
      }).join('\n')
      : 'None';

    const images = this.extractImageContent(event);

    let priorFeedbackSection = '';
    if (priorFeedback) {
      priorFeedbackSection = `\n\n## Prior Review Feedback\n\nA human reviewer DECLINED your previous recommendation for this ticket. You MUST produce a meaningfully different approach.\n\nPrevious action: ${priorFeedback.previousAction}\nPrevious draft response (rejected):\n${priorFeedback.previousResponse}\n\nReviewer's feedback:\n${priorFeedback.reason}\n\nUse this feedback to produce a better recommendation. Do NOT repeat the same action or response — the reviewer has explicitly rejected it.`;
    }

    const systemPrompt = loadPrompt('triage', {
      ticket_key: event.ticketKey,
      summary: event.summary,
      description: event.description || '(no description provided)',
      request_type: event.requestType || 'Not specified',
      priority: event.priority,
      reporter: event.reporter ?? 'Unknown',
      organisation: event.organisation ?? 'Unknown',
      created: event.created,
      attachments: attachmentsText,
      customer_context: customerContext,
      kb_matches: kbText,
      confluence_matches: confluenceMatches,
      learnings: learningsCtx.text + (patternsCtx ? `\n\n${patternsCtx}` : '') + (tuningSignalsCtx ? `\n\n## Historical Tuning Signals\n\n${tuningSignalsCtx}` : '') + priorFeedbackSection,
    });

    const userMessage = `Analyse this ticket and produce the structured JSON assessment.`;

    // E1: A/B test — check for active test on triage
    const abTest = await this.getActiveAbTest('triage');
    let abVariant: 'A' | 'B' | null = null;
    let effectivePrompt = systemPrompt;
    if (abTest) {
      const useB = Math.random() * 100 < abTest.split_percentage;
      abVariant = useB ? 'B' : 'A';
      if (useB && abTest.variant_b) effectivePrompt = abTest.variant_b;
    }

    const triageTier = this.shouldUseCheapTier(event) ? 'cheap' as const : undefined;
    if (triageTier) {
      console.log(`[reasoner] Downgrading triage to cheap tier for ${event.ticketKey} — trivial pattern match`);
    }

    const result = await this.llmService.call<TriageResult>(
      effectivePrompt,
      userMessage,
      TriageResultSchema,
      {
        ticketId: event.ticketKey,
        callType: 'triage',
        tier: triageTier,
        temperature: 0.2,
        images,
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
        slaBreachTime: event.slaBreachTime,
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
        quick_win: triage.quick_win,
        recommended_tier: triage.recommended_tier,
        needs_customer_reply: triage.needs_customer_reply,
        website_amend: triage.website_amend,
      },
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
    };

    // Guardrail: if ticket has unreadable attachments that look critical, force escalation
    if (this.hasUnreadableCriticalAttachments(event) && decision.action !== 'escalate') {
      console.log(`[reasoner] Overriding ${decision.action} → escalate on ${event.ticketKey}: critical attachments AI cannot read`);
      decision.action = 'escalate';
      decision.reasoning += '\n[Guardrail: ticket has attachments (images/PDFs/spreadsheets) that AI cannot read — escalating to human for review]';
      decision.approvalRequired = true;
    }

    decision.approvalRequired = await this.needsApproval(triage, decision);

    // E1: Tag with A/B test variant
    if (abTest && abVariant) {
      (decision as any).ab_test_id = abTest.id;
      (decision as any).ab_variant = abVariant;
    }

    await this.trackLearningCitations(triage.reasoning_trace, learningsCtx.learnings);

    // Cancellation guardrail runs last so it has the final say over the action.
    this.applyCancellationGuardrail(decision, `${event.summary}\n${event.description ?? ''}`);

    return decision;
  }

  private extractImageContent(event: TicketEvent): import('./llm-service.js').LlmImageContent[] {
    if (!event.attachments) return [];
    return event.attachments
      .filter(a => a.base64Content && a.mimeType.startsWith('image/'))
      .map(a => ({ base64: a.base64Content!, mimeType: a.mimeType }));
  }

  private async searchConfluence(summary: string): Promise<string> {
    try {
      if (!this.settings) return 'No Confluence configuration available.';
      const siteUrl = (this.settings.get('confluence_site_url') || this.settings.get('jira_url'))?.trim();
      const email = (this.settings.get('jira_username') || this.settings.get('jira_ob_email'))?.trim();
      const token = (this.settings.get('jira_token') || this.settings.get('jira_ob_token'))?.trim();
      const spaceKeysRaw = this.settings.get('kb_confluence_space_keys')?.trim();
      const portalSpace = this.settings.get('kb_confluence_space')?.trim();
      if (!siteUrl || !email || !token) return 'No Confluence configuration available.';

      const words = summary.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 4);
      if (words.length === 0) return 'No search terms derived from ticket summary.';
      const searchTerms = words.join(' ');

      // Merge space keys from both NOVA and portal settings to ensure aligned retrieval
      const allSpaces = new Set<string>();
      if (spaceKeysRaw) spaceKeysRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => allSpaces.add(s));
      if (portalSpace) allSpaces.add(portalSpace);
      if (allSpaces.size === 0) allSpaces.add('NT');

      let cql = `text ~ "${searchTerms}"`;
      const spaces = [...allSpaces].map(s => `"${s}"`).join(',');
      cql += ` AND space IN (${spaces})`;
      cql += ' ORDER BY lastmodified DESC';

      const url = `${siteUrl.replace(/\/wiki\/?$/, '').replace(/\/$/, '')}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=3`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        console.warn(`[reasoner] Confluence search failed: ${res.status}`);
        return 'Confluence search unavailable.';
      }

      const json = await res.json() as { results?: Array<{ title: string; _links?: { webui?: string } }> };
      const results = json.results ?? [];
      if (results.length === 0) return 'No matching Confluence articles found.';

      const baseUrl = siteUrl.replace(/\/wiki\/?$/, '').replace(/\/$/, '');
      return results.map((r, i) => {
        const link = r._links?.webui ? `${baseUrl}/wiki${r._links.webui}` : '';
        return `${i + 1}. ${r.title}${link ? ` — ${link}` : ''}`;
      }).join('\n');
    } catch (err) {
      console.warn('[reasoner] Confluence search error:', err instanceof Error ? err.message : err);
      return 'Confluence search failed.';
    }
  }

  // Cancellation / termination guardrail. NOVA must never accept or handle a cancellation
  // itself — it posts a warm holding acknowledgement and hands the ticket to a human in
  // Customer Care. Forces escalate, swaps in the holding response, and clears anything that
  // could auto-close or auto-route the ticket. Deterministic — does not rely on the LLM.
  private applyCancellationGuardrail(decision: AgentDecision, scanText: string): boolean {
    if (!isCancellationGuardrailEnabled(this.settings)) return false;
    const hit = detectCancellationIntent(scanText, this.settings);
    if (!hit.matched) return false;

    console.log(`[reasoner] Cancellation guardrail fired on ${decision.ticketKey} (matched: "${hit.phrase}") — forcing escalate to Customer Care`);

    decision.action = 'escalate';
    decision.output.recommended_action = 'escalate';
    decision.output.draft_response = buildCancellationHoldingResponse(decision.ticketKey, this.settings);
    decision.output.needs_customer_reply = false;
    // Nothing may auto-close or re-route a possible cancellation.
    decision.output.quick_win = { type: 'none', confidence: 0, reasoning: 'Cancellation guardrail — human review required.' };
    decision.output.website_amend = { is_website_amend: false, confidence: 0, reasoning: 'Cancellation guardrail — not a website amend.' };
    decision.approvalRequired = true;
    decision.reasoning += `\n[Guardrail: possible cancellation/termination intent ("${hit.phrase}") — NOVA must not handle this; escalated to Customer Care with a holding acknowledgement]`;
    return true;
  }

  private hasUnreadableCriticalAttachments(event: TicketEvent): boolean {
    if (!event.attachments || event.attachments.length === 0) return false;
    const unreadableTypes = ['application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats', 'text/csv'];
    const unreadableExtensions = ['.pdf', '.xlsx', '.xls', '.csv', '.doc', '.docx', '.zip', '.rar', '.7z', '.exe'];
    return event.attachments.some(a => {
      // Images with downloaded content are readable — skip them
      if (a.mimeType.startsWith('image/') && a.base64Content) return false;
      const mimeMatch = unreadableTypes.some(t => a.mimeType.startsWith(t));
      const extMatch = unreadableExtensions.some(ext => a.filename.toLowerCase().endsWith(ext));
      return mimeMatch || extMatch;
    });
  }

  private async handleComment(event: TicketEvent): Promise<AgentDecision> {
    const kbMatches = await this.kbSearch.search(`${event.summary} ${(event.comments?.[0]?.body ?? '').slice(0, 200)}`);
    const kbText = this.kbSearch.formatForPrompt(kbMatches);
    const customerContext = this.buildCustomerContext(event);
    const learningsCtx = await this.buildLearningsContext(event);

    const publicComments = (event.comments ?? []).filter(c => c.isPublic);
    const internalComments = (event.comments ?? []).filter(c => !c.isPublic);

    const publicThread = publicComments.length > 0
      ? publicComments.map(c => `[${c.created}] ${c.author} (CUSTOMER-VISIBLE):\n${c.body}`).join('\n\n---\n\n')
      : '(No customer-visible replies have been sent yet)';

    const internalThread = internalComments.length > 0
      ? internalComments.map(c => `[${c.created}] ${c.author} (INTERNAL NOTE — not visible to customer):\n${c.body}`).join('\n\n---\n\n')
      : '';

    const conversationThread = `## Customer-Visible Conversation\n\n${publicThread}`
      + (internalThread ? `\n\n## Internal Notes (NOT sent to customer — do NOT reference these as prior responses)\n\n${internalThread}` : '');

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
      learnings: learningsCtx.text,
    });

    const respondImages = this.extractImageContent(event);

    const result = await this.llmService.call<RespondResult>(
      systemPrompt,
      `Analyse the latest comment on this ticket and produce the structured JSON assessment.`,
      RespondResultSchema,
      {
        ticketId: event.ticketKey,
        callType: 'respond',
        temperature: 0.2,
        images: respondImages,
      },
    );

    const respond = result.data;
    let action = this.mapRespondAction(respond);

    // Gap 2: Handle no_action sub-states
    if (respond.recommended_action === 'no_action' && respond.no_action_reason) {
      if (respond.no_action_reason === 'human_should_act') {
        if (event.assignee) {
          console.log(`[reasoner] Keeping no_action for ${event.ticketKey}: already assigned to ${event.assignee}`);
        } else {
          action = 'assign';
        }
      }
    }

    const decision: AgentDecision = {
      ticketId: event.ticketId,
      ticketKey: event.ticketKey,
      eventType: event.eventType,
      action,
      confidence: respond.confidence,
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
        slaBreachTime: event.slaBreachTime,
        intent: respond.intent,
        sentiment: respond.sentiment,
        kb_matches: kbMatches,
        comment_count: event.comments?.length ?? 0,
      },
      output: {
        recommended_action: respond.recommended_action,
        no_action_reason: respond.no_action_reason ?? null,
        draft_response: respond.draft_response,
        internal_note: respond.internal_note,
        intent: respond.intent,
      },
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
    };

    // Guardrail: attachment escalation for comment-triggered re-evaluation too
    if (this.hasUnreadableCriticalAttachments(event) && decision.action !== 'escalate' && decision.action !== 'no_action') {
      console.log(`[reasoner] Overriding ${decision.action} → escalate on ${event.ticketKey}: critical attachments AI cannot read`);
      decision.action = 'escalate';
      decision.reasoning += '\n[Guardrail: ticket has attachments (images/PDFs/spreadsheets) that AI cannot read — escalating to human for review]';
      decision.approvalRequired = true;
    }

    decision.approvalRequired = await this.needsRespondApproval(respond, decision);

    await this.trackLearningCitations(respond.reasoning_trace, learningsCtx.learnings);

    // Cancellation guardrail — scan the customer-visible thread (latest reply may be the
    // cancellation). Runs last so it has the final say over the action.
    const commentScanText = `${event.summary}\n${publicComments.map(c => c.body).join('\n')}`;
    this.applyCancellationGuardrail(decision, commentScanText);

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
    if (respond.recommended_action === 'escalate') {
      if (this.escalationPolicy) {
        try {
          const policy = await this.escalationPolicy.evaluate(decision, respond);
          if (!policy.allowed) {
            decision.action = this.mapPolicySuggestion(policy.suggestion);
            decision.reasoning += `\n[Escalation policy: ${policy.reason}]`;
          } else if (policy.evidence_score < 0.6) {
            return true;
          } else {
            return false;
          }
        } catch (err) {
          console.warn('[reasoner] Escalation policy check failed:', err instanceof Error ? err.message : err);
          return false;
        }
      } else {
        return false;
      }
    }
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
    if (triage.recommended_action === 'escalate') {
      if (this.escalationPolicy) {
        try {
          const policy = await this.escalationPolicy.evaluate(decision, triage);
          if (!policy.allowed) {
            decision.action = this.mapPolicySuggestion(policy.suggestion);
            decision.reasoning += `\n[Escalation policy: ${policy.reason}]`;
          } else if (policy.evidence_score < 0.6) {
            return true;
          } else {
            return false;
          }
        } catch (err) {
          console.warn('[reasoner] Escalation policy check failed:', err instanceof Error ? err.message : err);
          return false;
        }
      } else {
        return false;
      }
    }

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

  private mapPolicySuggestion(suggestion?: string): AgentDecision['action'] {
    switch (suggestion) {
      case 'respond_first': return 'draft_response';
      case 'gather_context_first': return 'draft_response';
      case 'assign_instead': return 'assign';
      default: return 'draft_response';
    }
  }

  private async getActiveAbTest(callType: string): Promise<{ id: number; split_percentage: number; variant_b: string | null } | null> {
    try {
      const rows = await query<{ id: number; split_percentage: number; variant_b: string | null }>(
        `SELECT id, split_percentage, variant_b FROM agent_ab_tests
         WHERE status = 'active' AND test_type = 'prompt'
         ORDER BY started_at DESC`,
      );
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  private async buildLearningsContext(event: TicketEvent): Promise<{ text: string; learnings: import('./ai-learning-service.js').AiLearning[] }> {
    if (!this.learningService) return { text: 'No prior learnings available.', learnings: [] };
    try {
      const category = (event as any).classification?.category;
      const learnings = await this.learningService.getRelevantLearnings(category, event.organisation ?? undefined);
      return { text: this.learningService.formatForPrompt(learnings), learnings };
    } catch (err) {
      console.warn('[reasoner] Failed to load learnings:', err instanceof Error ? err.message : err);
      return { text: 'No prior learnings available.', learnings: [] };
    }
  }

  private async trackLearningCitations(reasoning: string, learnings: import('./ai-learning-service.js').AiLearning[]): Promise<void> {
    if (!this.learningService || learnings.length === 0) return;
    try {
      await this.learningService.recordCitations(reasoning, learnings);
    } catch (err) {
      console.warn('[reasoner] Failed to track learning citations:', err instanceof Error ? err.message : err);
    }
  }

  private async buildPatternsContext(event: TicketEvent): Promise<string> {
    try {
      const classification = (event as any).classification?.category;
      const category = classification ?? null;
      if (!category) return '';

      const patterns = await query<{ symptom: string; resolution: string; observed_count: number; success_rate: number | null }>(
        `SELECT TOP 3 symptom, resolution, observed_count, success_rate
         FROM agent_patterns
         WHERE category = ? AND observed_count >= 2
         ORDER BY observed_count DESC, last_observed DESC`,
        [category],
      );

      if (patterns.length === 0) return '';

      const lines = ['Known resolution patterns for this category:'];
      for (const p of patterns) {
        lines.push(`- Symptom: ${p.symptom?.slice(0, 200)}`);
        lines.push(`  Resolution: ${p.resolution?.slice(0, 300)}`);
        lines.push(`  Seen ${p.observed_count} times${p.success_rate != null ? `, ${p.success_rate}% success` : ''}`);
      }
      return lines.join('\n');
    } catch {
      return '';
    }
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

  async generateGenericFirstReply(opts: {
    ticketKey: string;
    summary: string;
    description: string;
    reporterName: string;
    assigneeName: string;
  }): Promise<string> {
    const firstName = opts.reporterName.split(/\s+/)[0] || opts.reporterName;
    const agentFirstName = opts.assigneeName.split(/\s+/)[0] || opts.assigneeName;

    const systemPrompt = `You are writing a first-reply acknowledgement email for Nurtur's tech support desk.
The customer has raised a ticket and an agent has been assigned. Write a short, warm, personal reply.

REQUIRED STRUCTURE:
1. Greeting — use the customer's first name
2. Acknowledgement — name what they raised, prove you read it
3. What happens next — name the assigned agent: "I've passed this to ${agentFirstName} in our Customer Care team who'll be looking into this for you."
4. Warm close — brief, human

RULES:
- No "your request has been logged with reference number..."
- No "a member of our team will be in contact at the earliest opportunity"
- No promises about specific timelines
- No technical jargon about queues or triage
- No corporate filler ("we value your custom", "rest assured")
- Sign off as "Kind regards,\\nNurtur Support"
- Keep it under 80 words
- Return ONLY the reply text, no JSON, no explanation`;

    const userMessage = `Ticket: ${opts.ticketKey}
Summary: ${opts.summary}
Description snippet: ${opts.description.slice(0, 300)}
Customer first name: ${firstName}
Assigned agent: ${opts.assigneeName}`;

    const GenericReplySchema = z.object({ reply: z.string() }) as z.ZodType<{ reply: string }>;

    try {
      const result = await this.llmService.call<{ reply: string }>(
        systemPrompt,
        userMessage + '\n\nReturn JSON: { "reply": "your reply text here" }',
        GenericReplySchema,
        { callType: 'generic_first_reply', tier: 'cheap' as any, temperature: 0.4 },
      );
      return result.data.reply;
    } catch (err) {
      console.warn(`[reasoner] Generic first reply LLM failed for ${opts.ticketKey}, using fallback:`, err instanceof Error ? err.message : err);
      return `Hi ${firstName},\n\nThanks for getting in touch about this. I've passed it to ${agentFirstName} in our Customer Care team who'll take a closer look.\n\nThey'll be in touch shortly.\n\nKind regards,\nNurtur Support`;
    }
  }

  async generateHandoffSummary(opts: {
    ticketKey: string;
    summary: string;
    category: string;
    ticketType: string;
    confidence: number;
    exchanges: Array<{ role: 'ai' | 'customer'; text: string; at: string }>;
    kbReferences: string[];
    recommendedNextSteps: string;
    assigneeName?: string;
  }): Promise<string> {
    const complexity = opts.confidence >= 0.85 ? 'simple' : opts.confidence >= 0.5 ? 'moderate' : 'complex';
    const exchangeLines = opts.exchanges.map(e => {
      const label = e.role === 'ai' ? 'AI replied' : 'Customer replied';
      return `- ${label} at ${e.at}: "${e.text.slice(0, 200)}"`;
    }).join('\n');

    const kbSection = opts.kbReferences.length > 0
      ? `\nKB References:\n${opts.kbReferences.map(r => `- ${r}`).join('\n')}`
      : '';

    const assignmentLine = opts.assigneeName
      ? `Assigned to: ${opts.assigneeName} (Customer Care, round-robin)\n`
      : '';

    // Format next steps: if JSON object, convert to readable bullets
    let nextStepsText = opts.recommendedNextSteps || 'Review ticket details and respond to customer.';
    try {
      const trimmed = nextStepsText.trim();
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          nextStepsText = Object.entries(parsed)
            .map(([key, value]) => `- ${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${value}`)
            .join('\n');
        }
      }
    } catch { /* not JSON, use as-is */ }

    return `🤖 NOVA Handoff Summary

Ticket: ${opts.ticketKey} — ${opts.summary}
Classification: ${opts.category} — ${opts.ticketType}
Complexity: ${complexity}
Confidence: ${(opts.confidence * 100).toFixed(0)}%
${assignmentLine}
What happened:
${exchangeLines || '- No AI exchanges recorded'}

Recommended next steps:
${nextStepsText}
${kbSection}`;
  }

  async generateHandoffMessage(opts: {
    reporterName: string;
    assigneeName: string | null;
    isWorkingHours: boolean;
    nextWorkingDay: string;
  }): Promise<string> {
    const firstName = opts.reporterName.split(/\s+/)[0] || opts.reporterName;

    if (opts.isWorkingHours && opts.assigneeName) {
      return `Hi ${firstName},\n\nI've gathered the details and passed this to ${opts.assigneeName} in our Customer Care team who'll take it from here.\n\nKind regards,\nNurtur Support`;
    }
    return `Hi ${firstName},\n\nI've gathered the details and passed this to our Customer Care team. They'll pick this up first thing on ${opts.nextWorkingDay}.\n\nKind regards,\nNurtur Support`;
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
