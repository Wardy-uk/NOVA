import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import type { LlmService } from './llm-service.js';
import type { ApprovalQueries } from '../db/queries.js';
import type { AgentState, AgentStatus, AgentDecision } from './agent-types.js';
import { Perceiver } from './perceiver.js';
import { Reasoner } from './reasoner.js';
import { Actor } from './actor.js';
import { Observer } from './observer.js';
import { KbSearchService } from './kb-search.js';
import { TicketStateStore } from './ticket-state.js';
import { StaleSweep } from './stale-sweep.js';
import { ResolutionReviewer } from './resolution-reviewer.js';
import { Guardrails, type GuardrailResult } from './guardrails.js';
import { QueueMonitor } from './queue-monitor.js';
import { AutonomyEngine } from './autonomy-engine.js';
import { AlertService } from './alert-service.js';
import { addBusinessHours, toSqliteDatetime } from '../utils/business-hours.js';

const DEFAULT_INTERVAL_MS = 60_000;
const HEALTH_STALE_THRESHOLD_MS = 10 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_TICKS = 30; // sweep every 30th tick (~30 min at 1 min interval)

export class AgentLoop {
  private state: AgentState = 'stopped';
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: Date | null = null;
  private tickCount = 0;
  private ticketsProcessed = 0;
  private errorCount = 0;
  private processing = false;

  private perceiver: Perceiver;
  private reasoner: Reasoner;
  private actor: Actor;
  private observer: Observer;
  private ticketState: TicketStateStore;
  private staleSweep: StaleSweep;
  private resolutionReviewer: ResolutionReviewer;
  private guardrails: Guardrails;
  private queueMonitor: QueueMonitor;
  private autonomyEngine: AutonomyEngine;
  private alertService: AlertService;
  private jiraClient: JiraRestClient;
  private llmService: LlmService;
  private settings: SettingsQueries;
  private approvalQueries: ApprovalQueries | null;
  private baseUrl: string;

  constructor(
    jiraClient: JiraRestClient,
    llmService: LlmService,
    settings: SettingsQueries,
    approvalQueries?: ApprovalQueries,
  ) {
    const kbSearch = new KbSearchService(settings);
    this.autonomyEngine = new AutonomyEngine();
    this.perceiver = new Perceiver(jiraClient, settings);
    this.reasoner = new Reasoner(llmService, kbSearch, this.autonomyEngine);
    this.actor = new Actor(jiraClient);
    this.observer = new Observer();
    this.ticketState = new TicketStateStore();
    this.staleSweep = new StaleSweep(jiraClient, settings, llmService);
    this.resolutionReviewer = new ResolutionReviewer(jiraClient, settings, llmService);
    this.guardrails = new Guardrails(settings);
    this.queueMonitor = new QueueMonitor(jiraClient, settings);
    this.alertService = new AlertService(settings);
    this.jiraClient = jiraClient;
    this.llmService = llmService;
    this.settings = settings;
    this.approvalQueries = approvalQueries ?? null;
    this.baseUrl = settings.get('sso_base_url') ?? process.env.FRONTEND_URL ?? 'http://localhost:3001';
  }

  get status(): AgentStatus {
    return {
      state: this.state,
      shadowMode: this.isShadowMode(),
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      tickCount: this.tickCount,
      ticketsProcessed: this.ticketsProcessed,
      intervalMs: this.getIntervalMs(),
      errors: this.errorCount,
    };
  }

  get isHealthy(): boolean {
    if (this.state !== 'running') return true;
    if (!this.lastTickAt) return true;
    return Date.now() - this.lastTickAt.getTime() < HEALTH_STALE_THRESHOLD_MS;
  }

  getObserver(): Observer {
    return this.observer;
  }

  getGuardrails(): Guardrails {
    return this.guardrails;
  }

  getAutonomyEngine(): AutonomyEngine {
    return this.autonomyEngine;
  }

  getAlertService(): AlertService {
    return this.alertService;
  }

  getActor(): Actor {
    return this.actor;
  }

  getJiraClient(): JiraRestClient {
    return this.jiraClient;
  }

  getLlmService(): LlmService {
    return this.llmService;
  }

  getPerceiver(): Perceiver {
    return this.perceiver;
  }

  start(): void {
    if (this.state === 'running') return;
    const intervalMs = this.getIntervalMs();
    this.state = 'running';
    console.log(`[agent] Starting agent loop (interval: ${intervalMs}ms)`);

    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = 'stopped';
    this.perceiver.resetLastTick();
    console.log('[agent] Agent loop stopped.');
  }

  pause(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = 'paused';
    console.log('[agent] Agent loop paused.');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.start();
  }

  private getIntervalMs(): number {
    const configured = this.settings.get('agent_interval_ms');
    if (configured) {
      const parsed = parseInt(configured, 10);
      if (!isNaN(parsed) && parsed >= 10_000) return parsed;
    }
    return DEFAULT_INTERVAL_MS;
  }

