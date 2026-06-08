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
import { StaleLifecycleService } from './stale-lifecycle.js';

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
import { query, queryOne, execute, executeAndGetId } from './database.js';
import { EscalationLogService } from './escalation-log-service.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import { prepareTicketForClose, setRequestType } from './close-ticket-helper.js';
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
  private staleLifecycle: StaleLifecycleService;

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
    this.reasoner.setSettings(settings);
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
    this.staleLifecycle = new StaleLifecycleService(settings, jiraClient, this.observer, llmService);

    this.guardrails = new Guardrails(settings);
    this.queueMonitor = new QueueMonitor(jiraClient, settings);
    const agentProject = settings.get('agent_jira_project') || 'NT';
    const primaryProject = agentProject.split(',')[0].trim();
    this.ticketClassifier = new TicketClassifier(llmService, jiraClient, primaryProject);
    this.coachingEngine = new CoachingEngine(llmService, jiraClient, primaryProject, settings);
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
    this.actor.setAssignmentEngine(engine);
    this.lifecycleManager.setAssignmentEngine(engine);
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

      // 1.1 NTPJ FAST PATH — assign immediately from authoritative ticket state, skip auto-rules/triage/reasoner entirely
      const ntpjHandledKeys = new Set<string>();
      if (this.assignmentEngine) {
        for (const event of deduped) {
          if (!event.ticketKey.startsWith('NTPJ-')) continue;
          try {
            const ticket = await this.getTicketRoutingState(event.ticketKey);
            const pool = this.determinePoolFromTicket({ issue_key: event.ticketKey, ...ticket }, 'NTPJ') ?? 'cc';
            const assignment = await this.assignmentEngine.assignWithFallback(event.ticketKey, pool, 'NTPJ');
            if (assignment) {
              await this.assignmentEngine.postAssignmentComment(event.ticketKey, assignment);
              console.log(`[agent] NTPJ fast-path: ${event.ticketKey} → ${assignment.agent.display_name} (${pool.toUpperCase()})`);
            } else {
              console.log(`[agent] NTPJ fast-path: ${event.ticketKey} — no agents available, will retry on sweep`);
            }
            const ticketState = this.lifecycleManager.getTicketState();
            try { await ticketState.transition(event.ticketKey, 'handed_off'); } catch { /* best effort */ }
          } catch (err) {
            console.error(`[agent] NTPJ fast-path failed for ${event.ticketKey}:`, err instanceof Error ? err.message : err);
          }
          ntpjHandledKeys.add(event.ticketKey);
          this.recentlyProcessedTickets.set(`${event.ticketKey}:${event.eventType}`, Date.now());
          this.ticketsProcessed++;
        }
      }
      const nonNtpjEvents = deduped.filter(e => !ntpjHandledKeys.has(e.ticketKey));

      // 1.2 YO (YOMDEL) FAST PATH — auto-close live leads, skip everything else
      const yoHandledKeys = new Set<string>();
      for (const event of nonNtpjEvents) {
        if (!event.ticketKey.startsWith('YO-')) continue;
        try {
          await this.handleYomdel(event.ticketKey, event.summary, event.status);
        } catch (err) {
          console.error(`[agent] YO fast-path failed for ${event.ticketKey}:`, err instanceof Error ? err.message : err);
        }
        yoHandledKeys.add(event.ticketKey);
        this.recentlyProcessedTickets.set(`${event.ticketKey}:${event.eventType}`, Date.now());
        this.ticketsProcessed++;
      }
      const nonYoEvents = nonNtpjEvents.filter(e => !yoHandledKeys.has(e.ticketKey));

      // 1.5 AUTO-RULES EVALUATION (config-driven, deterministic — replaces hybrid detector)
      // All deterministic actions (plugin_to_tpj, abuse_report, auto-close, tier routing)
      // are now handled by the unified auto-rules engine. They execute in hybrid + live mode
      // and are shadowed only in full_shadow mode. No weekend exemption check needed —
      // deterministic rules are safe by definition.
      const autoRuleHandledKeys = new Set<string>();
      const shadowModeForRules = this.getShadowMode();
      for (const event of nonYoEvents) {
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

      const llmEvents = nonYoEvents.filter(e => !autoRuleHandledKeys.has(e.ticketKey));

      // DB-level dedup: skip ticket_created/backfill if already triaged in last 30 min
      const dedupedLlmEvents: typeof llmEvents = [];
      for (const event of llmEvents) {
        if (event.eventType === 'ticket_created' || event.eventType === 'backfill') {
          const recentTriage = await query<{ cnt: number }>(
            `SELECT COUNT(*) AS cnt FROM agent_decisions
             WHERE ticket_id = ? AND action != 'no_action' AND shadow_mode = 0
               AND created_at >= DATEADD(MINUTE, -30, GETUTCDATE())`,
            [event.ticketKey],
          );
          if (recentTriage[0]?.cnt > 0) {
            console.log(`[agent] Skipping duplicate triage for ${event.ticketKey} (${event.eventType}) — already triaged in last 30 min`);
            continue;
          }
        }
        dedupedLlmEvents.push(event);
      }

      // 1.9 NOVA SELF-ASSIGN — claim tickets before triage so they're never in limbo
      if (dedupedLlmEvents.length > 0) {
        const novaAccountId = this.settings.get('nova_ai_jira_account_id');
        if (novaAccountId) {
          for (const event of dedupedLlmEvents) {
            if (event.eventType === 'ticket_created' || event.eventType === 'backfill') {
              if (!event.assignee) {
                try {
                  await this.jiraClient.updateFields(event.ticketKey, { assignee: { accountId: novaAccountId } });
                  console.log(`[agent] Self-assigned ${event.ticketKey} to NOVA for processing`);
                } catch (err) {
                  console.warn(`[agent] Failed to self-assign ${event.ticketKey}:`, err instanceof Error ? err.message : err);
                }
              }
            }
          }
        }
      }

      // 1.95 ATTACHMENT CONTENT — download image attachments for multimodal AI processing
      if (this.settings.get('agent_attachment_processing_enabled') !== 'false') {
        await this.downloadAttachmentContent(dedupedLlmEvents);
      }

      // 2. REASON
      const shadowMode = this.getShadowMode();
      const decisions = await this.reasoner.decideMultiple(dedupedLlmEvents);
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

        // Re-check historic open tickets against time_gate auto-rules (all modes —
        // deterministic, shadowed in full_shadow). The normal backfill skips
        // already-triaged tickets, so this is what lets the ">Nh old" branch fire.
        await this.runTimeGateStaleSweep();

        // These only run during working hours
        if (this.currentMode === 'full') {
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
        // Unified stale-ticket lifecycle (chase up to N, then auto-close). Working-hours only
        // so we never email customers overnight. Supersedes the old runChaseSweep + the
        // lifecycle-manager stale→close branches. See stale-lifecycle.ts.
        await this.staleLifecycle.sweep(shadowMode);
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

  private async downloadAttachmentContent(events: import('./agent-types.js').TicketEvent[]): Promise<void> {
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'];

    for (const event of events) {
      if (!event.attachments || event.attachments.length === 0) continue;

      for (const attachment of event.attachments) {
        if (!attachment.id) continue;
        if (attachment.size > MAX_SIZE) continue;
        if (!IMAGE_TYPES.some(t => attachment.mimeType.startsWith(t))) continue;

        try {
          const response = await this.jiraClient.getAttachmentContent(attachment.id);
          if (!response.ok) {
            console.warn(`[agent] Attachment download failed for ${attachment.filename} on ${event.ticketKey}: ${response.status}`);
            continue;
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          attachment.base64Content = buffer.toString('base64');
          console.log(`[agent] Downloaded attachment ${attachment.filename} (${(attachment.size / 1024).toFixed(0)}KB) for ${event.ticketKey}`);
        } catch (err) {
          console.warn(`[agent] Failed to download attachment ${attachment.filename}:`, err instanceof Error ? err.message : err);
        }
      }
    }
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
        + result.chaseSent + result.autoCloseCandidates + result.autoClosed + result.aiConversationTimeouts;
      console.log(`[agent] Lifecycle sweep complete — ${total} actions (timeouts: ${result.approvalTimeouts}, replies: ${result.customerReplies}, stale: ${result.staleTransitions}, chased: ${result.chaseSent}, closed: ${result.autoClosed}, ai_conv_timeout: ${result.aiConversationTimeouts})`);
    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Lifecycle sweep failed:`, err instanceof Error ? err.message : err);
    }
  }


  private async runTicketClassification(): Promise<void> {
    try {
      console.log(`[agent] Running ticket classification...`);
      const results = await this.ticketClassifier.classifyResolved(24);
      if (results.length > 0) {
        console.log(`[agent] Classification complete — ${results.length} tickets classified`);
      } else {
        console.log(`[agent] Classification complete — 0 tickets classified (all resolved tickets already classified or none found)`);
      }
    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Ticket classification failed:`, err instanceof Error ? err.stack : err);
      try {
        await this.alertService.createAlert({
          alertType: 'error',
          severity: 'warning',
          title: 'Classification pipeline error',
          detail: `Ticket classification failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } catch { /* best effort */ }
    }
  }

  private async runCoachingHealthChecks(): Promise<void> {
    try {
      const openIssues = this.perceiver.getLastOpenIssues();
      console.log(`[agent] Coaching health checks starting — ${openIssues.length} open issues available`);
      if (openIssues.length === 0) return;

      let checked = 0;
      let nudgeCount = 0;
      let skippedNoAssignee = 0;
      let errors = 0;
      for (const issue of openIssues.slice(0, 20)) {
        const assignee = (issue.fields as any)?.assignee?.accountId;
        if (!assignee) { skippedNoAssignee++; continue; }

        try {
          const nudges = await this.coachingEngine.checkTicketHealth(issue.key, assignee);
          if (nudges.length > 0) {
            console.log(`[agent] Coaching health check: ${issue.key} — ${nudges.join(', ')}`);
            nudgeCount += nudges.length;
            for (const nudge of nudges) {
              try {
                await executeAndGetId(
                  `INSERT INTO agent_coaching (ticket_id, agent_user_id, nudge_type, message, delivered, delivery_method)
                   VALUES (?, ?, ?, ?, 0, 'health_check')`,
                  [issue.key, 0, nudge, `Health check nudge: ${nudge}`],
                );
              } catch { /* best effort — avoid duplicates breaking the loop */ }
            }
          }
          checked++;
        } catch (err) {
          errors++;
          console.warn(`[agent] Coaching health check failed for ${issue.key}:`, err instanceof Error ? err.message : err);
        }
      }
      console.log(`[agent] Coaching health checks complete — ${checked} checked, ${nudgeCount} nudges, ${skippedNoAssignee} skipped (no assignee), ${errors} errors`);
      if (errors > 0) this.errorCount++;
    } catch (err) {
      this.errorCount++;
      console.error(`[agent] Coaching health checks failed:`, err instanceof Error ? err.stack : err);
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

  // ── C1: Chase sweep — RETIRED. Superseded by StaleLifecycleService (stale-lifecycle.ts),
  // invoked in the extended-sweeps block. The old version queried 'Waiting on Customer' /
  // 'Waiting for Customer' (statuses that don't exist in NT — the real one is 'Waiting On
  // Requestor', id 11768) and never auto-closed. See agent_work/ba/stale-ticket-autoclose-spec.md.

  // True when the decision is a high-confidence customer resolution-confirmation that the
  // model already recommended closing. Used to let such tickets auto-close even when a human
  // is the assignee (observer mode). Narrow by design — gated on the existing thank-you
  // auto-close toggle and the quick-win min-confidence threshold.
  private isResolutionConfirmationClose(decision: import('./agent-types.js').AgentDecision): boolean {
    if (this.settings.get('agent_quick_win_auto_close_thank_you') !== 'true') return false;

    const recommended = (decision.output.recommended_action as string) || '';
    const closes = recommended === 'close' || recommended === 'resolve' || decision.action === 'transition';
    if (!closes) return false;

    const intent = decision.output.intent as { type?: string; confidence?: number } | undefined;
    if (intent?.type !== 'confirming_resolution' && intent?.type !== 'thank_you') return false;

    const minConf = parseFloat(this.settings.get('agent_quick_win_min_confidence') || '0.90');
    const conf = intent?.confidence ?? decision.confidence ?? 0;
    return conf >= minConf;
  }

  // ── C2: Auto-assign after triage ──
  private async tryAutoAssign(decision: import('./agent-types.js').AgentDecision): Promise<void> {
    if (!this.assignmentEngine) return;

    // Guard: skip if already assigned to a human agent
    const novaAccountId = this.settings.get('nova_ai_jira_account_id') ?? '';
    const current = await queryOne<{ assignee_account_id: string | null }>(
      `SELECT assignee_account_id FROM jira_issue_cache WHERE issue_key = ?`,
      [decision.ticketKey],
    );
    if (current?.assignee_account_id && current.assignee_account_id !== novaAccountId) {
      console.log(`[agent] Skipping assignment for ${decision.ticketKey} — already assigned to ${current.assignee_account_id}`);
      return;
    }

    // Check exclusion filters before assigning (n8n parity)
    const ticket = await queryOne<{
      request_type: string | null; labels: string | null; current_tier: string | null;
    }>(
      `SELECT request_type, labels, current_tier FROM jira_issue_cache WHERE issue_key = ?`,
      [decision.ticketKey],
    );
    if (ticket) {
      const excludedTypes = ['Escalation'];
      if (ticket.request_type && excludedTypes.includes(ticket.request_type)) return;
      if (ticket.labels && ticket.labels.includes('TPJ_Feed')) return;
    }

    // Unknown tier no longer defers: new tickets always route to CC, so a missing
    // current_tier just means "default CC" rather than "wait for the sweep". Deferring
    // here was orphaning fresh tickets on NOVA when the tier hadn't synced yet.
    const project = this.assignmentEngine.resolveProjectFromTicketKey(decision.ticketKey);
    const pool = this.determinePool(decision, project, ticket);
    if (!pool) {
      console.log(`[agent] Skipping assignment for ${decision.ticketKey} — Development tier`);
      return;
    }

    try {
      const assignment = await this.assignmentEngine.assignWithFallback(
        decision.ticketKey, pool, project,
      );

      if (assignment) {
        console.log(`[agent] Assigned ${decision.ticketKey} → ${assignment.agent.display_name} (${pool}, ${project})`);
        decision.inputs.assignee = assignment.agent.jira_account_id;
        decision.inputs.assigneeName = assignment.agent.display_name;
        await this.assignmentEngine.postAssignmentComment(decision.ticketKey, assignment);

        // Update request type from "AI Request" to classified type on handoff
        try {
          await this.updateRequestTypeAfterAssign(decision);
        } catch (rtErr) {
          console.warn(`[agent] Request type update failed for ${decision.ticketKey}:`, rtErr instanceof Error ? rtErr.message : rtErr);
        }
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

  private async updateRequestTypeAfterAssign(decision: import('./agent-types.js').AgentDecision): Promise<void> {
    const classification = decision.output?.classification as { category?: string; ticket_type?: string } | undefined;
    await setRequestType(this.jiraClient, this.settings, decision.ticketKey, classification);
  }

  private async updateRequestTypeFromDecision(ticketKey: string): Promise<void> {
    const decRow = await query<{ output: string }>(
      `SELECT TOP 1 output FROM agent_decisions WHERE ticket_id = ? ORDER BY created_at DESC`,
      [ticketKey],
    ).then(rows => rows[0] ?? null);
    if (!decRow) return;
    try {
      const out = JSON.parse(decRow.output || '{}');
      const classification = out.classification as { category?: string; ticket_type?: string } | undefined;
      await setRequestType(this.jiraClient, this.settings, ticketKey, classification);
    } catch { /* classification not available */ }
  }

  // Yomdel live lead pattern — matches en-dash (–) and hyphen-minus
  private readonly YOMDEL_LEAD_RE = /^(?:RESEND\s*\/\/\s*)?Yomdel Live Lead\s*[–\-]/i;
  private readonly YOMDEL_REPLY_RE = /^re:\s/i;

  private async handleYomdel(ticketKey: string, summary: string, status?: string): Promise<void> {
    const YO_WIP_TRANSITION = '11';
    const YO_DONE_TRANSITION = '81';

    const isLead = this.YOMDEL_LEAD_RE.test(summary);
    const isReply = this.YOMDEL_REPLY_RE.test(summary);

    if (isLead && !isReply) {
      // Resolve the current status — use provided value or fetch from Jira
      let currentStatus = (status ?? '').toLowerCase();
      if (!currentStatus) {
        try {
          const issue = await this.jiraClient.getIssue(ticketKey, ['status']);
          currentStatus = ((issue?.fields?.status as any)?.name ?? '').toLowerCase();
        } catch (err) {
          console.warn(`[agent] YO could not fetch status for ${ticketKey}, assuming open:`, err instanceof Error ? err.message : err);
          currentStatus = 'open';
        }
      }

      await prepareTicketForClose(this.jiraClient, this.settings, {
        ticketKey,
        requestTypeOverride: 'Emailed request',
      });
      const { fields, comment } = buildResolveFields({
        tldr: 'Yomdel live lead — auto-closed by NOVA',
        resolution: 'No Fault Found',
        comment: 'Yomdel live lead — auto-closed by NOVA, no action required.',
      });

      // YO workflow: Open → WIP (11) → Done (81). No direct Open → Resolved.
      const isAlreadyWip = currentStatus.includes('progress') || currentStatus === 'work in progress';
      if (!isAlreadyWip) {
        await this.jiraClient.transitionIssue(ticketKey, YO_WIP_TRANSITION, {});
        console.log(`[agent] YO transitioned ${ticketKey} to WIP (${YO_WIP_TRANSITION})`);
      }
      await this.jiraClient.transitionIssue(ticketKey, YO_DONE_TRANSITION, {
        fields,
        comment: { ...comment, internal: true },
      });
      console.log(`[agent] YO auto-closed: ${ticketKey} — "${summary}"`);
    } else if (isReply) {
      console.log(`[agent] YO reply — leaving for human: ${ticketKey}`);
    } else {
      console.log(`[agent] YO non-lead — skipping: ${ticketKey}`);
    }
  }

  private determinePool(
    decision: import('./agent-types.js').AgentDecision,
    project: string,
    ticket?: { current_tier?: string | null; labels?: string | null } | null,
  ): Pool | null {
    // New tickets ALWAYS route to Customer Care. The only things that can divert a fresh
    // ticket out of CC are explicit routing rules — and the deterministic ones
    // (mwu-tier-2, plugin_to_tpj) plus the NTPJ fast-path run earlier in the tick and
    // never reach here. So the only rules left to apply at triage are the int_setup
    // label and the Development guard. The current_tier field is NOT authoritative at
    // triage time and must not divert routing: a T2/T3/Production tier on a brand-new
    // ticket does not pull it out of CC (it goes to CC; if it is genuinely T2 it gets
    // re-tiered and the unassigned sweep / a routing rule reassigns it to a T2 agent).

    // NTPJ (TPJ Maintenance) is its own team — route by PROJECT, not tier. NTPJ tickets
    // are almost always tier "Customer Care", which would otherwise mis-route them to the
    // CC pool and (with no cross-tier fallback) fail to assign. Matches n8n's hard switch.
    if (project === 'NTPJ') return 'tpj';

    // int_setup label is a routing rule → TPJ
    if (ticket?.labels && ticket.labels.includes('int_setup')) return 'tpj';

    // Development-tier tickets are never auto-assigned
    if (ticket?.current_tier && ticket.current_tier.trim() === 'Development') return null;

    return 'cc';
  }

  // ── C3: Unassigned ticket sweep (48-hour catch-up) ──
  // Catches tickets missed by event-driven assignment: pool resolution failures,
  // downtime gaps, restarts, or any silent assignment failures.
  async runUnassignedSweep(options?: { maxAgeHours?: number; limit?: number; skipWorkingHoursCheck?: boolean }): Promise<{ assigned: number; failed: number; total: number }> {
    if (!this.assignmentEngine) return { assigned: 0, failed: 0, total: 0 };
    if (!options?.skipWorkingHoursCheck && !this.assignmentEngine.isWorkingTime()) return { assigned: 0, failed: 0, total: 0 };

    // 0 = no age cap. A ticket shouldn't go permanently unassigned just because it aged past
    // a window — round-robin should still place it. Was 168h (7 days), which silently stranded
    // older tickets. Configurable via agent_sweep_max_age_hours (default 0 = no limit).
    const maxAgeHours = options?.maxAgeHours ?? this.getNumber('agent_sweep_max_age_hours', 0);
    const limit = options?.limit ?? this.getNumber('agent_sweep_limit', 30);
    const ageClause = maxAgeHours > 0 ? `AND c.created_at >= DATEADD(hour, -${maxAgeHours}, GETUTCDATE())` : '';

    try {
      const projects = this.assignmentEngine.getConfiguredProjects();
      const novaAccountId = this.settings.get('nova_ai_jira_account_id') ?? '';
      const projectPlaceholders = projects.map(() => '?').join(', ');

      const unassigned = await query<{
        issue_key: string; summary: string; status_name: string;
        request_type: string | null; current_tier: string | null;
        labels: string | null; jira_created: string | null;
        reporter_email: string | null;
      }>(
        `SELECT TOP (${limit}) c.issue_key, c.summary, c.status_name, c.request_type,
                c.current_tier, c.labels, c.jira_created, c.reporter_email
         FROM jira_issue_cache c
         WHERE (c.assignee_account_id IS NULL OR c.assignee_account_id = ?)
           AND c.status_category != 'done'
           AND (c.current_tier IS NULL OR c.current_tier != 'Development')
           AND c.created_at < DATEADD(minute, -5, GETUTCDATE())
           ${ageClause}
           AND c.project_key IN (${projectPlaceholders})
           AND (c.request_type IS NULL OR c.request_type NOT IN ('Escalation'))
           AND (c.labels IS NULL OR c.labels NOT LIKE '%TPJ_Feed%')
           AND NOT EXISTS (
             SELECT 1 FROM approval_queue aq
             WHERE aq.ticket_id = c.issue_key AND aq.status = 'pending'
           )
         ORDER BY c.created_at ASC`,
        [novaAccountId, ...projects],
      );

      if (unassigned.length === 0) return { assigned: 0, failed: 0, total: 0 };
      console.log(`[agent] Unassigned sweep (${maxAgeHours > 0 ? maxAgeHours + 'h window' : 'no age cap'}): ${unassigned.length} tickets found`);

      const maxPerPool: Record<string, number> = {
        cc: this.getNumber('assignment_max_per_run_cc', 30),
        t2: this.getNumber('assignment_max_per_run_t2', 30),
        tpj: this.getNumber('assignment_max_per_run_tpj', 10),
        digital: 10,
      };
      const assignedPerPool: Record<string, number> = {};
      const tpjMaxAgeDays = this.getNumber('assignment_tpj_max_age_days', 24);

      let assigned = 0;
      let failed = 0;
      for (const ticket of unassigned) {
        const project = this.assignmentEngine.resolveProjectFromTicketKey(ticket.issue_key);
        const pool = this.determinePoolFromTicket(ticket, project);
        if (!pool) continue;

        // Per-pool max-per-run cap
        const poolCount = assignedPerPool[pool] || 0;
        if (poolCount >= (maxPerPool[pool] || 10)) continue;

        // TPJ max-age filter
        if (pool === 'tpj' && ticket.jira_created) {
          const maxAge = tpjMaxAgeDays * 24 * 60 * 60 * 1000;
          if (Date.now() - new Date(ticket.jira_created).getTime() > maxAge) continue;
        }

        try {
          const assignment = await this.assignmentEngine.assignWithFallback(
            ticket.issue_key, pool, project,
          );
          if (assignment) {
            await this.assignmentEngine.postAssignmentComment(ticket.issue_key, assignment);
            // Update request type from "AI Request" to classified type after assignment
            if (ticket.request_type === 'AI Request') {
              try {
                await this.updateRequestTypeFromDecision(ticket.issue_key);
              } catch (rtErr) {
                console.warn(`[agent] Sweep: failed to update request type for ${ticket.issue_key}:`, rtErr instanceof Error ? rtErr.message : rtErr);
              }
            }
            console.log(`[agent] Sweep: assigned ${ticket.issue_key} → ${assignment.agent.display_name}`);
            assigned++;
            assignedPerPool[pool] = poolCount + 1;
          }
        } catch (err) {
          console.warn(`[agent] Sweep: failed ${ticket.issue_key}:`, err instanceof Error ? err.message : err);
          failed++;
        }
      }
      return { assigned, failed, total: unassigned.length };
    } catch (err) {
      console.warn('[agent] Unassigned sweep failed:', err instanceof Error ? err.message : err);
      return { assigned: 0, failed: 0, total: 0 };
    }
  }

  private determinePoolFromTicket(
    ticket: { issue_key: string; current_tier?: string | null; labels?: string | null },
    project: string,
  ): Pool | null {
    // NTPJ (TPJ Maintenance) routes by PROJECT, not tier — NTPJ tickets are almost always
    // tier "Customer Care" and would otherwise mis-route to CC and fail. Matches n8n.
    if (project === 'NTPJ') return 'tpj';

    // int_setup label → TPJ pool (matches n8n routing)
    const labels = ticket.labels || '';
    if (labels.includes('int_setup')) return 'tpj';

    const tier = (ticket.current_tier || '').trim();
    if (tier === 'Development') return null;
    if (tier === 'Customer Care' || tier === 'T1') return 'cc';
    if (['Tier 2', 'Tier2', 'T2', 'Tier 3', 'Tier3', 'T3', 'Production'].includes(tier)) return 't2';

    if (tier && tier !== '') {
      console.warn(`[agent] Unknown tier "${tier}" for ${ticket.issue_key}, defaulting to CC`);
    }
    return 'cc';
  }

  private async getTicketRoutingState(ticketKey: string): Promise<{ current_tier: string | null; labels: string | null }> {
    const ticket = await queryOne<{ current_tier: string | null; labels: string | null }>(
      `SELECT current_tier, labels FROM jira_issue_cache WHERE issue_key = ?`,
      [ticketKey],
    );
    return {
      current_tier: ticket?.current_tier ?? null,
      labels: ticket?.labels ?? null,
    };
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
          const comments = await query<{ body_text: string; author_display: string }>(
            `SELECT TOP 5 body_text, author_display FROM jira_comment_cache
             WHERE issue_key = ? ORDER BY jira_created DESC`,
            [ticket.issue_key],
          );

          const resolutionComments = comments.map(c => `${c.author_display}: ${c.body_text?.slice(0, 300)}`).join('\n');
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
    // Don't log or track error-sourced no_action decisions — they pollute state
    // and prevent the perceiver from re-emitting the ticket on the next tick
    const isErrorNoAction = decision.action === 'no_action'
      && decision.reasoning?.startsWith('Error:');
    if (isErrorNoAction) {
      console.warn(`[agent] Skipping state write for error no_action on ${decision.ticketKey}: ${decision.reasoning}`);
      return;
    }

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

    // ── NTPJ: Immediate round-robin assignment from ticket state, no AI conversation ──
    const project = this.assignmentEngine?.resolveProjectFromTicketKey(decision.ticketKey) ?? 'NT';
    if (project === 'NTPJ') {
      if (decision.eventType === 'ticket_created' && decision.action !== 'no_action') {
        try { await ticketState.transition(decision.ticketKey, 'triaged', { lastTriageDecisionId: decisionId }); } catch { /* best effort */ }
      }
      if (this.assignmentEngine) {
        try {
          const ticket = await this.getTicketRoutingState(decision.ticketKey);
          const pool = this.determinePoolFromTicket({ issue_key: decision.ticketKey, ...ticket }, 'NTPJ') ?? 'cc';
          const assignment = await this.assignmentEngine.assignWithFallback(decision.ticketKey, pool, 'NTPJ');
          if (assignment) {
            await this.assignmentEngine.postAssignmentComment(decision.ticketKey, assignment);
            console.log(`[agent] NTPJ immediate assign: ${decision.ticketKey} → ${assignment.agent.display_name} (${pool.toUpperCase()})`);
            await this.observer.logOutcome(decisionId, {
              success: true, action: 'assign', ticketKey: decision.ticketKey,
              detail: `NTPJ immediate round-robin to ${assignment.agent.display_name} (${pool.toUpperCase()} pool).`,
            });
          }
        } catch (err) {
          console.error(`[agent] NTPJ assignment failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
        }
      }
      this.ticketsProcessed++;
      return;
    }

    // ── YO (Yomdel): Auto-close live leads, no AI/triage/assignment ──
    if (project === 'YO') {
      try {
        const summary = (decision.inputs.summary as string) ?? '';
        const yoStatus = (decision.inputs.status as string) ?? undefined;
        await this.handleYomdel(decision.ticketKey, summary, yoStatus);
        await this.observer.logOutcome(decisionId, {
          success: true, action: 'transition', ticketKey: decision.ticketKey,
          detail: `YO ticket handled via executeDecision fallback.`,
        });
      } catch (err) {
        console.error(`[agent] YO executeDecision handler failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
      this.ticketsProcessed++;
      return;
    }

    // Lifecycle: transition to 'triaged' on new ticket triage
    if (decision.eventType === 'ticket_created' && decision.action !== 'no_action') {
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
    const rawInternalNote = decision.output.internal_note;
    const hasInternalNote = rawInternalNote && (typeof rawInternalNote === 'string' ? rawInternalNote.length > 0 : typeof rawInternalNote === 'object');
    const shouldPostNote = hasInternalNote && !(isAssigned && mode === 'hands_off');
    if (shouldPostNote) {
      // Skip draft response text when first-reply pipeline will post it separately
      const frThreshold = parseFloat(this.settings.get('agent_first_reply_confidence_threshold') || '0.85');
      const hasDraft = (decision.action === 'draft_response' || decision.action === 'respond');
      const draftText = (decision.output.draft_response as string) ?? '';
      const willPostFirstReply = decision.eventType === 'ticket_created' && hasDraft && draftText && !looksLikeStructuredPayload(draftText);
      const skipDraft = willPostFirstReply && (decision.confidence >= frThreshold || hasDraft);
      try {
        await this.jiraClient.addComment(decision.ticketKey, this.formatInternalNote(decision, { skipDraftResponse: !!skipDraft }), { internal: true });
        console.log(`[agent] Posted internal note on ${decision.ticketKey}${decision.shadowMode ? ' [SHADOW]' : ''}`);
      } catch (err) {
        console.warn(`[agent] Failed to post internal note on ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    if (decision.action === 'no_action') {
      this.ticketsProcessed++;
      return;
    }

    // Observer mode: post notes only, no external actions on assigned tickets —
    // EXCEPT a high-confidence customer resolution-confirmation, which auto-closes even
    // on a human-assigned ticket. A clear "thanks, this is resolved" needs no human input;
    // without this carve-out NOVA would only post a note and leave the ticket open.
    if (isAssigned && mode === 'observer') {
      if (!decision.shadowMode && this.isResolutionConfirmationClose(decision) && this.guardrails.validate(decision).allowed) {
        if (!(decision.output.quick_win as { type?: string } | undefined)?.type) {
          const intent = decision.output.intent as { confidence?: number } | undefined;
          decision.output.quick_win = {
            type: 'thank_you',
            confidence: intent?.confidence ?? decision.confidence,
            reasoning: 'Customer confirmed resolution — auto-closing despite human assignee.',
          };
        }
        const qwResult = await this.quickWinExecutor.executeAutoClose(decision, decisionId);
        await this.observer.logOutcome(decisionId, qwResult);
        console.log(`[agent] [OBSERVER→AUTO-CLOSE] ${decision.ticketKey}: customer confirmed resolution, closed without human input (${qwResult.success ? 'ok' : 'failed: ' + qwResult.error})`);
        this.ticketsProcessed++;
        return;
      }
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
      await this.observer.logOutcome(decisionId, {
        success: true,
        action: decision.action,
        ticketKey: decision.ticketKey,
        detail: `[SHADOW] Would execute first-reply pipeline. Draft: ${((decision.output.draft_response as string) ?? '').slice(0, 200)}`,
      });
      console.log(`[agent] [SHADOW] ${decision.ticketKey}: would execute first-reply pipeline (confidence: ${decision.confidence.toFixed(2)})`);
      this.ticketsProcessed++;
      return;
    }

    // Quick-win auto-close (only reached in non-shadow mode)
    const qw = decision.output.quick_win as { type?: string; confidence?: number; reasoning?: string } | undefined;
    const closableQwTypes = ['spam', 'vendor_email', 'thank_you', 'stale_no_response', 'auto_resolved', 'duplicate', 'auto_reply', 'out_of_office'];
    const alwaysAutoCloseTypes = ['auto_reply', 'out_of_office'];
    if (qw?.type && qw.type !== 'none') {
      const isAlwaysClose = alwaysAutoCloseTypes.includes(qw.type) && (qw.confidence ?? 0) >= 0.85;
      const shouldClose = isAlwaysClose || await this.quickWinExecutor.shouldAutoClose(decision, decisionId);
      if (shouldClose) {
        const qwResult = await this.quickWinExecutor.executeAutoClose(decision, decisionId);
        await this.observer.logOutcome(decisionId, qwResult);
        if (!qwResult.success) {
          console.warn(`[agent] Quick-win auto-close failed for ${decision.ticketKey}: ${qwResult.error}`);
        } else if (isAlwaysClose) {
          console.log(`[agent] Auto-closed ${decision.ticketKey}: ${qw.type} (${(qw.confidence ?? 0).toFixed(2)}) — no approval required`);
        }
        this.ticketsProcessed++;
        return;
      }

      // Quick win detected but auto-close not enabled/allowed — submit to approval queue for close
      if (closableQwTypes.includes(qw.type) && (qw.confidence ?? 0) >= 0.85 && decision.action === 'draft_response') {
        decision.action = 'transition';
        decision.approvalRequired = true;
        console.log(`[agent] Quick win ${qw.type} (${(qw.confidence ?? 0).toFixed(2)}) — routing to approval queue for close`);
      }

      if (qw.type === 'duplicate' && qw.reasoning) {
        const note = decision.output.internal_note;
        if (note && typeof note === 'object' && 'summary' in (note as any)) {
          (note as any).summary = `${(note as any).summary}\n[Duplicate detection] ${qw.reasoning}`;
        } else {
          const existing = typeof note === 'string' ? note : '';
          decision.output.internal_note = `${existing ? existing + '\n' : ''}[Duplicate detection] ${qw.reasoning}`;
        }
      }
    }

    // ── NT First-Reply Pipeline ──
    // For draft_response actions: post first reply as public comment, bypassing approval queue.
    // Approval queue is ONLY for transition (close/resolve) actions.
    const FIRST_REPLY_CONFIDENCE_THRESHOLD = parseFloat(this.settings.get('agent_first_reply_confidence_threshold') || '0.85');
    const isDraftResponse = decision.action === 'draft_response' || decision.action === 'respond';
    const isNewTicketTriage = decision.eventType === 'ticket_created';
    const existingLifecycle = (await ticketState.get(decision.ticketKey))?.lifecycle;

    // ── Conversation continuation (ai_conversation tickets) ──
    if (existingLifecycle === 'ai_conversation' && decision.eventType === 'comment_added' && isDraftResponse) {
      const sentiment = (decision.inputs.sentiment as string) ?? 'neutral';
      const isFrustrated = sentiment === 'frustrated' || sentiment === 'angry';

      // Count prior AI public replies on this ticket
      const priorReplies = await query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_decisions
         WHERE ticket_id = ? AND action IN ('public_reply', 'draft_response')
           AND shadow_mode = 0 AND outcome LIKE '%public reply%'`,
        [decision.ticketKey],
      );
      const exchangeCount = priorReplies[0]?.cnt ?? 0;

      if (isFrustrated || exchangeCount >= 3 || decision.confidence < FIRST_REPLY_CONFIDENCE_THRESHOLD) {
        const reason = isFrustrated ? 'frustrated sentiment' : exchangeCount >= 3 ? 'max exchanges reached' : 'confidence dropped';
        console.log(`[agent] AI conversation handoff for ${decision.ticketKey}: ${reason}`);
        await this.executeHandoff(decision, decisionId, ticketState, reason);
        this.ticketsProcessed++;
        return;
      }

      // Continue conversation: post another public reply
      const draftText = (decision.output.draft_response as string) ?? '';
      if (draftText) {
        const replyResult = await this.actor.postPublicReply(decision.ticketKey, draftText);
        await this.observer.logOutcome(decisionId, replyResult);
        if (replyResult.success) {
          console.log(`[agent] AI conversation reply #${exchangeCount + 1} on ${decision.ticketKey} (confidence: ${decision.confidence.toFixed(2)})`);
          await ticketState.transition(decision.ticketKey, 'ai_conversation', {
            lastAgentActionAt: new Date().toISOString(),
          });
        }
      }
      this.ticketsProcessed++;
      return;
    }

    // ── First reply on new ticket triage ──
    if (isNewTicketTriage && isDraftResponse) {
      const draftText = (decision.output.draft_response as string) ?? '';

      if (decision.confidence >= FIRST_REPLY_CONFIDENCE_THRESHOLD && draftText && !looksLikeStructuredPayload(draftText)) {
        // High confidence: post AI draft as public first reply
        const replyResult = await this.actor.postPublicReply(decision.ticketKey, draftText);
        await this.observer.logOutcome(decisionId, replyResult);

        if (replyResult.success) {
          // Withdraw any pending approvals for this ticket — prevents double-fire
          if (this.approvalQueries) {
            try {
              await this.approvalQueries.withdrawByTicketKey(decision.ticketKey, 'first-reply-posted');
            } catch { /* best effort */ }
          }

          const needsReply = !!(decision.output.needs_customer_reply ?? true);
          // NOVA keeps the ticket assigned to itself and works it — it does NOT
          // round-robin to a human here. If it asked a question → ai_conversation
          // (await reply, continue dialogue); if it gave a definitive answer →
          // awaiting_customer (lifecycle sweep handles chase/auto-close, or
          // re-engages on customer reply). Round-robin only fires on genuine
          // handoff (low confidence, escalation, frustration, or assign failure).
          const targetState = needsReply ? 'ai_conversation' : 'awaiting_customer';
          const novaAccountId = this.settings.get('nova_ai_jira_account_id');
          let assignedToNova = false;
          if (novaAccountId) {
            try {
              await this.jiraClient.updateFields(decision.ticketKey, { assignee: { accountId: novaAccountId } });
              assignedToNova = true;
            } catch (err) {
              console.error(`[agent] Failed to assign ${decision.ticketKey} to NOVA-Jira — falling back to handoff:`, err instanceof Error ? err.message : err);
            }
          } else {
            console.warn(`[agent] nova_ai_jira_account_id not configured — cannot keep ${decision.ticketKey} on NOVA`);
          }

          if (assignedToNova) {
            console.log(`[agent] First reply posted (AI draft) on ${decision.ticketKey} — confidence ${(decision.confidence * 100).toFixed(0)}%, ${needsReply ? 'awaiting reply (ai_conversation)' : 'answer given, awaiting customer (awaiting_customer)'}`);
            try {
              await ticketState.transition(decision.ticketKey, targetState, {
                lastAgentActionAt: new Date().toISOString(),
              });
            } catch { /* best effort */ }

            try {
              await this.updateRequestTypeAfterAssign(decision);
            } catch (err) {
              console.warn(`[agent] Request type update failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
            }
          } else {
            // Assignment failed — fall back to human handoff so ticket doesn't sit unassigned
            console.log(`[agent] NOVA-Jira assignment failed for ${decision.ticketKey} — falling back to executeHandoff`);
            await this.executeHandoff(decision, decisionId, ticketState, 'high confidence no question');
          }
        }
      } else {
        // Low confidence: round-robin first, then generic first reply, then handoff
        console.log(`[agent] Low confidence (${(decision.confidence * 100).toFixed(0)}%) on ${decision.ticketKey} — generic first reply + immediate handoff`);
        await this.executeHandoff(decision, decisionId, ticketState, 'low confidence first reply');
      }

      this.ticketsProcessed++;
      return;
    }

    // ── Approval queue: ONLY for transition (close/resolve) actions ──
    if (decision.approvalRequired && decision.action === 'transition') {
      const existingPending = this.approvalQueries
        ? await this.approvalQueries.getPendingByTicket(decision.ticketKey)
        : null;
      if (existingPending) {
        console.log(`[agent] Skipping duplicate approval for ${decision.ticketKey}: pending approval #${existingPending.id} already exists`);
      } else {
        await this.submitToApprovalQueue(decision, decisionId);
      }
      this.ticketsProcessed++;
      return;
    }

    // ── All other actions: execute directly ──
    const result = await this.actor.execute(decision);
    await this.observer.logOutcome(decisionId, result);
    if (!result.success) {
      this.errorCount++;
      console.warn(`[agent] Action failed for ${decision.ticketKey}: ${result.error}`);
    }

    // Auto-assign via Round Robin if ticket is still unassigned after action
    if (!decision.inputs.assignee && !decision.shadowMode) {
      if (this.assignmentEngine) {
        console.log(`[agent] Auto-assign check for ${decision.ticketKey}: unassigned, attempting round-robin`);
        await this.tryAutoAssign(decision);
      }
    }

    this.ticketsProcessed++;
  }

  /**
   * Execute the full handoff sequence: round-robin → generic first reply (if needed) → handoff summary → public handoff message → request type update.
   */
  private async executeHandoff(
    decision: AgentDecision,
    decisionId: number,
    ticketState: import('./ticket-state.js').TicketStateStore,
    reason: string,
  ): Promise<void> {
    const reporterName = (decision.inputs.reporter as string) ?? 'there';
    const classification = decision.output.classification as { category?: string; ticket_type?: string } | undefined;

    // Step 1: Round-robin assign (resolve assignee before generating messages)
    // Assignment comment is NOT posted here — it's merged into the handoff summary (step 3) to reduce comment spam.
    let assigneeName: string | null = null;
    if (this.assignmentEngine) {
      try {
        const project = this.assignmentEngine.resolveProjectFromTicketKey(decision.ticketKey);
        const ticket = await queryOne<{
          current_tier: string | null;
          labels: string | null;
        }>(
          `SELECT current_tier, labels FROM jira_issue_cache WHERE issue_key = ?`,
          [decision.ticketKey],
        );

        // Unknown tier no longer aborts the handoff: new tickets always route to CC,
        // so a missing current_tier defaults to CC rather than bailing out and leaving
        // the ticket parked on NOVA. (The Development guard still applies in determinePool.)
        const handoffPool = this.determinePool(decision, project, ticket);
        if (!handoffPool) {
          console.log(`[agent] Handoff: skipping assignment for ${decision.ticketKey} — Development tier`);
        } else {
          const assignment = await this.assignmentEngine.assignWithFallback(decision.ticketKey, handoffPool, project);
          if (assignment) {
            assigneeName = assignment.agent.display_name;
            console.log(`[agent] Handoff assignment: ${decision.ticketKey} → ${assigneeName} (${handoffPool})`);
          } else if (this.assignmentEngine.isWorkingTime()) {
            await this.alertService.createAlert({
              alertType: 'error', severity: 'warning',
              title: `Handoff assignment failed: ${decision.ticketKey}`,
              detail: `No agents available in any pool during handoff. Ticket is unassigned — manual assignment required.`,
            });
          }
        }
      } catch (err) {
        console.warn(`[agent] Handoff assignment failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 2: Generic first reply (only for new tickets with low confidence, not for conversation timeouts)
    if (reason === 'low confidence first reply') {
      try {
        const genericReply = await this.reasoner.generateGenericFirstReply({
          ticketKey: decision.ticketKey,
          summary: (decision.inputs.summary as string) ?? decision.ticketKey,
          description: (decision.inputs.description as string) ?? '',
          reporterName,
          assigneeName: assigneeName ?? 'our Customer Care team',
        });
        const replyResult = await this.actor.postPublicReply(decision.ticketKey, genericReply);
        if (replyResult.success) {
          console.log(`[agent] Generic first reply posted on ${decision.ticketKey}`);
        }
      } catch (err) {
        console.warn(`[agent] Generic first reply failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 3: Handoff summary (internal comment) — includes assignment info to avoid a separate comment
    try {
      const exchanges = await this.getAiExchanges(decision.ticketKey);
      const handoffSummary = await this.reasoner.generateHandoffSummary({
        ticketKey: decision.ticketKey,
        summary: (decision.inputs.summary as string) ?? '',
        category: classification?.category ?? 'unknown',
        ticketType: classification?.ticket_type ?? 'unknown',
        confidence: decision.confidence,
        exchanges,
        kbReferences: ((decision.inputs.kb_matches as any[]) ?? []).map((m: any) => m.title ?? m.path ?? 'KB article').slice(0, 5),
        recommendedNextSteps: decision.reasoning?.slice(0, 500) ?? '',
        assigneeName: assigneeName ?? undefined,
      });
      await this.jiraClient.addComment(decision.ticketKey, handoffSummary, { internal: true });
      console.log(`[agent] Handoff summary posted on ${decision.ticketKey}`);
    } catch (err) {
      console.warn(`[agent] Handoff summary failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
    }

    // Step 4: Public handoff message — skip if a public first reply was already posted in this flow
    const alreadyReplied = reason === 'low confidence first reply' || reason === 'high confidence no question';
    if (!alreadyReplied) {
      try {
        const isWorkingHours = this.assignmentEngine?.isWorkingTime() ?? true;
        const nextWorkingDay = this.getNextWorkingDayLabel();
        const handoffMsg = await this.reasoner.generateHandoffMessage({
          reporterName,
          assigneeName,
          isWorkingHours,
          nextWorkingDay,
        });
        await this.actor.postPublicReply(decision.ticketKey, handoffMsg);
        console.log(`[agent] Handoff message posted on ${decision.ticketKey}`);
      } catch (err) {
        console.warn(`[agent] Handoff message failed for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 5: Update request type
    try {
      await this.updateRequestTypeAfterAssign(decision);
    } catch (err) {
      console.warn(`[agent] Request type update failed during handoff for ${decision.ticketKey}:`, err instanceof Error ? err.message : err);
    }

    // Step 6: Transition to handed_off
    try {
      await ticketState.transition(decision.ticketKey, 'handed_off', {
        assigneeName,
        lastAgentActionAt: new Date().toISOString(),
      });
    } catch { /* best effort */ }

    await this.observer.logOutcome(decisionId, {
      success: true, action: 'handoff', ticketKey: decision.ticketKey,
      detail: `Handoff complete (${reason}). Assigned to ${assigneeName ?? 'CC pool'}.`,
    });
  }

  private async getAiExchanges(ticketKey: string): Promise<Array<{ role: 'ai' | 'customer'; text: string; at: string }>> {
    try {
      const comments = await query<{
        body_text: string; author_display: string; is_public: number; jira_created: string;
      }>(
        `SELECT body_text, author_display, is_public, jira_created
         FROM jira_comment_cache
         WHERE issue_key = ? AND is_public = 1
         ORDER BY jira_created ASC`,
        [ticketKey],
      );
      const novaNames = ['NOVA AI', 'NOVA', 'nova-ai'];
      return comments.map(c => ({
        role: novaNames.some(n => c.author_display?.includes(n)) ? 'ai' as const : 'customer' as const,
        text: c.body_text?.slice(0, 300) ?? '',
        at: c.jira_created,
      }));
    } catch {
      return [];
    }
  }

  private getNextWorkingDayLabel(): string {
    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const workingDaysStr = (this.settings.get('agent_working_days') || '1,2,3,4,5').trim();
    const workingDays = new Set(workingDaysStr.split(',').map(d => parseInt(d.trim(), 10)));

    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(now.getTime() + offset * 86_400_000);
      if (workingDays.has(candidate.getDay())) {
        return `${dayNames[candidate.getDay()]} morning`;
      }
    }
    return 'the next working day';
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
      action_type: decision.action,
      action_label: decision.action === 'draft_response' ? 'Send response to customer'
        : decision.action === 'escalate' ? 'Escalate to Customer Care'
        : decision.action === 'assign' ? 'Assign to human agent'
        : decision.action === 'transition' ? 'Close/resolve ticket'
        : decision.action,
      classification,
      sentiment: decision.inputs.sentiment,
      sla_risk: decision.inputs.sla_risk,
      reasoning: decision.reasoning,
      internal_note: decision.output.internal_note ?? null,
      provider: decision.provider,
      model: decision.model,
    });

    const expiresAt = toSqliteDatetime(addBusinessHours(new Date(), 2));

    // Look up current human assignee — route approval to their My Tickets instead of global queue
    let assignedAgent: string | undefined;
    try {
      const novaAccountId = this.settings.get('nova_ai_jira_account_id') ?? '';
      const cached = await query<{ assignee_display: string | null; assignee_account_id: string | null }>(
        `SELECT assignee_display, assignee_account_id FROM jira_issue_cache WHERE issue_key = ?`,
        [decision.ticketKey],
      ).then(rows => rows[0] ?? null);
      if (cached?.assignee_account_id && cached.assignee_account_id !== novaAccountId) {
        assignedAgent = cached.assignee_account_id;
      }
    } catch { /* best effort — falls back to global queue */ }

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
        action_type: decision.action,
        source: 'nova_ai',
        assigned_agent: assignedAgent,
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

  private formatInternalNote(decision: AgentDecision, opts?: { skipDraftResponse?: boolean }): string {
    const classification = decision.output.classification as { ticket_type?: string; category?: string; sub_category?: string; confidence?: number; impact?: string; urgency?: string; priority_matrix?: string } | undefined;
    const priorityAssessment = decision.output.priority_assessment as { suggested_priority?: number; reasoning?: string } | undefined;
    const rawNote = decision.output.internal_note;
    const sentiment = (decision.inputs.sentiment as string) ?? null;
    const slaRisk = (decision.inputs.sla_risk as string) ?? null;
    const assigneeName = (decision.inputs.assignee as string) ?? null;
    const draftResponse = (decision.output.draft_response as string) ?? null;
    const recommendedTier = (decision.output.recommended_tier as string) ?? null;

    const triggerLabel = decision.eventType === 'ticket_created' ? 'New Ticket Triage'
      : decision.eventType === 'comment_added' ? 'New Customer Reply'
      : decision.eventType === 'stale' ? 'Stale Ticket Review'
      : 'Ticket Review';

    const shadowTag = decision.shadowMode ? ' [SHADOW MODE — observe only]' : '';

    // Normalise internal_note: structured object or legacy string
    type StructuredNote = {
      summary: string;
      actions_issues: string[];
      private_comment: { diagnosis: string; severity: string; probable_causes: string[] };
      next_steps: { tier: string; steps: { title: string; details: string[] }[] };
      escalation_guidance: { current_tier_appropriate: string; escalate_if: string[]; do_not_escalate_if: string | null };
    };
    const note: StructuredNote = typeof rawNote === 'string'
      ? { summary: rawNote, actions_issues: [], private_comment: { diagnosis: '', severity: '', probable_causes: [] }, next_steps: { tier: '', steps: [] }, escalation_guidance: { current_tier_appropriate: '', escalate_if: [], do_not_escalate_if: null } }
      : (rawNote as StructuredNote) ?? { summary: '', actions_issues: [], private_comment: { diagnosis: '', severity: '', probable_causes: [] }, next_steps: { tier: '', steps: [] }, escalation_guidance: { current_tier_appropriate: '', escalate_if: [], do_not_escalate_if: null } };

    const lines = [
      `\u{1F916} AI ${triggerLabel}${shadowTag}`,
      ``,
      note.summary,
    ];

    if (note.actions_issues.length > 0) {
      lines.push(``, `**Actions / Issues:**`);
      for (const action of note.actions_issues) lines.push(`- ${action}`);
    }

    if (note.private_comment.diagnosis) {
      lines.push(``, `**Private Comment (for agents only):**`, note.private_comment.diagnosis);
      if (note.private_comment.probable_causes.length > 0) {
        lines.push(``, `Probable causes:`);
        for (const cause of note.private_comment.probable_causes) lines.push(`- ${cause}`);
      }
    }

    if (note.next_steps.steps.length > 0) {
      lines.push(``, `Next steps (${note.next_steps.tier || recommendedTier || 'assigned tier'}):`);
      for (let i = 0; i < note.next_steps.steps.length; i++) {
        const step = note.next_steps.steps[i];
        lines.push(`${i + 1}. ${step.title}:`);
        for (const detail of step.details) lines.push(`   - ${detail}`);
      }
    }

    if (note.escalation_guidance.current_tier_appropriate || note.escalation_guidance.escalate_if.length > 0) {
      lines.push(``, `Escalation guidance:`);
      if (note.escalation_guidance.current_tier_appropriate) {
        lines.push(`- ${note.escalation_guidance.current_tier_appropriate}`);
      }
      if (note.escalation_guidance.escalate_if.length > 0) {
        lines.push(`- Escalate if:`);
        for (const cond of note.escalation_guidance.escalate_if) lines.push(`  - ${cond}`);
      }
      if (note.escalation_guidance.do_not_escalate_if) {
        lines.push(`- Do not escalate if: ${note.escalation_guidance.do_not_escalate_if}`);
      }
    }

    // --- Metadata ---
    lines.push(``, `--- Metadata ---`);
    lines.push(`**Confidence:** ${(decision.confidence * 100).toFixed(0)}%`);
    if (sentiment) lines.push(`**Sentiment:** ${sentiment}`);

    if (classification?.ticket_type) {
      const typeLabel = classification.ticket_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const catLabel = classification.category && classification.sub_category
        ? `${classification.category} > ${classification.sub_category}`
        : classification.category ?? '';
      lines.push(`**Type:** ${typeLabel}${catLabel ? ` | **Category:** ${catLabel}` : ''}`);
      if (classification.impact && classification.urgency && classification.priority_matrix) {
        lines.push(`**Impact:** ${classification.impact} | **Urgency:** ${classification.urgency}`);
      }
    }

    if (slaRisk && slaRisk !== 'unknown') lines.push(`**SLA Risk:** ${slaRisk}`);

    if (priorityAssessment?.suggested_priority) {
      lines.push(`**Suggested Priority:** ${priorityAssessment.suggested_priority} — ${priorityAssessment.reasoning ?? ''}`);
    }

    if (classification?.priority_matrix) {
      lines.push(`**Priority:** ${classification.priority_matrix}`);
    }

    const tierLabels: Record<string, string> = { customer_care: 'Customer Care', tier_2: 'Tier 2', tier_3: 'Tier 3', development: 'Development' };
    if (recommendedTier) {
      lines.push(`**Recommended Tier:** ${tierLabels[recommendedTier] ?? recommendedTier}`);
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

    if (draftResponse && !opts?.skipDraftResponse) {
      lines.push(``, `**Suggested response:**`, draftResponse);

      const statusDesc = decision.shadowMode
        ? `This is shadow mode — the AI is observing only. No action has been taken.`
        : decision.approvalRequired
          ? `A draft reply has been submitted to the NOVA approval queue for agent review before sending.`
          : `This action was executed automatically based on autonomy rules.`;
      lines.push(``, statusDesc);
    } else if (opts?.skipDraftResponse) {
      lines.push(``, `_First reply posted separately by NOVA._`);
    }
    lines.push(`_${decision.provider ?? 'unknown'}/${decision.model ?? 'unknown'}_`);

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

    // Sync agent_decisions.approval_status so the row doesn't ghost back as pending
    const approvalStatus = (action === 'approve' || action === 'approved') ? 'approved'
      : (action === 'decline' || action === 'declined') ? 'declined'
      : action === 'cancel' || action === 'cancelled' ? 'cancelled' : null;
    if (approvalStatus) {
      try {
        await execute(
          `UPDATE agent_decisions SET approval_status = ?, resolved_at = GETUTCDATE(), resolved_by = ?
           WHERE ticket_id = ? AND approval_required = 1 AND (approval_status IS NULL OR approval_status = 'pending')`,
          [approvalStatus, decidedBy ?? 'unknown', ticketKey],
        );
      } catch (err) {
        console.warn(`[agent] Failed to sync agent_decisions approval_status for ${ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    if (action === 'approve' || action === 'approved') {
      if (this.isShadowMode()) {
        console.log(`[agent] Enhanced hybrid: executing ${ticketKey} despite shadow mode — human override by ${decidedBy}`);
      }

      // Resolve the action type so we know if this is a close/resolve (needs transition) or just a comment.
      // The approval_queue stores the decision's action (usually 'draft_response'), but the
      // decision output may contain a more specific recommended_action (e.g. 'close', 'resolve').
      // We always check agent_decisions for the real action type.
      let actionType: string | null = null;
      let quickWinType: string | null = null;
      if (approvalId && this.approvalQueries) {
        const approval = await this.approvalQueries.getById(approvalId);
        actionType = approval?.action_type ?? null;
      }
      // Always check agent_decisions for recommended_action — the approval_queue action_type
      // is often just 'draft_response' even for close/resolve recommendations (Snag 17 fix).
      {
        const decRow = await query<{ action: string; output: string }>(
          `SELECT TOP 1 action, output FROM agent_decisions WHERE ticket_id = ? ORDER BY created_at DESC`,
          [ticketKey],
        ).then(rows => rows[0] ?? null);
        if (decRow) {
          try {
            const out = JSON.parse(decRow.output || '{}');
            const recommended = out.recommended_action ?? null;
            quickWinType = out.quick_win?.type ?? null;
            // Prefer recommended_action over the generic approval action_type
            if (recommended && recommended !== 'draft_response') {
              actionType = recommended;
            } else if (!actionType) {
              actionType = decRow.action ?? null;
            }
          } catch {
            if (!actionType) actionType = decRow.action ?? null;
          }
        }
      }

      if (!actionType) {
        const errMsg = `No action type found for ${ticketKey} — no approval record or agent decision to execute`;
        console.error(`[agent] APPROVAL EXECUTION FAILED: ${errMsg}`);
        await this.alertService.createAlert({
          alertType: 'error', severity: 'critical',
          title: `Approved but not executed: ${ticketKey}`,
          detail: `${errMsg}. Approved by ${decidedBy ?? 'unknown'}. Manual action required.`,
        });
        throw new Error(errMsg);
      }

      let responseText = editedResponse || '';
      let commentPosted = false;
      if (responseText) {
        // Recovery: if responseText is a JSON blob, extract draft_response from it
        if (looksLikeStructuredPayload(responseText)) {
          try {
            const parsed = JSON.parse(responseText.trim());
            const extracted = parsed.draft_response ?? parsed.response ?? '';
            if (extracted && !looksLikeStructuredPayload(extracted)) {
              console.warn(`[agent] Recovered draft_response from structured payload for ${ticketKey}`);
              responseText = extracted;
            } else {
              console.warn(`[agent] Skipping public comment on ${ticketKey}: response is structured/JSON data with no extractable draft`);
              responseText = '';
            }
          } catch {
            console.warn(`[agent] Skipping public comment on ${ticketKey}: response looks like structured data but failed to parse`);
            responseText = '';
          }
        }
      }
      if (responseText && quickWinType !== 'spam') {
        try {
          const closableActions = ['close', 'quick_win_close', 'resolve', 'transition'];
          const closableQwTypesForComment = ['spam', 'vendor_email', 'thank_you', 'stale_no_response', 'auto_resolved', 'duplicate', 'auto_reply', 'out_of_office'];
          const isCloseAction = (actionType && closableActions.includes(actionType))
            || (quickWinType && closableQwTypesForComment.includes(quickWinType));
          // Close/resolve: customer-facing message goes PUBLIC, reasoning goes as separate internal note
          await this.jiraClient.addComment(ticketKey, responseText, { internal: false });
          console.log(`[agent] Posted approved response on ${ticketKey} (public)`);
          commentPosted = true;

          if (isCloseAction) {
            try {
              const parts: string[] = [`🤖 NOVA AI — Close/Resolve approved by ${decidedBy ?? 'unknown'}`];
              if (actionType) parts.push(`Action: ${actionType}`);
              if (quickWinType) parts.push(`Quick-win type: ${quickWinType}`);
              // Pull reasoning from the decision record
              const decMeta = await query<{ reasoning: string; confidence: number; output: string }>(
                `SELECT TOP 1 reasoning, confidence, output FROM agent_decisions WHERE ticket_id = ? ORDER BY created_at DESC`,
                [ticketKey],
              ).then(rows => rows[0] ?? null);
              if (decMeta) {
                if (decMeta.confidence != null) parts.push(`Confidence: ${(decMeta.confidence * 100).toFixed(0)}%`);
                if (decMeta.reasoning) parts.push(`Reasoning: ${decMeta.reasoning}`);
                try {
                  const out = JSON.parse(decMeta.output || '{}');
                  if (out.classification?.category) parts.push(`Category: ${out.classification.category}`);
                } catch { /* ignore */ }
              }
              await this.jiraClient.addComment(ticketKey, parts.join('\n'), { internal: true });
              console.log(`[agent] Posted internal reasoning note on ${ticketKey}`);
            } catch (noteErr) {
              console.warn(`[agent] Failed to post internal reasoning note on ${ticketKey}:`, noteErr instanceof Error ? noteErr.message : noteErr);
            }
          }

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
              detail: `Approved and posted (${actionType ?? 'draft_response'}). Edited: ${editedResponse ? 'yes' : 'no'}`,
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[agent] APPROVAL EXECUTION FAILED: Failed to post approved response on ${ticketKey}: ${errMsg}`);
          if (decisionId) {
            await this.observer.logOutcome(decisionId, {
              success: false, action: 'draft_response', ticketKey,
              detail: 'Approved but failed to post.', error: errMsg,
            });
          }
          await this.alertService.createAlert({
            alertType: 'error', severity: 'critical',
            title: `Approved but failed to post: ${ticketKey}`,
            detail: `Jira API error: ${errMsg}. Approved by ${decidedBy ?? 'unknown'}. Response text was ${responseText.length} chars. Manual action required.`,
          });
          throw err;
        }
      }

      // If we had a response to post but nothing was posted (empty after extraction), alert
      if (!commentPosted && editedResponse && !responseText) {
        console.warn(`[agent] Approval for ${ticketKey}: response was provided but extracted to empty — no comment posted`);
        await this.alertService.createAlert({
          alertType: 'error', severity: 'warning',
          title: `Approved response not posted: ${ticketKey}`,
          detail: `Response provided but was empty after JSON extraction. Approved by ${decidedBy ?? 'unknown'}. Check if the draft was stored as structured JSON.`,
        });
      }

      // Close/resolve actions: transition the Jira ticket (runs even if comment was blocked/skipped)
      // Also trigger for quick-win types (spam, auto_reply, etc.) even if the LLM recommended 'respond'
      const closableQwTypes = ['spam', 'vendor_email', 'thank_you', 'stale_no_response', 'auto_resolved', 'duplicate', 'auto_reply', 'out_of_office'];
      const shouldTransition = (actionType && ['close', 'quick_win_close', 'resolve', 'transition'].includes(actionType))
        || (quickWinType && closableQwTypes.includes(quickWinType));
      if (shouldTransition) {
        try {
          const RESOLVE_TRANSITION_ID = '17';
          const resMapRaw = this.settings.get('agent_resolution_type_map');
          let resMap: Record<string, string> = {};
          try { if (resMapRaw) resMap = JSON.parse(resMapRaw); } catch { /* use empty */ }
          const effectiveAction = actionType ?? `quick_win_${quickWinType}`;
          const resolution = resMap[effectiveAction] || resMap[quickWinType ?? ''] || 'No Fault Found';
          const { fields, comment } = buildResolveFields({
            tldr: `Approved for ${effectiveAction} by ${decidedBy ?? 'unknown'}`,
            resolution,
            comment: `Ticket resolved — approved by ${decidedBy ?? 'unknown'} via NOVA.`,
          });
          await this.jiraClient.transitionIssue(ticketKey, RESOLVE_TRANSITION_ID, {
            fields,
            comment: { ...comment, internal: true },
          });
          console.log(`[agent] Transitioned ${ticketKey} to Resolved after approved ${effectiveAction}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[agent] Failed to transition ${ticketKey} after approved ${actionType ?? quickWinType}:`, errMsg);
          await this.alertService.createAlert({
            alertType: 'error', severity: 'critical',
            title: `Transition failed after approval: ${ticketKey}`,
            detail: `Approved by ${decidedBy ?? 'unknown'}, action: ${actionType ?? quickWinType}. Jira transition error: ${errMsg}. Manual resolution required.`,
          });
        }
      }

      // Escalation actions: update Current Tier in Jira
      if (actionType === 'escalate') {
        // Hard rule: NOVA always routes to Customer Care, never direct to T2/T3
        const targetTier = 'Customer Care';
        const tierIds: Record<string, string> = {
          'Customer Care': '13061', 'Tier 2': '13062', 'Tier 3': '13063',
          'Development': '13064', 'Production': '13700',
        };
        const tierId = tierIds[targetTier];
        if (tierId) {
          try {
            await this.jiraClient.updateFields(ticketKey, { customfield_12981: { id: tierId } });
            console.log(`[agent] Updated Current Tier to "${targetTier}" on ${ticketKey} after approved escalation`);
          } catch (err) {
            console.warn(`[agent] Failed to update Current Tier on ${ticketKey}:`, err instanceof Error ? err.message : err);
          }
        }
      }

      // Assign actions: run round-robin assignment when an assign decision is approved
      if (actionType === 'assign' && this.assignmentEngine) {
        try {
          const decRow2 = await query<{ output: string }>(
            `SELECT TOP 1 output FROM agent_decisions WHERE ticket_id = ? ORDER BY created_at DESC`,
            [ticketKey],
          ).then(rows => rows[0] ?? null);
          const pool = (decRow2 ? (JSON.parse(decRow2.output || '{}').pool as string) : null) ?? 'cc';
          const project = this.assignmentEngine.resolveProjectFromTicketKey(ticketKey);
          const assignment = await this.assignmentEngine.assignWithFallback(
            ticketKey, pool as import('./assignment-engine.js').Pool, project,
          );
          if (assignment) {
            await this.assignmentEngine.postAssignmentComment(ticketKey, assignment);
            console.log(`[agent] Assigned ${ticketKey} to ${assignment.agent.display_name} after approved assign action`);
          } else {
            console.warn(`[agent] No available agents for ${ticketKey} after approved assign action`);
            await this.alertService.createAlert({
              alertType: 'error', severity: 'warning',
              title: `Approved assign but no agent available: ${ticketKey}`,
              detail: `Approved by ${decidedBy ?? 'unknown'}, but round-robin found no agents in pool '${pool}'. Manual assignment required.`,
            });
          }
        } catch (err) {
          console.error(`[agent] Failed to assign ${ticketKey} after approval:`, err instanceof Error ? err.message : err);
        }
      }

      // Change Request Type from "AI Request" on any handoff (respond, escalate, assign)
      // This ensures the ticket appears in agent queues with the correct type
      try {
        await this.updateRequestTypeFromDecision(ticketKey);
      } catch (err) {
        console.warn(`[agent] Failed to update Request Type on ${ticketKey}:`, err instanceof Error ? err.message : err);
      }

      // Auto-assign after approval — the initial triage deferred assignment while
      // the ticket was pending approval (Snag 18). Now that the response is posted,
      // assign to a human agent via round-robin.
      const noAssignActionTypes = ['close', 'quick_win_close', 'resolve', 'transition', 'escalate', 'assign'];
      if (this.assignmentEngine && actionType && !noAssignActionTypes.includes(actionType)) {
        try {
          const ticket = await queryOne<{ assignee_account_id: string | null }>(
            `SELECT assignee_account_id FROM jira_issue_cache WHERE issue_key = ?`, [ticketKey],
          );
          const novaAccountId = this.settings.get('nova_ai_jira_account_id');
          const isUnassignedOrNova = !ticket?.assignee_account_id || ticket.assignee_account_id === novaAccountId;
          if (isUnassignedOrNova) {
            const project = this.assignmentEngine.resolveProjectFromTicketKey(ticketKey);
            const cachedTicket = await queryOne<{ current_tier: string | null; labels: string | null }>(
              `SELECT current_tier, labels FROM jira_issue_cache WHERE issue_key = ?`, [ticketKey],
            );
            const tier = (cachedTicket?.current_tier || '').trim();
            if (tier === 'Development') {
              console.log(`[agent] Post-approval: skipping assignment for ${ticketKey} — Development tier`);
            } else {
              const poolFromTier = this.determinePoolFromTicket(
                { issue_key: ticketKey, current_tier: cachedTicket?.current_tier, labels: cachedTicket?.labels }, project,
              ) ?? 'cc';
              const assignment = await this.assignmentEngine.assignWithFallback(ticketKey, poolFromTier, project);
              if (assignment) {
                await this.assignmentEngine.postAssignmentComment(ticketKey, assignment);
                console.log(`[agent] Post-approval assignment: ${ticketKey} → ${assignment.agent.display_name}`);
              }
            }
          }
        } catch (err) {
          console.warn(`[agent] Post-approval auto-assign failed for ${ticketKey}:`, err instanceof Error ? err.message : err);
        }
      }

      // Safety net: warn if action type didn't match any known execution path
      const knownActionTypes = ['draft_response', 'respond', 'gather_context', 'comment', 'close', 'quick_win_close', 'resolve', 'transition', 'escalate', 'assign', 'chase', 'no_action'];
      if (actionType && !knownActionTypes.includes(actionType)) {
        console.warn(`[agent] Unhandled action type '${actionType}' for ${ticketKey} — ticket may need manual intervention`);
        await this.alertService.createAlert({
          alertType: 'error', severity: 'warning',
          title: `Approved with unknown action type: ${ticketKey}`,
          detail: `Action type '${actionType}' was approved by ${decidedBy ?? 'unknown'} but has no execution handler. Manual action required.`,
        });
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

  async reReviewTicket(
    approvalId: number,
    declineReason: string,
    requestedBy: string,
  ): Promise<{ ok: boolean; newApprovalId?: number; error?: string }> {
    if (!this.approvalQueries) return { ok: false, error: 'Approval system not available' };

    const original = await this.approvalQueries.getById(approvalId);
    if (!original) return { ok: false, error: 'Original approval not found' };
    if (original.status !== 'declined') return { ok: false, error: 'Can only re-review declined approvals' };

    const ticketKey = original.ticket_id;

    // Reconstruct TicketEvent from jira_issue_cache
    const cached = await queryOne<{
      jira_id: string; issue_key: string; summary: string; description_text: string;
      status_name: string; priority_name: string; request_type: string;
      assignee_display: string | null; reporter_display: string | null;
      reporter_email: string | null; jira_created: Date | null; jira_updated: Date | null;
      sla_breach_time: Date | null; fields_json: string | null;
    }>(`SELECT jira_id, issue_key, summary, description_text, status_name, priority_name,
              request_type, assignee_display, reporter_display, reporter_email,
              jira_created, jira_updated, sla_breach_time, fields_json
        FROM jira_issue_cache WHERE issue_key = ?`, [ticketKey]);

    if (!cached) return { ok: false, error: `Ticket ${ticketKey} not found in Jira cache` };

    const fields = cached.fields_json ? JSON.parse(cached.fields_json) : {};
    const attachments = Array.isArray(fields.attachment)
      ? fields.attachment.map((a: any) => ({ filename: a.filename ?? '', mimeType: a.mimeType ?? '', size: a.size ?? 0 }))
      : [];

    const event = {
      ticketId: cached.jira_id,
      ticketKey: cached.issue_key,
      eventType: 'ticket_created' as const,
      summary: cached.summary ?? '',
      description: cached.description_text ?? '',
      status: cached.status_name ?? 'Unknown',
      priority: cached.priority_name ?? 'Medium',
      requestType: cached.request_type ?? '',
      assignee: cached.assignee_display ?? null,
      reporter: cached.reporter_display ?? null,
      reporterEmail: cached.reporter_email ?? null,
      organisation: cached.reporter_email?.split('@')[1] ?? null,
      created: cached.jira_created?.toISOString() ?? '',
      updated: cached.jira_updated?.toISOString() ?? '',
      slaBreachTime: cached.sla_breach_time?.toISOString() ?? null,
      attachments,
      fields,
    };

    // Extract what the previous recommendation was
    const previousAction = original.action_type ?? 'draft_response';
    const previousResponse = original.ai_response_adf ?? '';

    console.log(`[agent] Re-reviewing ${ticketKey} after decline by ${requestedBy}: "${declineReason}"`);

    try {
      const decision = await this.reasoner.reReview(event, {
        reason: declineReason,
        previousAction,
        previousResponse,
      });

      // Store the new decision
      const decisionId = await executeAndGetId(
        `INSERT INTO agent_decisions (ticket_id, event_type, inputs, output, action, confidence, reasoning, approval_required, shadow_mode, provider, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
        [ticketKey, 'ticket_created', JSON.stringify(decision.inputs), JSON.stringify(decision.output),
         decision.action, decision.confidence, decision.reasoning,
         decision.provider ?? null, decision.model ?? null],
      );

      // Supersede the old approval
      await execute(
        `UPDATE approval_queue SET status = 'superseded' WHERE id = ? AND status = 'declined'`,
        [approvalId],
      );

      // Submit the new decision to the approval queue
      await this.submitToApprovalQueue(decision, decisionId);

      // Find the new approval ID
      const newApproval = await this.approvalQueries.getPendingByTicket(ticketKey);

      console.log(`[agent] Re-review complete for ${ticketKey} — new approval #${newApproval?.id ?? '?'} (action: ${decision.action}, confidence: ${decision.confidence.toFixed(2)})`);
      return { ok: true, newApprovalId: newApproval?.id };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[agent] Re-review failed for ${ticketKey}:`, errMsg);
      return { ok: false, error: errMsg };
    }
  }

  /**
   * Re-checks historic open tickets against time_gate auto-rules. The normal backfill
   * sweep ({@link runBackfillSweep}) only picks tickets with no prior agent_decisions
   * row, so a ticket triaged when fresh is never re-evaluated as it ages — the
   * ">Nh old + unassigned" branch of a time_gate rule would otherwise never fire.
   * This sweep feeds open tickets older than each rule's staleHours straight through
   * the auto-rules engine. Config-driven: any rule with a time_gate conditional and a
   * subject `equals` match is covered automatically. Idempotent — the engine skips
   * already-actioned and already-resolved tickets, and is rate-limited by the rule's
   * daily cap.
   */
  private async runTimeGateStaleSweep(): Promise<void> {
    const enabled = this.settings.get('agent_backfill_enabled');
    if (enabled === 'false' || enabled === '0') return;

    const gates = this.autoRulesEngine.getRules()
      .map(r => {
        const cond = r.conditional;
        const subj = (r.match as { subject?: { equals?: string } }).subject;
        if (cond?.type === 'time_gate' && subj?.equals) {
          return { summary: subj.equals, staleHours: cond.staleHours };
        }
        return null;
      })
      .filter((g): g is { summary: string; staleHours: number } => g !== null);

    if (gates.length === 0) return;

    const shadowMode = this.getShadowMode();

    for (const gate of gates) {
      let rows: Array<{
        issue_key: string; jira_id: string; summary: string; description_text: string;
        status_name: string; priority_name: string; request_type: string;
        assignee_display: string; reporter_display: string; reporter_email: string;
        jira_created: string; jira_updated: string; sla_breach_time: string; fields_json: string;
      }>;
      try {
        rows = await query(
          `SELECT TOP (50) issue_key, jira_id, summary, description_text, status_name,
                  priority_name, request_type, assignee_display, reporter_display,
                  reporter_email, jira_created, jira_updated, sla_breach_time, fields_json
           FROM jira_issue_cache
           WHERE summary = ?
             AND status_category != 'done'
             AND jira_created < DATEADD(HOUR, ?, GETUTCDATE())
           ORDER BY jira_created ASC`,
          [gate.summary, -gate.staleHours],
        );
      } catch (err) {
        console.warn(`[time-gate-sweep] Query failed for "${gate.summary}":`, err instanceof Error ? err.message : err);
        continue;
      }

      if (rows.length === 0) continue;
      console.log(`[time-gate-sweep] Re-checking ${rows.length} open "${gate.summary}" ticket(s) older than ${gate.staleHours}h`);

      for (const row of rows) {
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
          created: row.jira_created ? new Date(row.jira_created).toISOString() : '',
          updated: row.jira_updated ? new Date(row.jira_updated).toISOString() : '',
          slaBreachTime: row.sla_breach_time ?? null,
          fields: row.fields_json ? JSON.parse(row.fields_json) : {},
        };
        try {
          await this.autoRulesEngine.evaluateAndExecute(event, shadowMode);
        } catch (err) {
          console.error(`[time-gate-sweep] Failed for ${row.issue_key}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  async runBackfillSweep(): Promise<{ processed: number; skipped: number; errors: number }> {
    const batchSize = this.getNumber('agent_backfill_batch_size', 10);
    const agentProject = this.settings.get('agent_jira_project') || 'NT';
    const projects = agentProject.split(',').map(p => p.trim());
    const projectPlaceholders = projects.map(() => '?').join(',');

    const untriaged = await query<{
      issue_key: string; jira_id: string; summary: string; description_text: string;
      status_name: string; priority_name: string; request_type: string;
      assignee_display: string; assignee_account_id: string | null;
      reporter_display: string; reporter_email: string;
      jira_created: string; jira_updated: string; sla_breach_time: string;
      fields_json: string; current_tier: string | null; labels: string | null;
    }>(
      `SELECT TOP (${batchSize}) c.issue_key, c.jira_id, c.summary, c.description_text,
              c.status_name, c.priority_name, c.request_type,
              c.assignee_display, c.assignee_account_id, c.reporter_display, c.reporter_email,
              c.jira_created, c.jira_updated, c.sla_breach_time, c.fields_json, c.current_tier, c.labels
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
      // NTPJ/YO: skip triage entirely — these projects never enter the reasoner
      const projectPrefix = row.issue_key.match(/^([A-Z]+)-/)?.[1];
      if (projectPrefix === 'NTPJ') {
        // Only assign if genuinely unassigned — tick() fast-path doesn't write agent_decisions
        const novaAccountId = this.settings.get('nova_ai_jira_account_id') ?? '';
        const isUnassigned = !row.assignee_account_id || row.assignee_account_id === novaAccountId;
        if (isUnassigned && this.assignmentEngine) {
          try {
            const pool = this.determinePoolFromTicket(
              { issue_key: row.issue_key, current_tier: row.current_tier, labels: row.labels },
              'NTPJ',
            ) ?? 'cc';
            const assignment = await this.assignmentEngine.assignWithFallback(row.issue_key, pool, 'NTPJ');
            if (assignment) {
              await this.assignmentEngine.postAssignmentComment(row.issue_key, assignment);
              console.log(`[backfill] NTPJ round-robin: ${row.issue_key} → ${assignment.agent.display_name} (${pool.toUpperCase()})`);
              processed++;
            } else {
              skipped++;
            }
          } catch (err) {
            console.warn(`[backfill] NTPJ assignment failed for ${row.issue_key}:`, err instanceof Error ? err.message : err);
            errors++;
          }
        } else {
          console.log(`[backfill] NTPJ already assigned, skipping: ${row.issue_key} (${row.assignee_display})`);
          skipped++;
        }
        continue;
      }
      if (projectPrefix === 'YO') {
        // status_category != 'done' is enforced by the query, but double-check status
        const statusLower = (row.status_name ?? '').toLowerCase();
        if (statusLower === 'resolved' || statusLower === 'closed' || statusLower === 'done') {
          skipped++;
          continue;
        }
        try {
          await this.handleYomdel(row.issue_key, row.summary ?? '', row.status_name);
          console.log(`[backfill] YO handled: ${row.issue_key}`);
        } catch (err) {
          console.warn(`[backfill] YO handler failed for ${row.issue_key}:`, err instanceof Error ? err.message : err);
        }
        processed++;
        continue;
      }

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
