import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import type { LlmService } from './llm-service.js';
import type { ApprovalQueries } from '../db/queries.js';
import type { AgentState, AgentStatus, AgentDecision, AgentMode, AgentShadowMode, AssignedTicketMode } from './agent-types.js';
import type { KbEmbedder } from './kb-embedder.js';
import { Perceiver } from './perceiver.js';
import { Reasoner } from './reasoner.js';
import { Actor } from './actor.js';
import { Observer } from './observer.js';
import { KbSearchService } from './kb-search.js';
import { LifecycleManager } from './lifecycle-manager.js';
import { ResolutionReviewer } from './resolution-reviewer.js';
import type { JiraCacheQueries } from './jira-cache-queries.js';
import { Guardrails, type GuardrailResult } from './guardrails.js';
import { QueueMonitor } from './queue-monitor.js';
import { AutonomyEngine } from './autonomy-engine.js';
import { AlertService } from './alert-service.js';
import { TicketClassifier } from './ticket-classifier.js';
import { CoachingEngine } from './coach.js';
import { RiskScorer } from './risk-scorer.js';
import { PluginToTpjExecutor } from './plugin-to-tpj-executor.js';
import { AbuseReportExecutor } from './abuse-report-executor.js';
import { AutoRulesEngine } from './auto-rules-engine.js';
import { QuickWinExecutor } from './quick-win-executor.js';
import { ExternalDbService } from './external-db.js';
import { query, executeAndGetId } from './database.js';
import { EscalationLogService } from './escalation-log-service.js';
import { addBusinessHours, toSqliteDatetime } from '../utils/business-hours.js';
import { createHash } from 'crypto';
import type { AssignmentEngine, Pool } from './assignment-engine.js';

function looksLikeStructuredPayload(text: string): boolean {
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { JSON.parse(trimmed); return true; } catch { /* not valid JSON, continue checks */ }
  }
  const structuredKeys = ['"recommended_action"', '"draft_response"', '"internal_note"', '"classification"', '"confidence"', '"kb_gap"', '"priority_assessment"'];
  const matchCount = structuredKeys.filter(k => trimmed.includes(k)).length;
  return matchCount >= 2;
}