  private isShadowMode(): boolean {
    const val = this.settings.get('agent_shadow_mode');
    if (!val) return true; // default: shadow mode ON
    return val.toLowerCase() !== 'false' && val !== '0';
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    if (this.state !== 'running') return;

    this.processing = true;
    this.tickCount++;
    const tickStart = Date.now();

    try {
      console.log(`[agent] Tick #${this.tickCount} starting...`);

      // 1. PERCEIVE
      const perception = await this.perceiver.perceive();
      console.log(`[agent] Perceived: ${perception.totalOpen} open, ${perception.newEvents.length} new, ${perception.slaAtRisk.length} SLA risk`);

      // Merge all events worth processing
      const events = [
        ...perception.newEvents,
        ...perception.slaAtRisk,
      ];

      if (events.length === 0) {
        this.lastTickAt = new Date();
        console.log(`[agent] Tick #${this.tickCount} complete — no events to process (${Date.now() - tickStart}ms)`);
        return;
      }

      // Deduplicate by ticket key
      const seen = new Set<string>();
      const unique = events.filter(e => {
        if (seen.has(e.ticketKey)) return false;
        seen.add(e.ticketKey);
        return true;
      });

      // 2. REASON
      const shadow = this.isShadowMode();
      const decisions = await this.reasoner.decideMultiple(unique);
      for (const d of decisions) d.shadowMode = shadow;

      // 3. ACT + 4. OBSERVE
      for (const decision of decisions) {
        await this.executeDecision(decision);
      }

      // 5. QUEUE MONITOR + ALERTS
      await this.runQueueMonitor();

      // 6. SWEEP + RESOLUTION REVIEW (every Nth tick)
      const sweepInterval = this.getNumber('agent_sweep_interval_ticks', DEFAULT_SWEEP_INTERVAL_TICKS);
      if (this.tickCount % sweepInterval === 0) {
        await this.runSweep(shadow);
        await this.runResolutionReview(shadow);
      }

      this.lastTickAt = new Date();
      const tickDuration = Date.now() - tickStart;
      console.log(`[agent] Tick #${this.tickCount} complete — processed ${unique.length} events (${tickDuration}ms)`);

      // 7. TICK HEALTH ALERT (if tick took too long)
      await this.alertService.createLoopHealthAlert(tickDuration);

    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Tick #${this.tickCount} failed:`, err instanceof Error ? err.message : err);
    } finally {
      this.processing = false;
    }
  }

  private getNumber(key: string, fallback: number): number {
    const val = this.settings.get(key);
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  private async runQueueMonitor(): Promise<void> {
    try {
      const openIssues = this.perceiver.getLastOpenIssues();
      if (openIssues.length === 0) return;

      const health = await this.queueMonitor.analyse(openIssues);
      const alerts = await this.alertService.processQueueHealth(health);

      if (alerts.length > 0) {
        console.log(`[agent] Queue monitor generated ${alerts.length} alert(s)`);
      }
      if (health.slaBreachImminent.length > 0) {
        console.log(`[agent] SLA breach imminent: ${health.slaBreachImminent.map(t => `${t.ticketKey}(${t.minutesRemaining}m)`).join(', ')}`);
      }
      if (health.unassignedStale.length > 0) {
        console.log(`[agent] Unassigned stale tickets: ${health.unassignedStale.length}`);
      }
    } catch (err) {
      console.warn(`[agent] Queue monitor failed:`, err instanceof Error ? err.message : err);
    }
  }

  private async runSweep(shadow: boolean): Promise<void> {
    try {
      console.log(`[agent] Running stale ticket sweep...`);
      const result = await this.staleSweep.sweep();
      const all = [...result.aiRequestStuck, ...result.worChase, ...result.worAutoClose];
      for (const d of all) d.shadowMode = shadow;
      for (const decision of all) {
        await this.executeDecision(decision);
      }
      console.log(`[agent] Sweep complete — ${all.length} actions`);
    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Sweep failed:`, err instanceof Error ? err.message : err);
    }
  }

  private async runResolutionReview(shadow: boolean): Promise<void> {
    try {
      console.log(`[agent] Running resolution review...`);
      const decisions = await this.resolutionReviewer.reviewRecentResolutions();
      for (const d of decisions) d.shadowMode = shadow;
      for (const decision of decisions) {
        await this.executeDecision(decision);
      }
      console.log(`[agent] Resolution review complete — ${decisions.length} reviewed`);
    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Resolution review failed:`, err instanceof Error ? err.message : err);
    }
  }

  private async executeDecision(decision: AgentDecision): Promise<void> {
    const decisionId = await this.observer.logDecision(decision);

    // Track ticket state for conversation continuity
    try {
      await this.ticketState.updateAfterDecision(
        decision.ticketKey, decisionId, decision.eventType,
      );
    } catch (err) {
      console.warn(`[agent] Failed to update ticket state for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
    }

    // Always post internal note if we have one (internal notes are safe in shadow mode too)
    const internalNote = decision.output.internal_note as string | undefined;
    if (internalNote) {
      try {
        await this.jiraClient.addComment(decision.ticketKey, this.formatInternalNote(decision), { internal: true });
        console.log(`[agent] Posted internal note on ${decision.ticketKey}${decision.shadowMode ? ' [SHADOW]' : ''}`);
      } catch (err) {
        console.warn(`[agent] Failed to post internal note on ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    if (decision.action === 'no_action') {
      this.ticketsProcessed++;
      return;
    }

    // Guardrails validation — block actions that violate hard rules
    const guardrailResult = this.guardrails.validate(decision);
    if (!guardrailResult.allowed) {
      const violationSummary = guardrailResult.violations.map(v => `[${v.severity}] ${v.rule}: ${v.detail}`).join('; ');
      await this.observer.logOutcome(decisionId, {
        success: false,
        action: decision.action,
        ticketKey: decision.ticketKey,
        detail: `Blocked by guardrails: ${violationSummary}`,
        error: 'GUARDRAIL_VIOLATION',
      });
      console.warn(`[agent] Guardrail blocked ${decision.action} on ${decision.ticketKey}: ${violationSummary}`);
      this.ticketsProcessed++;
      return;
    }
    if (guardrailResult.violations.length > 0) {
      const warnings = guardrailResult.violations.map(v => v.detail).join('; ');
      console.warn(`[agent] Guardrail warnings for ${decision.ticketKey}: ${warnings}`);
    }

    // Shadow mode: log what WOULD happen but don't take external actions
    if (decision.shadowMode) {
      const wouldDo = decision.approvalRequired && decision.action === 'draft_response'
        ? 'submit to approval queue'
        : `execute ${decision.action}`;
      await this.observer.logOutcome(decisionId, {
        success: true,
        action: decision.action,
        ticketKey: decision.ticketKey,
        detail: `[SHADOW] Would ${wouldDo}. Draft: ${((decision.output.draft_response as string) ?? '').slice(0, 200)}`,
      });
      console.log(`[agent] [SHADOW] ${decision.ticketKey}: would ${wouldDo} (confidence: ${decision.confidence.toFixed(2)})`);
      this.ticketsProcessed++;
      return;
    }

    // Route based on action + approval requirement
    if (decision.approvalRequired && (decision.action === 'draft_response')) {
      await this.submitToApprovalQueue(decision, decisionId);
    } else {
      // Autonomous execution — log alert for visibility
      const autonomyCheck = this.reasoner.getLastAutonomyCheck();
      if (autonomyCheck?.allowed && decision.action === 'draft_response') {
        const classification = decision.output.classification as { category?: string } | undefined;
        await this.alertService.createAutonomyAlert({
          ticketKey: decision.ticketKey,
          action: decision.action,
          confidence: decision.confidence,
          category: classification?.category ?? 'unknown',
        });
        console.log(`[agent] Autonomous execution: ${decision.action} on ${decision.ticketKey}`);
      }

      const result = await this.actor.execute(decision);
      await this.observer.logOutcome(decisionId, result);
      if (!result.success) {
        this.errorCount++;
        console.warn(`[agent] Action failed for ${decision.ticketKey}: ${result.error}`);
      }
    }

    this.ticketsProcessed++;
  }

  private async submitToApprovalQueue(decision: AgentDecision, decisionId: number): Promise<void> {
    if (!this.approvalQueries) {
      console.warn(`[agent] No approval queries available — cannot submit ${decision.ticketKey} for approval`);
      return;
    }

    const classification = decision.output.classification as { category?: string; confidence?: number } | undefined;
    const draftResponse = (decision.output.draft_response as string) ?? '';

    const conversationJson = JSON.stringify({
      agent_decision_id: decisionId,
      classification,
      sentiment: decision.inputs.sentiment,
      sla_risk: decision.inputs.sla_risk,
      reasoning: decision.reasoning,
      provider: decision.provider,
      model: decision.model,
    });

    const expiresAt = toSqliteDatetime(addBusinessHours(new Date(), 2));

    try {
      const approvalId = await this.approvalQueries.create({
        ticket_id: decision.ticketKey,
        ticket_summary: (decision.inputs.summary as string) ?? decision.ticketKey,
        reporter_name: (decision.inputs.reporter as string) ?? undefined,
        reporter_email: undefined,
        ai_response_adf: draftResponse,
        conversation_json: conversationJson,
        kb_sources: JSON.stringify(decision.inputs.kb_matches ?? []),
        resume_url: `${this.baseUrl}/api/public/agent/approval-callback?ticketKey=${encodeURIComponent(decision.ticketKey)}`,
        priority: (decision.inputs.priority as string) ?? undefined,
        expires_at: expiresAt,
      });

      await this.observer.logOutcome(decisionId, {
        success: true,
        action: 'draft_response',
        ticketKey: decision.ticketKey,
        detail: `Submitted to approval queue (approval #${approvalId}). Confidence: ${decision.confidence.toFixed(2)}`,
      });

      console.log(`[agent] Submitted ${decision.ticketKey} to approval queue (id: ${approvalId})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.observer.logOutcome(decisionId, {
        success: false,
        action: 'draft_response',
        ticketKey: decision.ticketKey,
        detail: 'Failed to submit to approval queue.',
        error: errMsg,
      });
      this.errorCount++;
      console.error(`[agent] Failed to submit ${decision.ticketKey} to approval queue:`, errMsg);
    }
  }

  private formatInternalNote(decision: AgentDecision): string {
    const classification = decision.output.classification as { category?: string; sub_category?: string; confidence?: number } | undefined;
    const priorityAssessment = decision.output.priority_assessment as { suggested_priority?: number; reasoning?: string } | undefined;
    const internalNote = (decision.output.internal_note as string) ?? '';

    const shadowTag = decision.shadowMode ? ' [SHADOW MODE — observe only]' : '';
    const statusLine = decision.shadowMode
      ? `Status: Shadow mode — would ${decision.approvalRequired ? 'submit to approval queue' : 'execute ' + decision.action}`
      : decision.approvalRequired ? `Status: Submitted to approval queue` : `Status: Executing directly`;

    const lines = [
      `🤖 AI Agent Analysis${shadowTag} (${decision.provider ?? 'unknown'}/${decision.model ?? 'unknown'})`,
      ``,
      internalNote,
      ``,
      `Classification: ${classification?.category ?? 'unknown'} / ${classification?.sub_category ?? 'unknown'} (confidence: ${(classification?.confidence ?? 0).toFixed(2)})`,
      `Sentiment: ${(decision.inputs.sentiment as string) ?? 'unknown'}`,
      `SLA Risk: ${(decision.inputs.sla_risk as string) ?? 'unknown'}`,
      `Suggested Priority: ${priorityAssessment?.suggested_priority ?? 'unchanged'} — ${priorityAssessment?.reasoning ?? ''}`,
      `Recommended Action: ${decision.output.recommended_action ?? decision.action}`,
      `Confidence: ${decision.confidence.toFixed(2)}`,
      statusLine,
    ];

    return lines.join('\n');
  }

  async handleApprovalCallback(
    action: string,
    ticketKey: string,
    approvalId?: number,
    editedResponse?: string,
  ): Promise<void> {
    console.log(`[agent] Approval callback: ${action} for ${ticketKey} (approval #${approvalId ?? 'unknown'})`);

    // Find the agent decision ID from the most recent decision for this ticket
    const decisions = await this.observer.getDecisionsByTicket(ticketKey, 1) as Array<{ id: number }>;
    const decisionId = decisions[0]?.id;

    if (action === 'approve' || action === 'approved') {
      if (this.isShadowMode()) {
        console.log(`[agent] [SHADOW] Approval received for ${ticketKey} but shadow mode is active — not posting public comment.`);
        if (decisionId) {
          await this.observer.logOutcome(decisionId, {
            success: true, action: 'draft_response', ticketKey,
            detail: `[SHADOW] Approved by human but shadow mode blocked posting. Edited: ${editedResponse ? 'yes' : 'no'}`,
          });
        }
        return;
      }
      const responseText = editedResponse || '';
      if (responseText) {
        try {
          await this.jiraClient.addComment(ticketKey, responseText, { internal: false });
          console.log(`[agent] Posted approved response on ${ticketKey}`);
          if (decisionId) {
            await this.observer.logOutcome(decisionId, {
              success: true, action: 'draft_response', ticketKey,
              detail: `Approved and posted. Edited: ${editedResponse ? 'yes' : 'no'}`,
            });
          }
        } catch (err) {
          console.error(`[agent] Failed to post approved response on ${ticketKey}:`, err instanceof Error ? err.message : err);
          if (decisionId) {
            await this.observer.logOutcome(decisionId, {
              success: false, action: 'draft_response', ticketKey,
              detail: 'Approved but failed to post.', error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } else if (action === 'decline' || action === 'declined') {
      console.log(`[agent] Approval declined for ${ticketKey} — ticket remains in queue for human handling.`);
      if (decisionId) {
        await this.observer.logOutcome(decisionId, {
          success: true, action: 'draft_response', ticketKey,
          detail: 'Declined by human reviewer.',
        });
      }
    }
    // 'cancel' / 'cancelled' — no action needed
  }
}