const FALLBACK_INTERVAL_MS = 60_000;
const FALLBACK_REDUCED_INTERVAL_MS = 5 * 60_000;
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
  private currentMode: AgentMode = 'full';
  private modeChangedAt: Date | null = null;
  private recentlyProcessedTickets = new Map<string, number>();

  private perceiver: Perceiver;
  private reasoner: Reasoner;
  private actor: Actor;
  private observer: Observer;
  private lifecycleManager: LifecycleManager;
  private resolutionReviewer: ResolutionReviewer;
  private guardrails: Guardrails;
  private queueMonitor: QueueMonitor;
  private autonomyEngine: AutonomyEngine;
  private alertService: AlertService;
  private ticketClassifier: TicketClassifier;
  private coachingEngine: CoachingEngine;
  private riskScorer: RiskScorer;
  private pluginExecutor: PluginToTpjExecutor;
  private abuseExecutor: AbuseReportExecutor | null = null;
  private autoRulesEngine: AutoRulesEngine;
  private quickWinExecutor: QuickWinExecutor;
  private externalDb: ExternalDbService;
  private kbSearch: KbSearchService;
  private jiraClient: JiraRestClient;
  private llmService: LlmService;
  private settings: SettingsQueries;
  private approvalQueries: ApprovalQueries | null;
  private baseUrl: string;
  private assignmentEngine: AssignmentEngine | null = null;

  constructor(
    jiraClient: JiraRestClient,
    llmService: LlmService,
    settings: SettingsQueries,
    approvalQueries?: ApprovalQueries,
    cache?: JiraCacheQueries,
  ) {
    this.kbSearch = new KbSearchService(settings);
    this.autonomyEngine = new AutonomyEngine();
    this.perceiver = new Perceiver(jiraClient, settings, cache);
    this.reasoner = new Reasoner(llmService, this.kbSearch, this.autonomyEngine);
    this.actor = new Actor(jiraClient, new EscalationLogService(), settings);
    this.actor.setLlmService(llmService);
    this.observer = new Observer();
    this.observer.setSettings(settings);
    this.alertService = new AlertService(settings);
    llmService.setAlertService(this.alertService);
    this.lifecycleManager = new LifecycleManager(
      settings, jiraClient, this.alertService, this.observer,
      approvalQueries, cache, llmService,
    );
    this.reasoner.setLifecycleManager(this.lifecycleManager);
    this.resolutionReviewer = new ResolutionReviewer(jiraClient, settings, llmService);
    this.guardrails = new Guardrails(settings);
    this.queueMonitor = new QueueMonitor(jiraClient, settings);
    const agentProject = settings.get('agent_jira_project') || 'NT';
    const primaryProject = agentProject.split(',')[0].trim();
    this.ticketClassifier = new TicketClassifier(llmService, jiraClient, primaryProject);
    this.coachingEngine = new CoachingEngine(llmService, jiraClient, primaryProject);
    this.riskScorer = new RiskScorer(settings);
    this.pluginExecutor = new PluginToTpjExecutor(jiraClient, settings);
    this.autoRulesEngine = new AutoRulesEngine(jiraClient, this.pluginExecutor, this.observer, settings);
    this.quickWinExecutor = new QuickWinExecutor(jiraClient, settings, this.observer);
    this.externalDb = new ExternalDbService(settings);
    if (approvalQueries) {
      this.abuseExecutor = new AbuseReportExecutor(jiraClient, settings, approvalQueries, this.externalDb);
      this.autoRulesEngine.setAbuseExecutor(this.abuseExecutor);
    }
    this.jiraClient = jiraClient;
    this.llmService = llmService;
    this.settings = settings;
    this.approvalQueries = approvalQueries ?? null;
    this.baseUrl = settings.get('sso_base_url') ?? process.env.FRONTEND_URL ?? 'http://localhost:3001';
  }

  setKbEmbedder(embedder: KbEmbedder): void {
    this.kbSearch.setEmbedder(embedder);
  }

  setAssignmentEngine(engine: AssignmentEngine): void {
    this.assignmentEngine = engine;
  }

  getSettings(): SettingsQueries { return this.settings; }

  get status(): AgentStatus {
    return {
      state: this.state,
      shadowMode: this.getShadowMode() === 'full_shadow',
      shadowModeEnum: this.getShadowMode(),
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      tickCount: this.tickCount,
      ticketsProcessed: this.ticketsProcessed,
      intervalMs: this.getIntervalMs(),
      errors: this.errorCount,
      mode: this.currentMode,
      modeChangedAt: this.modeChangedAt?.toISOString() ?? null,
      weekendOverrideUntil: this.getWeekendOverrideUntil(),
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

  getReasoner(): Reasoner {
    return this.reasoner;
  }

  getRiskScorer(): RiskScorer {
    return this.riskScorer;
  }

  getAlertService(): AlertService {
    return this.alertService;
  }

  getAutoRulesEngine(): AutoRulesEngine {
    return this.autoRulesEngine;
  }

  getQuickWinExecutor(): QuickWinExecutor {
    return this.quickWinExecutor;
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

  getLifecycleManager(): LifecycleManager {
    return this.lifecycleManager;
  }

  start(mode?: string): void {
    if (this.state === 'running') return;
    const working = this.isWorkingHours();
    this.currentMode = working ? 'full' : 'reduced';
    this.modeChangedAt = new Date();
    const intervalMs = this.getIntervalMs();
    this.state = 'running';
    const debug = this.getWorkingHoursDebug();
    console.log(`[agent] Starting agent loop (interval: ${intervalMs}ms, mode: ${this.currentMode}, isWorkingHours=${working}, tz=${debug.tz}, day=${debug.parsedWeekday}/${debug.parsedDay}, time=${debug.parsedHour}:${String(debug.parsedMinute ?? '').padStart(2, '0')}, days=${debug.workingDays}, hours=${debug.workingHours})`);

    this.persistRunState('running', mode);

    this.checkAutonomyReadiness().catch(() => {});
    this.riskScorer.runStartupCleanup().catch(err => {
      console.warn('[agent] Startup cleanup failed:', err instanceof Error ? err.message : err);
    });

    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  private async checkAutonomyReadiness(): Promise<void> {
    try {
      const existingRules = await this.autonomyEngine.getRules();

      const qualifying = await query<{ category: string; total: number; approved: number; avg_conf: number }>(
        `SELECT
           JSON_VALUE(inputs, '$.classification.category') as category,
           COUNT(*) as total,
           SUM(CASE WHEN outcome LIKE '%Approved%' OR outcome LIKE '%success%' OR outcome LIKE '%auto%' THEN 1 ELSE 0 END) as approved,
           AVG(confidence) as avg_conf
         FROM agent_decisions
         WHERE created_at >= DATEADD(day, -90, GETUTCDATE())
           AND JSON_VALUE(inputs, '$.classification.category') IS NOT NULL
         GROUP BY JSON_VALUE(inputs, '$.classification.category')
         HAVING COUNT(*) >= 50`,
      );

      const existingCategories = new Set(existingRules.map(r => r.category));
      const candidates = qualifying.filter(r => {
        const acceptRate = r.total > 0 ? (r.approved / r.total) * 100 : 0;
        return acceptRate >= 85 && r.avg_conf >= 0.85 && !existingCategories.has(r.category);
      });

      if (existingRules.length === 0 && candidates.length > 0) {
        console.log(`[Autonomy] No rules configured. ${candidates.length} categories qualify for autonomy. Run POST /api/agent/suggestions/refresh to generate suggestions.`);

        // Seed conservative disabled rules for categories with >95% accept rate (draft_response only)
        for (const cat of candidates) {
          const acceptRate = cat.total > 0 ? (cat.approved / cat.total) * 100 : 0;
          if (acceptRate >= 95 && cat.avg_conf >= 0.92) {
            const id = await this.autonomyEngine.createRule({
              category: cat.category,
              subCategory: null,
              enabled: false,
              minConfidence: 0.92,
              minAcceptRate: 95,
              minQaScore: 0,
              minDecisions: 50,
              autonomousActions: ['draft_response'],
              updatedBy: 'system-seed',
            });
            console.log(`[Autonomy] Seeded disabled rule ${id} for "${cat.category}" (${cat.total} decisions, ${acceptRate.toFixed(0)}% accept, ${cat.avg_conf.toFixed(2)} avg conf) — enable from Autonomy tab`);
          }
        }
      } else if (existingRules.length > 0) {
        const enabled = existingRules.filter(r => r.enabled).length;
        console.log(`[Autonomy] ${existingRules.length} rules configured (${enabled} enabled).`);
      }
    } catch (err) {
      console.warn('[Autonomy] Readiness check failed:', err instanceof Error ? err.message : err);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = 'stopped';
    this.perceiver.resetLastTick();
    this.persistRunState('stopped');
    console.log('[agent] Agent loop stopped.');
  }

  pause(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = 'paused';
    this.persistRunState('paused');
    console.log('[agent] Agent loop paused.');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.start();
  }

  private persistRunState(state: AgentState, mode?: string): void {
    try {
      this.settings.set('agent_running_state', state);
      if (mode) this.settings.set('agent_running_mode', mode);
      const ts = new Date().toISOString();
      if (state === 'running') this.settings.set('agent_last_started_at', ts);
      else if (state === 'stopped') this.settings.set('agent_last_stopped_at', ts);
    } catch (err) {
      console.warn('[agent] Failed to persist run state:', err instanceof Error ? err.message : err);
    }
  }

  private getIntervalMs(): number {
    if (this.currentMode === 'reduced') {
      const reducedCfg = this.settings.get('agent_tick_reduced_interval_ms');
      if (reducedCfg) {
        const parsed = parseInt(reducedCfg, 10);
        if (!isNaN(parsed) && parsed >= 30_000) return parsed;
      }
      return FALLBACK_REDUCED_INTERVAL_MS;
    }
    const configured = this.settings.get('agent_tick_interval_ms') || this.settings.get('agent_interval_ms');
    if (configured) {
      const parsed = parseInt(configured, 10);
      if (!isNaN(parsed) && parsed >= 10_000) return parsed;
    }
    return FALLBACK_INTERVAL_MS;
  }

  private isWeekendModeEnabled(): boolean {
    const val = this.settings.get('agent_weekend_mode');
    if (!val) return true; // default: enabled
    return val.toLowerCase() !== 'false' && val !== '0';
  }

  private getWeekendOverrideUntil(): string | null {
    const raw = this.settings.get('agent_weekend_override_until');
    if (!raw) return null;
    const until = new Date(raw);
    if (isNaN(until.getTime())) return null;
    if (until.getTime() <= Date.now()) {
      this.settings.set('agent_weekend_override_until', '');
      console.log(`[agent] Weekend override expired, reverting to normal schedule`);
      return null;
    }
    return until.toISOString();
  }

  setWeekendOverride(until: Date): void {
    this.settings.set('agent_weekend_override_until', until.toISOString());
    console.log(`[agent] Weekend override set until ${until.toISOString()}`);
    if (this.currentMode === 'reduced') {
      this.currentMode = 'full';
      this.modeChangedAt = new Date();
      this.restartTimer();
    }
  }

  clearWeekendOverride(): void {
    this.settings.set('agent_weekend_override_until', '');
    console.log(`[agent] Weekend override cleared`);
    this.checkModeTransition();
  }

  getWorkingHoursDebug(): Record<string, unknown> {
    const tz = this.settings.get('agent_timezone') || 'Europe/London';
    const weekendModeEnabled = this.isWeekendModeEnabled();
    const overrideUntil = this.getWeekendOverrideUntil();

    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
      });
      const parts = fmt.formatToParts(new Date());
      const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
      const dayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const day = dayNames[p.weekday] ?? -1;
      const hh = parseInt(p.hour, 10);
      const mi = parseInt(p.minute, 10);
      const workingDaysStr = this.settings.get('agent_working_days') || '1,2,3,4,5';
      const hoursStr = this.settings.get('agent_working_hours') || '08:00-18:00';

      return {
        tz, weekendModeEnabled, overrideUntil,
        rawParts: parts, parsedWeekday: p.weekday, parsedDay: day,
        parsedHour: hh, parsedMinute: mi, currentMinutes: hh * 60 + mi,
        workingDays: workingDaysStr, workingHours: hoursStr,
        result: this.isWorkingHours(),
        fallbackDay: new Date().getDay(), utcHour: new Date().getUTCHours(),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), tz, weekendModeEnabled, overrideUntil };
    }
  }

  private isWorkingHours(): boolean {
    if (!this.isWeekendModeEnabled()) return true;

    if (this.getWeekendOverrideUntil()) return true;

    try {
      const tz = this.settings.get('agent_timezone') || 'Europe/London';
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
      });
      const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
      const dayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const day = dayNames[p.weekday] ?? new Date().getDay();
      const hh = parseInt(p.hour, 10);
      const mi = parseInt(p.minute, 10);

      const workingDaysStr = (this.settings.get('agent_working_days') || '1,2,3,4,5').trim();
      const workingDays = new Set(workingDaysStr.split(',').map(d => parseInt(d.trim(), 10)));
      if (!workingDays.has(day)) {
        if (this.currentMode === 'full') {
          console.log(`[agent] isWorkingHours=false: day=${day} (${p.weekday}) not in workingDays=[${workingDaysStr}] tz=${tz}`);
        }
        return false;
      }

      const hoursStr = (this.settings.get('agent_working_hours') || '08:00-18:00').trim();
      const match = hoursStr.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!match) {
        console.warn(`[agent] isWorkingHours: invalid hours format "${hoursStr}", defaulting to working hours`);
        return true;
      }
      const startMinutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      const endMinutes = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
      const currentMinutes = hh * 60 + mi;

      const result = currentMinutes >= startMinutes && currentMinutes < endMinutes;
      if (!result && this.currentMode === 'full') {
        console.log(`[agent] isWorkingHours=false: ${hh}:${String(mi).padStart(2, '0')} outside ${hoursStr} tz=${tz}`);
      }
      return result;
    } catch (err) {
      console.error(`[agent] isWorkingHours threw, fail-open to working hours:`, err instanceof Error ? err.message : err);
      return true;
    }
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    const intervalMs = this.getIntervalMs();
    this.timer = setInterval(() => this.tick(), intervalMs);
    console.log(`[agent] Timer restarted with interval ${intervalMs}ms`);
  }

  private async checkModeTransition(): Promise<boolean> {
    const shouldBeFull = this.isWorkingHours();
    const newMode: AgentMode = shouldBeFull ? 'full' : 'reduced';
    if (newMode === this.currentMode) return false;

    const oldMode = this.currentMode;
    this.currentMode = newMode;
    this.modeChangedAt = new Date();

    if (newMode === 'full') {
      console.log(`[agent] Resuming full mode (working hours started)`);
      this.restartTimer();
      // Run immediate full sweep to catch up on paused tasks
      const catchUpShadow = this.getShadowMode() === 'full_shadow';
      console.log(`[agent] Running catch-up sweep after hours...`);
      await this.runLifecycleSweep(catchUpShadow);
      await this.runResolutionReview(catchUpShadow);
      await this.runTicketClassification();
      await this.runCoachingHealthChecks();
      await this.runRiskSweep();
      console.log(`[agent] Catch-up sweep complete`);
    } else {
      console.log(`[agent] Entering reduced mode (outside working hours)`);
      this.restartTimer();
    }

    return true;
  }

  private getShadowMode(): AgentShadowMode {
    const val = this.settings.get('agent_shadow_mode');
    if (!val) return 'full_shadow';
    if (val === 'hybrid') return 'hybrid';
    if (val === 'live' || val === 'false' || val === '0') return 'live';
    return 'full_shadow';
  }

  private isShadowMode(): boolean {
    return this.getShadowMode() === 'full_shadow';
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    if (this.state !== 'running') return;

    this.processing = true;
    this.tickCount++;
    const tickStart = Date.now();

    try {
      await this.checkModeTransition();
      console.log(`[agent] Tick #${this.tickCount} starting... (${this.currentMode} mode)`);

      // 1. PERCEIVE
      const perception = await this.perceiver.perceive();
      console.log(`[agent] Perceived: ${perception.totalOpen} open, ${perception.newEvents.length} new, ${perception.slaAtRisk.length} SLA risk`);

      // Only send actionable events to the reasoner — SLA warnings are
      // informational (shown in perception stats) and handled by alerts, not decisions.
      const events = [
        ...perception.newEvents,
      ];

      // Deduplicate by ticket key
      const seen = new Set<string>();
      const unique = events.filter(e => {
        if (seen.has(e.ticketKey)) return false;
        seen.add(e.ticketKey);
        return true;
      });

      // Cross-tick dedup: skip tickets processed in the last 30 minutes
      const DEDUP_WINDOW_MS = 30 * 60_000;
      const now = Date.now();
      for (const [key, ts] of this.recentlyProcessedTickets) {
        if (now - ts > DEDUP_WINDOW_MS) this.recentlyProcessedTickets.delete(key);
      }
      const deduped = unique.filter(e => {
        const key = `${e.ticketKey}:${e.eventType}`;
        if (this.recentlyProcessedTickets.has(key)) {
          console.log(`[agent] Skipping ${e.ticketKey} (${e.eventType}) — already processed this cycle`);
          return false;
        }
        return true;
      });

      // 1.5 AUTO-RULES EVALUATION (config-driven, deterministic — replaces hybrid detector)
      // All deterministic actions (plugin_to_tpj, abuse_report, auto-close, tier routing)
      // are now handled by the unified auto-rules engine. They execute in hybrid + live mode
      // and are shadowed only in full_shadow mode. No weekend exemption check needed —
      // deterministic rules are safe by definition.
      const autoRuleHandledKeys = new Set<string>();
      const shadowModeForRules = this.getShadowMode();
      for (const event of deduped) {
        try {
          const handled = await this.autoRulesEngine.evaluateAndExecute(event, shadowModeForRules);
          if (handled) {
            autoRuleHandledKeys.add(event.ticketKey);
            this.ticketsProcessed++;
            const ticketState = this.lifecycleManager.getTicketState();
            try {
              await ticketState.transition(event.ticketKey, 'triaged');
            } catch (tsErr) {
              console.warn(`[agent] Failed to write ticket state for auto-rule on ${event.ticketKey}:`, tsErr instanceof Error ? tsErr.message : tsErr);
            }
          }
        } catch (err) {
          console.error(`[agent] Auto-rule evaluation failed for ${event.ticketKey}:`, err instanceof Error ? err.message : err);
        }
      }

      const llmEvents = deduped.filter(e => !autoRuleHandledKeys.has(e.ticketKey));

      // 2. REASON
      const shadowMode = this.getShadowMode();
      const decisions = await this.reasoner.decideMultiple(llmEvents);
      for (const d of decisions) {
        if (shadowMode === 'full_shadow') {
          d.shadowMode = true;
        } else if (shadowMode === 'hybrid') {
          const allowedRaw = this.settings.get('agent_hybrid_allowed_actions') ?? '[]';
          let allowed: string[] = [];
          try { allowed = JSON.parse(allowedRaw); } catch {}
          d.shadowMode = !allowed.includes(d.action);
        } else {
          d.shadowMode = false;
        }
      }

      // 3. ACT + 4. OBSERVE
      for (const decision of decisions) {
        await this.executeDecision(decision);
      }

      // Mark processed for cross-tick dedup
      for (const d of decisions) {
        this.recentlyProcessedTickets.set(`${d.ticketKey}:${d.eventType}`, Date.now());
      }
      for (const key of autoRuleHandledKeys) {
        this.recentlyProcessedTickets.set(`${key}:ticket_created`, Date.now());
      }

      // 5. QUEUE MONITOR + ALERTS
      await this.runQueueMonitor();

      // 6. LIFECYCLE SWEEP + RESOLUTION REVIEW + CLASSIFICATION + COACHING (every Nth tick)
      const sweepInterval = this.getNumber('agent_sweep_interval_ticks', DEFAULT_SWEEP_INTERVAL_TICKS);
      const isFirstSweep = this.tickCount === 1;
      if (isFirstSweep || this.tickCount % sweepInterval === 0) {
        // Lifecycle manager runs in all modes (approval timeouts + SLA breaches matter out of hours)
        await this.runLifecycleSweep(shadowMode === 'full_shadow');

        // These only run during working hours
        if (this.currentMode === 'full') {
          await this.runResolutionReview(shadowMode === 'full_shadow');
          await this.runTicketClassification();
          await this.runCoachingHealthChecks();
          await this.runRiskSweep();
        }
      }

      // 7. BACKFILL TRIAGE (every tick — batch-limited, no-op when caught up)
      // Runs in all modes (shadow-only, no LLM budget concern outside hours)
      await this.runBackfillTriage();

      // 8. EXTENDED SWEEPS (every Nth sweep tick, during working hours only)
      if ((isFirstSweep || this.tickCount % sweepInterval === 0) && this.currentMode === 'full') {
        await this.runApprovalSlaSweep();
        await this.runPipelineHealthCheck();
        await this.runChaseSweep(shadowMode);
        await this.runUnassignedSweep();
        await this.runPatternExtraction();

        // Weekly memory compaction (every ~168th sweep ≈ weekly)
        if (this.tickCount % (sweepInterval * 168) === 0) {
          await this.runMemoryCompaction();
        }
      }

      this.lastTickAt = new Date();
      const tickDuration = Date.now() - tickStart;
      console.log(`[agent] Tick #${this.tickCount} complete — processed ${deduped.length} events (${tickDuration}ms)`);

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

  private async runLifecycleSweep(shadow: boolean): Promise<void> {
    try {
      console.log(`[agent] Running lifecycle sweep...`);
      const result = await this.lifecycleManager.sweep(shadow);
      const total = result.approvalTimeouts + result.customerReplies + result.staleTransitions
        + result.chaseSent + result.autoCloseCandidates + result.autoClosed;
      console.log(`[agent] Lifecycle sweep complete — ${total} actions (timeouts: ${result.approvalTimeouts}, replies: ${result.customerReplies}, stale: ${result.staleTransitions}, chased: ${result.chaseSent}, closed: ${result.autoClosed})`);
    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Lifecycle sweep failed:`, err instanceof Error ? err.message : err);
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

  private async runTicketClassification(): Promise<void> {
    try {
      console.log(`[agent] Running ticket classification...`);
      const results = await this.ticketClassifier.classifyResolved(24);
      console.log(`[agent] Classification complete — ${results.length} tickets classified`);
    } catch (err) {
      console.warn(`[agent] Ticket classification failed:`, err instanceof Error ? err.message : err);
    }
  }

  private async runCoachingHealthChecks(): Promise<void> {
    try {
      const openIssues = this.perceiver.getLastOpenIssues();
      console.log(`[agent] Coaching health checks starting — ${openIssues.length} open issues available`);
      if (openIssues.length === 0) return;

      let checked = 0;
      let nudgeCount = 0;
      for (const issue of openIssues.slice(0, 20)) {
        const assignee = (issue.fields as any)?.assignee?.accountId;
        if (!assignee) continue;

        const nudges = await this.coachingEngine.checkTicketHealth(issue.key, assignee);
        if (nudges.length > 0) {
          console.log(`[agent] Coaching health check: ${issue.key} — ${nudges.join(', ')}`);
          nudgeCount += nudges.length;
        }
        checked++;
      }
      console.log(`[agent] Coaching health checks complete — ${checked} tickets checked, ${nudgeCount} nudges generated`);
    } catch (err) {
      console.warn(`[agent] Coaching health checks failed:`, err instanceof Error ? err.message : err);
    }
  }

  private async runRiskSweep(): Promise<void> {
    try {
      const agentProject = this.settings.get('agent_jira_project') || 'NT';
      const projects = agentProject.split(',').map(p => p.trim()).filter(Boolean);
      if (projects.length === 0) return;

      console.log(`[agent] Running risk sweep...`);
      const result = await this.riskScorer.runRiskSweep(projects);
      console.log(`[agent] Risk sweep complete — ${result.flagged} flagged, ${result.notified} notified`);
    } catch (err) {
      console.warn(`[agent] Risk sweep failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── B1: Approval SLA sweep ──
  private async runApprovalSlaSweep(): Promise<void> {
    try {
      const slaHours = this.getNumber('agent_approval_sla_hours', 4);
      const autoAction = this.settings.get('agent_approval_auto_action') ?? 'decline';
      const alertOnBreach = this.settings.get('agent_approval_alert_on_breach') !== 'false';

      const overdue = await query<{ id: number; ticket_id: string; hours_waiting: number }>(
        `SELECT id, ticket_id, DATEDIFF(hour, created_at, GETUTCDATE()) as hours_waiting
         FROM agent_approvals
         WHERE status = 'pending'
           AND DATEDIFF(hour, created_at, GETUTCDATE()) >= ?`,
        [slaHours],
      );

      if (overdue.length === 0) return;
      console.log(`[agent] Approval SLA: ${overdue.length} overdue approvals found`);

      for (const approval of overdue) {
        try {
          // Mark SLA breach timestamp
          await executeAndGetId(
            `UPDATE agent_approvals SET sla_breached_at = GETUTCDATE() WHERE id = ? AND sla_breached_at IS NULL`,
            [approval.id],
          );

          if (autoAction === 'decline') {
            await this.approvalQueries?.decide(approval.id, 'declined', 'system-sla-breach');
            console.log(`[agent] Auto-declined approval #${approval.id} for ${approval.ticket_id} (${approval.hours_waiting}h overdue)`);
          } else if (autoAction === 'approve') {
            await this.handleApprovalCallback('approve', approval.ticket_id, approval.id, undefined, 'system-sla-breach');
            console.log(`[agent] Auto-approved approval #${approval.id} for ${approval.ticket_id} (${approval.hours_waiting}h overdue)`);
          }

          if (alertOnBreach) {
            await this.alertService.createAlert({
              alertType: 'approval_sla_warning',
              severity: 'warning',
              title: `Approval SLA breach: ${approval.ticket_id} waiting ${approval.hours_waiting}h`,
              detail: `Auto-action: ${autoAction}. Threshold: ${slaHours}h`,
              ticketKey: approval.ticket_id,
            });
          }
        } catch (err) {
          console.warn(`[agent] Failed to process overdue approval #${approval.id}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('[agent] Approval SLA sweep failed:', err instanceof Error ? err.message : err);
    }
  }

  // ── B2: Pipeline health check ──
  private async runPipelineHealthCheck(): Promise<void> {
    const enabled = this.settings.get('agent_pipeline_health_enabled') !== 'false';
    if (!enabled) return;

    const windowHours = this.getNumber('agent_pipeline_health_window_hours', 24);

    const checks = [
      { name: 'decisions', table: 'agent_decisions', minPerDay: 5 },
      { name: 'classifications', table: 'ticket_classifications', minPerDay: 5 },
      { name: 'coaching', table: 'agent_coaching', minPerDay: 1 },
      { name: 'kb_gaps', table: 'kb_gap_log', minPerDay: 0 },
      { name: 'kb_drafts', table: 'kb_article_drafts', minPerDay: 0 },
    ];

    try {
      for (const check of checks) {
        if (check.minPerDay === 0) continue;
        try {
          const rows = await query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM ${check.table} WHERE created_at > DATEADD(hour, -${windowHours}, GETUTCDATE())`,
          );
          const count = rows[0]?.cnt ?? 0;
          if (count < check.minPerDay) {
            await this.alertService.createAlert({
              alertType: 'error',
              severity: 'warning',
              title: `Pipeline health: ${check.name} produced ${count} outputs in ${windowHours}h (threshold: ${check.minPerDay})`,
              detail: `Pipeline "${check.name}" may be stalled. Check logs for errors.`,
            });
            console.warn(`[agent] Pipeline health: ${check.name} below threshold (${count}/${check.minPerDay})`);
          }
        } catch { /* table may not exist yet */ }
      }
    } catch (err) {
      console.warn('[agent] Pipeline health check failed:', err instanceof Error ? err.message : err);
    }
  }

  // ── C1: Chase sweep ──
  private async runChaseSweep(shadowMode: AgentShadowMode): Promise<void> {
    const enabled = this.settings.get('agent_chase_enabled') !== 'false';
    if (!enabled) return;

    const afterDays = this.getNumber('agent_chase_after_days', 5);
    const intervalDays = this.getNumber('agent_chase_interval_days', 3);
    const maxCount = this.getNumber('agent_chase_max_count', 2);
    const batchSize = this.getNumber('agent_chase_batch_size', 10);

    try {
      const staleWaiting = await query<{
        issue_key: string; summary: string; status_name: string;
        assignee_email: string; reporter_display: string; reporter_email: string;
        organisation: string; days_stale: number;
      }>(
        `SELECT TOP (${batchSize}) c.issue_key, c.summary, c.status_name, c.assignee_email,
                c.reporter_display, c.reporter_email, c.organisation,
                DATEDIFF(day, c.jira_updated, GETUTCDATE()) as days_stale
         FROM jira_issue_cache c
         LEFT JOIN agent_decisions d ON d.ticket_id = c.issue_key AND d.action = 'chase'
           AND d.created_at > DATEADD(day, -${intervalDays}, GETUTCDATE())
         WHERE c.status_name IN ('Waiting on Customer', 'Waiting for Customer')
           AND c.status_category != 'done'
           AND DATEDIFF(day, c.jira_updated, GETUTCDATE()) >= ${afterDays}
           AND d.id IS NULL
         ORDER BY c.jira_updated ASC`,
      );

      if (staleWaiting.length === 0) return;
      console.log(`[agent] Chase sweep: ${staleWaiting.length} stale tickets found`);

      for (const ticket of staleWaiting) {
        // Check chase count cap
        const priorChases = await query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM agent_decisions WHERE ticket_id = ? AND action = 'chase'`,
          [ticket.issue_key],
        );
        if ((priorChases[0]?.cnt ?? 0) >= maxCount) {
          console.log(`[agent] Chase: ${ticket.issue_key} already chased ${priorChases[0]?.cnt} times — skipping`);
          continue;
        }

        const chaseText = `Hi,\n\nWe're following up on ${ticket.issue_key} — "${ticket.summary}".\n\nWe've been waiting for your reply for ${ticket.days_stale} days. Could you let us know if you still need help with this issue?\n\nIf we don't hear back within 5 working days, we'll close this ticket automatically. You can always raise a new ticket or reply to this one to reopen it.\n\nThanks,\nNurtur Support`;

        const decision: import('./agent-types.js').AgentDecision = {
          ticketId: ticket.issue_key,
          ticketKey: ticket.issue_key,
          eventType: 'stale',
          action: 'chase',
          confidence: 1.0,
          reasoning: `Ticket waiting on customer for ${ticket.days_stale} days — automated chase per SOP-003`,
          approvalRequired: shadowMode === 'hybrid',
          shadowMode: shadowMode === 'full_shadow',
          inputs: { summary: ticket.summary, status: ticket.status_name, updated: new Date(Date.now() - ticket.days_stale * 86400000).toISOString() },
          output: { draft_response: chaseText, recommended_action: 'chase' },
        };

        if (shadowMode === 'full_shadow') {
          const decisionId = await this.observer.logDecision(decision);
          await this.observer.logOutcome(decisionId, {
            success: true, action: 'chase', ticketKey: ticket.issue_key,
            detail: `[SHADOW] Would chase (${ticket.days_stale} days stale)`,
          });
        } else if (shadowMode === 'hybrid') {
          await this.submitToApprovalQueue(decision, await this.observer.logDecision(decision));
        } else {
          await this.executeDecision(decision);
        }
      }
    } catch (err) {
      console.warn('[agent] Chase sweep failed:', err instanceof Error ? err.message : err);
    }
  }

  // ── C2: Auto-assign after triage ──
  private async tryAutoAssign(decision: import('./agent-types.js').AgentDecision): Promise<void> {
    if (!this.assignmentEngine) return;
    const project = this.assignmentEngine.resolveProjectFromTicketKey(decision.ticketKey);
    const pool = this.determinePool(decision, project);

    try {
      const assignment = await this.assignmentEngine.assignWithFallback(
        decision.ticketKey, pool, project,
      );

      if (assignment) {
        console.log(`[agent] Assigned ${decision.ticketKey} → ${assignment.agent.display_name} (${pool}, ${project})`);
        decision.inputs.assignee = assignment.agent.jira_account_id;
        decision.inputs.assigneeName = assignment.agent.display_name;
        await this.assignmentEngine.postAssignmentComment(decision.ticketKey, assignment);
      } else if (this.assignmentEngine.isWorkingTime()) {
        console.warn(`[agent] No available agents for ${decision.ticketKey} in pool ${pool}`);
        await this.alertService.createAlert({
          alertType: 'error',
          severity: 'warning',
          title: `Assignment failed: ${decision.ticketKey}`,
          detail: `No available agents in pool ${pool} (project ${project}). Ticket is unassigned.`,
        });
      } else {
        console.log(`[agent] ${decision.ticketKey} queued for assignment — outside working hours`);
      }
    } catch (err) {
      console.error(`[agent] Assignment failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
    }
  }

  private determinePool(decision: import('./agent-types.js').AgentDecision, project: string): Pool {
    if (project === 'NTPJ') return 'tpj';

    const action = decision.action || (decision.output?.recommended_action as string);
    if (action === 'escalate') return 't2';

    const category = (decision.output?.classification as any)?.category
      || (decision.output?.category as string)
      || (decision.inputs?.category as string);

    const t2Categories = [
      'integration_issue', 'api_error', 'data_migration', 'server_error',
      'database_issue', 'feed_issue', 'technical_escalation',
    ];
    if (category && t2Categories.includes(category)) return 't2';

    return 'cc';
  }

  // ── C3: Unassigned ticket sweep (48-hour catch-up) ──
  // Catches tickets missed by event-driven assignment: pool resolution failures,
  // downtime gaps, restarts, or any silent assignment failures.
  private async runUnassignedSweep(): Promise<void> {
    if (!this.assignmentEngine || !this.assignmentEngine.isWorkingTime()) return;

    try {
      const projects = this.assignmentEngine.getConfiguredProjects();
      const projectPlaceholders = projects.map(() => '?').join(', ');

      const unassigned = await query<{
        issue_key: string; summary: string; status_name: string;
        request_type: string | null; current_tier: string | null;
      }>(
        `SELECT TOP (20) c.issue_key, c.summary, c.status_name, c.request_type, c.current_tier
         FROM jira_issue_cache c
         WHERE c.assignee_account_id IS NULL
           AND c.status_category != 'done'
           AND (c.current_tier IS NULL OR c.current_tier != 'Development')
           AND c.created_at < DATEADD(minute, -5, GETUTCDATE())
           AND c.created_at >= DATEADD(hour, -48, GETUTCDATE())
           AND c.project_key IN (${projectPlaceholders})
         ORDER BY c.created_at ASC`,
        projects,
      );

      if (unassigned.length === 0) return;
      console.log(`[agent] Unassigned sweep (48h catch-up): ${unassigned.length} tickets found`);

      for (const ticket of unassigned) {
        const project = this.assignmentEngine.resolveProjectFromTicketKey(ticket.issue_key);
        const pool = this.determinePoolFromTicket(ticket, project);

        const assignment = await this.assignmentEngine.assignWithFallback(
          ticket.issue_key, pool, project,
        );
        if (assignment) {
          await this.assignmentEngine.postAssignmentComment(ticket.issue_key, assignment);
          console.log(`[agent] Sweep: assigned ${ticket.issue_key} → ${assignment.agent.display_name}`);
        }
      }
    } catch (err) {
      console.warn('[agent] Unassigned sweep failed:', err instanceof Error ? err.message : err);
    }
  }

  private determinePoolFromTicket(ticket: { issue_key: string; current_tier?: string | null }, project: string): Pool {
    if (project === 'NTPJ') return 'tpj';
    if (ticket.current_tier === 'T2' || ticket.current_tier === 'T3') return 't2';
    return 'cc';
  }

  // ── D1: Pattern extraction from resolved tickets ──
  private async runPatternExtraction(): Promise<void> {
    try {
      const resolved = await query<{
        issue_key: string; summary: string; description_text: string; category: string;
      }>(
        `SELECT TOP 10 c.issue_key, c.summary, c.description_text, tc.category
         FROM jira_issue_cache c
         INNER JOIN ticket_classifications tc ON tc.ticket_key = c.issue_key
         LEFT JOIN agent_patterns p ON p.source_tickets LIKE '%' + c.issue_key + '%'
         WHERE c.status_category = 'done'
           AND c.jira_updated > DATEADD(day, -1, GETUTCDATE())
           AND p.id IS NULL
           AND tc.category IS NOT NULL
         ORDER BY c.jira_updated DESC`,
      );

      if (resolved.length === 0) return;
      console.log(`[agent] Pattern extraction: ${resolved.length} resolved tickets to process`);

      for (const ticket of resolved) {
        try {
          const comments = await query<{ body: string; author_display_name: string }>(
            `SELECT TOP 5 body, author_display_name FROM jira_comment_cache
             WHERE issue_key = ? ORDER BY jira_created DESC`,
            [ticket.issue_key],
          );

          const resolutionComments = comments.map(c => `${c.author_display_name}: ${c.body?.slice(0, 300)}`).join('\n');
          const symptom = ticket.summary;
          const resolution = resolutionComments.slice(0, 1000) || ticket.description_text?.slice(0, 500) || 'No resolution details';

          const hash = createHash('sha256').update(symptom.toLowerCase()).digest('hex').substring(0, 16);

          // Upsert pattern
          const existing = await query<{ id: number; observed_count: number; source_tickets: string }>(
            `SELECT id, observed_count, source_tickets FROM agent_patterns WHERE category = ? AND symptom_hash = ?`,
            [ticket.category, hash],
          );

          if (existing.length > 0) {
            const sources = JSON.parse(existing[0].source_tickets || '[]') as string[];
            if (!sources.includes(ticket.issue_key)) {
              sources.push(ticket.issue_key);
              await executeAndGetId(
                `UPDATE agent_patterns SET observed_count = observed_count + 1, last_observed = GETUTCDATE(), source_tickets = ?, resolution = ? WHERE id = ?`,
                [JSON.stringify(sources), resolution, existing[0].id],
              );
            }
          } else {
            await executeAndGetId(
              `INSERT INTO agent_patterns (category, symptom_hash, symptom, resolution, source_tickets) VALUES (?, ?, ?, ?, ?)`,
              [ticket.category, hash, symptom, resolution, JSON.stringify([ticket.issue_key])],
            );
          }
        } catch (err) {
          console.warn(`[agent] Pattern extraction failed for ${ticket.issue_key}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('[agent] Pattern extraction sweep failed:', err instanceof Error ? err.message : err);
    }
  }

  // ── E2: Customer memory compaction ──
  private async runMemoryCompaction(): Promise<void> {
    const maxSizeBytes = this.getNumber('agent_memory_max_size_bytes', 4000);

    try {
      // Evict stale entries (>180 days without update)
      const stale = await query<{ id: number; account_id: string; patterns: string; created_at: string; last_updated: string }>(
        `SELECT id, account_id, patterns, created_at, last_updated FROM agent_customer_memory
         WHERE DATEDIFF(day, last_updated, GETUTCDATE()) > 180`,
      );

      for (const entry of stale) {
        await executeAndGetId(
          `INSERT INTO agent_customer_memory_archive (account_id, patterns, original_created_at, original_last_updated) VALUES (?, ?, ?, ?)`,
          [entry.account_id, entry.patterns, entry.created_at, entry.last_updated],
        );
        await executeAndGetId(`DELETE FROM agent_customer_memory WHERE id = ?`, [entry.id]);
      }
      if (stale.length > 0) console.log(`[agent] Memory compaction: archived ${stale.length} stale entries`);

      // Compact oversized entries
      const large = await query<{ id: number; account_id: string; patterns: string }>(
        `SELECT id, account_id, patterns FROM agent_customer_memory WHERE LEN(patterns) > ?`,
        [maxSizeBytes],
      );

      if (large.length > 0) {
        console.log(`[agent] Memory compaction: ${large.length} oversized entries to compact`);
        for (const entry of large) {
          try {
            const patterns = JSON.parse(entry.patterns);
            // Simple compaction: keep most recent entries, trim old ones
            if (Array.isArray(patterns)) {
              const compacted = patterns.slice(-10);
              await executeAndGetId(
                `UPDATE agent_customer_memory SET patterns = ?, last_updated = GETUTCDATE() WHERE id = ?`,
                [JSON.stringify(compacted), entry.id],
              );
            } else if (typeof patterns === 'object') {
              const keys = Object.keys(patterns);
              if (keys.length > 20) {
                const trimmed: Record<string, unknown> = {};
                for (const k of keys.slice(-20)) trimmed[k] = patterns[k];
                await executeAndGetId(
                  `UPDATE agent_customer_memory SET patterns = ?, last_updated = GETUTCDATE() WHERE id = ?`,
                  [JSON.stringify(trimmed), entry.id],
                );
              }
            }
          } catch { /* skip unparseable entries */ }
        }
      }
    } catch (err) {
      console.warn('[agent] Memory compaction failed:', err instanceof Error ? err.message : err);
    }
  }

  private async runBackfillTriage(): Promise<void> {
    const enabled = this.settings.get('agent_backfill_enabled');
    if (enabled === 'false' || enabled === '0') {
      console.log(`[backfill] Skipped — agent_backfill_enabled=${enabled}`);
      return;
    }

    try {
      const result = await this.runBackfillSweep();
      if (result.processed > 0 || result.errors > 0) {
        console.log(`[backfill] Triaged ${result.processed}, errors ${result.errors}`);
      }
    } catch (err) {
      console.warn(`[backfill] Sweep failed:`, err instanceof Error ? err.message : err);
    }
  }

  private async executeDecision(decision: AgentDecision): Promise<void> {
    const decisionId = await this.observer.logDecision(decision);
    const ticketState = this.lifecycleManager.getTicketState();

    // Idempotency: skip if ticket already triaged (prevents duplicate notes)
    if (decision.eventType === 'ticket_created') {
      const existingState = await ticketState.get(decision.ticketKey);
      if (existingState && existingState.lifecycle !== 'new') {
        console.log(`[agent] Skipping duplicate triage for ${decision.ticketKey} — already ${existingState.lifecycle}`);
        return;
      }
    }

    // Track ticket state BEFORE posting notes — if this fails, do NOT post
    try {
      await ticketState.updateAfterDecision(
        decision.ticketKey, decisionId, decision.eventType,
      );
    } catch (err) {
      console.error(`[agent] Failed to update ticket state for ${decision.ticketKey} — skipping note to prevent duplicates:`, err instanceof Error ? err.message : err);
      return;
    }

    // Lifecycle: transition to 'triaged' on new ticket triage
    if (decision.eventType === 'ticket_created' && decision.action !== 'no_action') {
      // Auto-assign via Round Robin if ticket is unassigned
      if (!decision.inputs.assignee && this.assignmentEngine && !decision.shadowMode) {
        await this.tryAutoAssign(decision);
      }

      try {
        const assignee = decision.inputs.assignee as string | null;
        const assigneeName = (decision.inputs.assigneeName as string) ?? (decision.inputs.assignee as string | null);
        await ticketState.transition(decision.ticketKey, 'triaged', {
          lastTriageDecisionId: decisionId,
          assignee: assignee ?? null,
          assigneeName: assigneeName ?? null,
        });
      } catch (err) {
        console.warn(`[agent] Failed lifecycle transition for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    // Assigned ticket mode check
    const mode = this.lifecycleManager.getAssignedTicketMode();
    const isAssigned = !!(decision.inputs.assignee);
    if (isAssigned && mode === 'hands_off') {
      await this.observer.logOutcome(decisionId, {
        success: true, action: decision.action, ticketKey: decision.ticketKey,
        detail: `[HANDS_OFF] Ticket assigned — agent stopped tracking. No note posted.`,
      });
      this.ticketsProcessed++;
      return;
    }

    // Post internal note (safe in all modes — except hands_off handled above)
    const internalNote = decision.output.internal_note as string | undefined;
    const shouldPostNote = internalNote && !(isAssigned && mode === 'hands_off');
    if (shouldPostNote) {
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

    // Observer mode: post notes only, no external actions on assigned tickets
    if (isAssigned && mode === 'observer') {
      await this.observer.logOutcome(decisionId, {
        success: true, action: decision.action, ticketKey: decision.ticketKey,
        detail: `[OBSERVER] Ticket assigned — posted internal note only, no external action taken.`,
      });
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

    // Quick-win auto-close (only reached in non-shadow mode)
    const qw = decision.output.quick_win as { type?: string; confidence?: number } | undefined;
    if (qw?.type && qw.type !== 'none') {
      const shouldClose = await this.quickWinExecutor.shouldAutoClose(decision, decisionId);
      if (shouldClose) {
        const qwResult = await this.quickWinExecutor.executeAutoClose(decision, decisionId);
        await this.observer.logOutcome(decisionId, qwResult);
        if (!qwResult.success) {
          console.warn(`[agent] Quick-win auto-close failed for ${decision.ticketKey}: ${qwResult.error}`);
        }
        this.ticketsProcessed++;
        return;
      }
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
        source: 'nova_ai',
      });

      await this.observer.logOutcome(decisionId, {
        success: true,
        action: 'draft_response',
        ticketKey: decision.ticketKey,
        detail: `Submitted to approval queue (approval #${approvalId}). Confidence: ${decision.confidence.toFixed(2)}`,
      });

      // Post internal note on Jira to prevent manual resolution while awaiting approval
      try {
        await this.jiraClient.addComment(
          decision.ticketKey,
          '⏳ NOVA AI has processed this ticket and is awaiting human approval.\n\nPlease do not resolve or action this ticket manually — log into NOVA to review and approve/decline the AI recommendation.',
          { internal: true },
        );
      } catch (noteErr) {
        console.warn(`[agent] Failed to post approval hold note on ${decision.ticketKey}:`, noteErr instanceof Error ? noteErr.message : noteErr);
      }

      // Lifecycle: move to awaiting_approval
      try {
        await this.lifecycleManager.getTicketState().transition(decision.ticketKey, 'awaiting_approval', {
          approvalId: approvalId,
          approvalSubmittedAt: new Date().toISOString(),
        });
      } catch { /* best effort */ }

      console.log(`[agent] Submitted ${decision.ticketKey} to approval queue (id: ${approvalId})`);

      // In-app notification for approvers
      try {
        const approverRoles = ['admin', 'super_admin', 'ai-approver'];
        const approvers = await query<{ id: number }>(
          `SELECT id FROM users WHERE ${approverRoles.map(() => `role LIKE '%' + ? + '%'`).join(' OR ')}`,
          approverRoles,
        );
        for (const u of approvers) {
          await executeAndGetId(
            `INSERT INTO nova_notifications (user_id, type, title, body, ticket_key, reference_id) VALUES (?, 'approval_pending', ?, ?, ?, ?)`,
            [u.id, `Approval needed: ${decision.ticketKey}`, `NOVA recommends: ${decision.action}`, decision.ticketKey, String(approvalId)],
          );
        }
      } catch (notifErr) {
        console.warn('[agent] Failed to create approval notifications:', notifErr instanceof Error ? notifErr.message : notifErr);
      }
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
    const classification = decision.output.classification as { ticket_type?: string; category?: string; sub_category?: string; confidence?: number; impact?: string; urgency?: string; priority_matrix?: string } | undefined;
    const intent = decision.inputs.intent as { type?: string; confidence?: number } | undefined;
    const priorityAssessment = decision.output.priority_assessment as { suggested_priority?: number; reasoning?: string } | undefined;
    const internalNote = (decision.output.internal_note as string) ?? '';
    const sentiment = (decision.inputs.sentiment as string) ?? null;
    const slaRisk = (decision.inputs.sla_risk as string) ?? null;
    const assigneeName = (decision.inputs.assignee as string) ?? null;
    const draftResponse = (decision.output.draft_response as string) ?? null;

    const triggerLabel = decision.eventType === 'ticket_created' ? 'New Ticket Triage'
      : decision.eventType === 'comment_added' ? 'New Customer Reply'
      : decision.eventType === 'stale' ? 'Stale Ticket Review'
      : 'Ticket Review';

    const shadowTag = decision.shadowMode ? ' [SHADOW MODE — observe only]' : '';

    const actionLabels: Record<string, string> = {
      respond: 'send a reply to the customer',
      draft_response: 'draft a reply for agent review',
      gather_context: 'ask the customer for more information before proceeding',
      escalate: 'escalate to a senior agent or specialist',
      assign: 'assign to an available agent',
      close: 'close the ticket',
      no_action: 'no action needed at this time',
      chase: 'chase the customer for a response',
      transition: 'move ticket to a new status',
    };

    const rawAction = (decision.output.recommended_action as string) ?? decision.action;
    const actionDesc = actionLabels[rawAction] ?? rawAction;
    const forWhom = assigneeName
      ? `**For ${assigneeName}:** ${actionDesc}`
      : `**For next available agent:** ${actionDesc}`;

    const statusDesc = decision.shadowMode
      ? `This is shadow mode — the AI is observing only. No action has been taken.`
      : decision.approvalRequired
        ? `A draft reply has been submitted to the NOVA approval queue for agent review before sending.`
        : `This action was executed automatically based on autonomy rules.`;

    const lines = [
      `\u{1F916} AI ${triggerLabel}${shadowTag}`,
      ``,
      internalNote,
      ``,
      forWhom,
      `**Confidence:** ${(decision.confidence * 100).toFixed(0)}%`,
    ];

    if (sentiment) lines.push(`**Sentiment:** ${sentiment}`);

    if (classification?.ticket_type) {
      const typeLabel = classification.ticket_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const catLabel = classification.category && classification.sub_category
        ? `${classification.category} > ${classification.sub_category}`
        : classification.category ?? '';
      lines.push(`**Type:** ${typeLabel}`);
      if (catLabel) lines.push(`**Category:** ${catLabel}`);
      if (classification.impact && classification.urgency && classification.priority_matrix) {
        lines.push(`**Impact:** ${classification.impact} | **Urgency:** ${classification.urgency} | **Priority:** ${classification.priority_matrix}`);
      }
    } else if (classification?.category && classification.category !== 'unknown') {
      const sub = classification.sub_category && classification.sub_category !== 'unknown'
        ? ` > ${classification.sub_category}` : '';
      lines.push(`**Category:** ${classification.category}${sub}`);
    }
    if (intent?.type) {
      lines.push(`**Customer Intent:** ${intent.type.replace(/_/g, ' ')}`);
    }

    if (slaRisk && slaRisk !== 'unknown') lines.push(`**SLA Risk:** ${slaRisk}`);

    if (priorityAssessment?.suggested_priority) {
      lines.push(`**Suggested Priority:** ${priorityAssessment.suggested_priority} — ${priorityAssessment.reasoning ?? ''}`);
    }

    // Ticket context block
    const priority = (decision.inputs.priority as string) ?? null;
    const requestType = (decision.inputs.requestType as string) ?? null;
    const created = (decision.inputs.created as string) ?? null;
    const contextParts: string[] = [];
    if (priority) contextParts.push(`Priority: ${priority}`);
    if (requestType) contextParts.push(`Request Type: ${requestType}`);
    if (assigneeName) contextParts.push(`Assignee: ${assigneeName}`);
    if (created) {
      const ageDays = Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000);
      contextParts.push(`Age: ${ageDays}d`);
    }
    if (slaRisk && slaRisk !== 'unknown' && slaRisk !== 'none') {
      const slaBreachTime = (decision.inputs as any).slaBreachTime as string | null;
      if (slaBreachTime) {
        const breachMs = new Date(slaBreachTime).getTime() - Date.now();
        const breachLabel = breachMs < 0
          ? `BREACHED (${Math.abs(Math.floor(breachMs / 60_000))}m ago)`
          : breachMs < 3_600_000
          ? `At risk (${Math.floor(breachMs / 60_000)}m remaining)`
          : `OK (${Math.floor(breachMs / 3_600_000)}h remaining)`;
        contextParts.push(`SLA: ${breachLabel}`);
      } else {
        contextParts.push(`SLA: ${slaRisk}`);
      }
    }
    if (contextParts.length > 0) {
      lines.push(``, `--- Ticket Context ---`, contextParts.join(' | '));
    }

    // Draft response (shown in shadow mode so agents can copy/paste)
    if (draftResponse) {
      lines.push(``, `**Suggested response:**`, draftResponse);
    }

    lines.push(``, statusDesc);
    lines.push(``, `_${decision.provider ?? 'unknown'}/${decision.model ?? 'unknown'}_`);

    return lines.join('\n');
  }

  async handleApprovalCallback(
    action: string,
    ticketKey: string,
    approvalId?: number,
    editedResponse?: string,
    decidedBy?: string,
  ): Promise<void> {
    console.log(`[agent] Approval callback: ${action} for ${ticketKey} (approval #${approvalId ?? 'unknown'})`);

    // Check if this is a hybrid action approval (abuse_report)
    if (approvalId && this.approvalQueries) {
      const approval = await this.approvalQueries.getById(approvalId);
      if (approval?.action_type === 'abuse_report' && this.abuseExecutor) {
        await this.abuseExecutor.executePhaseB(approvalId, action, decidedBy ?? 'unknown');
        return;
      }
    }

    // Find the agent decision ID from the most recent decision for this ticket
    const decisions = await this.observer.getDecisionsByTicket(ticketKey, 1) as Array<{ id: number }>;
    const decisionId = decisions[0]?.id;

    if (action === 'approve' || action === 'approved') {
      if (this.isShadowMode()) {
        console.log(`[agent] Enhanced hybrid: executing ${ticketKey} despite shadow mode — human override by ${decidedBy}`);
      }
      const responseText = editedResponse || '';
      if (responseText) {
        if (looksLikeStructuredPayload(responseText)) {
          console.error(`[agent] BLOCKED public comment on ${ticketKey}: response looks like structured/JSON data`);
          if (decisionId) {
            await this.observer.logOutcome(decisionId, {
              success: false, action: 'draft_response', ticketKey,
              detail: 'Blocked: response contained structured/JSON data — refusing to post publicly.',
              error: 'STRUCTURED_PAYLOAD_BLOCKED',
            });
          }
          return;
        }
        try {
          await this.jiraClient.addComment(ticketKey, responseText, { internal: false });
          console.log(`[agent] Posted approved response on ${ticketKey}`);

          // Lifecycle: move to response_sent → awaiting_customer
          try {
            await this.lifecycleManager.getTicketState().transition(ticketKey, 'response_sent', {
              approvalId: null,
              approvalSubmittedAt: null,
              lastAgentActionAt: new Date().toISOString(),
            });
            await this.lifecycleManager.getTicketState().transition(ticketKey, 'awaiting_customer');
          } catch { /* best effort */ }

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

  async runBackfillSweep(): Promise<{ processed: number; skipped: number; errors: number }> {
    const batchSize = this.getNumber('agent_backfill_batch_size', 10);
    const agentProject = this.settings.get('agent_jira_project') || 'NT';
    const projects = agentProject.split(',').map(p => p.trim());
    const projectPlaceholders = projects.map(() => '?').join(',');

    const untriaged = await query<{
      issue_key: string; jira_id: string; summary: string; description_text: string;
      status_name: string; priority_name: string; request_type: string;
      assignee_display: string; reporter_display: string; reporter_email: string;
      jira_created: string; jira_updated: string; sla_breach_time: string;
      fields_json: string;
    }>(
      `SELECT TOP (${batchSize}) c.issue_key, c.jira_id, c.summary, c.description_text,
              c.status_name, c.priority_name, c.request_type,
              c.assignee_display, c.reporter_display, c.reporter_email,
              c.jira_created, c.jira_updated, c.sla_breach_time, c.fields_json
       FROM jira_issue_cache c
       LEFT JOIN agent_decisions d ON d.ticket_id = c.issue_key
       WHERE c.project_key IN (${projectPlaceholders})
         AND c.status_category != 'done'
         AND (c.current_tier IS NULL OR c.current_tier != 'Development')
         AND d.id IS NULL
       ORDER BY c.jira_created DESC`,
      projects,
    );

    if (untriaged.length === 0) {
      console.log(`[backfill] No untriaged tickets found — backfill complete`);
      return { processed: 0, skipped: 0, errors: 0 };
    }

    console.log(`[backfill] Found ${untriaged.length} untriaged tickets (batch ${batchSize}, projects: ${projects.join(',')})`);

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of untriaged) {
      const event = {
        ticketId: row.jira_id,
        ticketKey: row.issue_key,
        eventType: 'backfill' as const,
        summary: row.summary ?? '',
        description: row.description_text ?? '',
        status: row.status_name ?? 'Unknown',
        priority: row.priority_name ?? 'Medium',
        requestType: row.request_type ?? '',
        assignee: row.assignee_display ?? null,
        reporter: row.reporter_display ?? null,
        reporterEmail: row.reporter_email ?? null,
        organisation: row.reporter_email?.split('@')[1] ?? null,
        created: row.jira_created ?? '',
        updated: row.jira_updated ?? '',
        slaBreachTime: row.sla_breach_time ?? null,
        fields: row.fields_json ? JSON.parse(row.fields_json) : {},
      };

      try {
        const decision = await this.reasoner.triageBackfill(event);
        decision.shadowMode = true;
        decision.eventType = 'backfill';

        const decisionId = await this.observer.logDecision(decision);
        await this.observer.logOutcome(decisionId, {
          success: true,
          action: decision.action,
          ticketKey: decision.ticketKey,
          detail: `[BACKFILL] Shadow triage complete. Confidence: ${decision.confidence.toFixed(2)}`,
        });
        processed++;
      } catch (err) {
        console.error(`[backfill] Triage failed for ${row.issue_key}:`, err instanceof Error ? err.message : err);
        errors++;
      }
    }

    console.log(`[backfill] Sweep done: ${processed} processed, ${errors} errors`);
    return { processed, skipped, errors };
  }
}
