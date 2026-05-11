import { AUTO_RULES, type AutoRule } from '../config/auto-rules.js';
import type { TicketEvent, AgentShadowMode } from './agent-types.js';
import type { JiraRestClient } from './jira-client.js';
import type { PluginToTpjExecutor } from './plugin-to-tpj-executor.js';
import type { AbuseReportExecutor } from './abuse-report-executor.js';
import type { AssignmentEngine } from './assignment-engine.js';
import type { Observer } from './observer.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { AutoRuleOverrideQueries } from '../db/queries.js';
import { executeAndGetId, query } from './database.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';

const QUICK_RESOLVE_TRANSITION_ID = '17';
const CF_CURRENT_TIER = 'customfield_12981';

const TIER_IDS: Record<string, string> = {
  'Customer Care': '13061',
  'Tier 2': '13062',
  'Tier 3': '13063',
  'Development': '13064',
  'Production': '13700',
};

const DEFAULT_DAILY_CAP = 50;
const MAX_PRE_EMPTION_RETRIES = 3;

// Abuse report field extraction patterns
const ABUSE_FIELD_PATTERNS = {
  abuseEmail: /(?:abuse\s*email|from|email)\s*[:=]\s*([^\r\n]+)/i,
  instanceId: /instance\s*id\s*[:=]\s*(\d+)/i,
  contactId: /contact\s*id\s*[:=]\s*(\d+)/i,
  instanceUrl: /instance\s*url\s*[:=]\s*(https?:\/\/[^\s\r\n]+)/i,
};

export interface AutoRuleMatch {
  rule: AutoRule;
  ticketKey: string;
  ticketId: string;
  matchedFields: Record<string, boolean>;
}

const OVERRIDE_CACHE_TTL_MS = 60_000;

export class AutoRulesEngine {
  private dailyCounts = new Map<string, { date: string; count: number }>();
  private regexCache = new Map<string, RegExp>();
  private abuseExecutor: AbuseReportExecutor | null = null;
  private assignmentEngine: AssignmentEngine | null = null;
  private overrideQueries: AutoRuleOverrideQueries | null = null;
  private overrideCache: Record<string, boolean> | null = null;
  private overrideCacheAt = 0;

  constructor(
    private jiraClient: JiraRestClient,
    private pluginExecutor: PluginToTpjExecutor,
    private observer: Observer,
    private settings: SettingsQueries,
  ) {
    console.log(`[auto-rules] Engine loaded with ${AUTO_RULES.length} rules: ${AUTO_RULES.map(r => r.id).join(', ')}`);
  }

  setOverrideQueries(q: AutoRuleOverrideQueries): void {
    this.overrideQueries = q;
    this.logStartupOverrides();
  }

  private async getOverrides(): Promise<Record<string, boolean>> {
    if (!this.overrideQueries) return {};
    if (this.overrideCache && Date.now() - this.overrideCacheAt < OVERRIDE_CACHE_TTL_MS) return this.overrideCache;
    try {
      this.overrideCache = await this.overrideQueries.getOverrides();
      this.overrideCacheAt = Date.now();
    } catch (err) {
      console.warn('[auto-rules] Failed to load overrides:', err instanceof Error ? err.message : err);
      if (!this.overrideCache) this.overrideCache = {};
    }
    return this.overrideCache;
  }

  invalidateOverrideCache(): void {
    this.overrideCache = null;
    this.overrideCacheAt = 0;
  }

  private async isRuleEnabled(ruleId: string): Promise<boolean> {
    const overrides = await this.getOverrides();
    return overrides[ruleId] !== false;
  }

  private async logStartupOverrides(): Promise<void> {
    try {
      const overrides = await this.getOverrides();
      const disabled = Object.entries(overrides).filter(([, v]) => !v).map(([k]) => k);
      if (disabled.length > 0) {
        console.log(`[auto-rules] Loaded ${AUTO_RULES.length} rules (${disabled.length} disabled via overrides: ${disabled.join(', ')})`);
      } else {
        console.log(`[auto-rules] Loaded ${AUTO_RULES.length} rules (all enabled)`);
      }
    } catch { /* best effort */ }
  }

  setAbuseExecutor(executor: AbuseReportExecutor): void {
    this.abuseExecutor = executor;
  }

  setAssignmentEngine(engine: AssignmentEngine): void {
    this.assignmentEngine = engine;
  }

  async evaluateAndExecute(
    event: TicketEvent,
    shadowMode: AgentShadowMode,
  ): Promise<boolean> {
    if (event.eventType !== 'ticket_created') return false;

    const match = await this.evaluate(event);
    if (!match) return false;

    if (await this.wasAlreadyActioned(event.ticketKey)) {
      console.log(`[auto-rules] Skipping '${match.rule.id}' on ${event.ticketKey} — already actioned by a prior auto-rule`);
      return true;
    }

    const { rule } = match;

    // In full_shadow mode, all auto-rules are shadowed.
    // In hybrid or live mode, deterministic auto-rules always execute —
    // they are safe by definition and don't need the hybrid_allowed_actions gate.
    const isShadow = shadowMode === 'full_shadow';

    // Daily cap check
    const today = new Date().toISOString().slice(0, 10);
    const capKey = rule.id;
    const entry = this.dailyCounts.get(capKey);
    if (entry && entry.date !== today) this.dailyCounts.delete(capKey);

    const current = this.dailyCounts.get(capKey);
    const count = current?.count ?? 0;
    const cap = this.getDailyCap(rule);

    if (count >= cap) {
      console.warn(`[auto-rules] Cap reached for '${rule.id}' (${count}/${cap}) — routing to shadow`);
      await this.logShadowDecision(match, event, `Daily cap reached (${count}/${cap})`);
      return true;
    }

    this.dailyCounts.set(capKey, { date: today, count: count + 1 });

    // Conditional check (only after match passes)
    if (rule.conditional) {
      const conditionMet = await this.checkConditional(rule, event);
      if (!conditionMet) {
        // Undo cap increment — conditional failure means rule didn't fire
        this.dailyCounts.set(capKey, { date: today, count: count });
        return false;
      }
    }

    if (isShadow) {
      await this.logShadowDecision(match, event, 'Full shadow mode');
      await this.postShadowNote(match, event);
      return true;
    }

    await this.executeAction(match, event);
    return true;
  }

  private async wasAlreadyActioned(ticketKey: string): Promise<boolean> {
    try {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_decisions
         WHERE ticket_id = ?
           AND action LIKE 'auto_rule_%'
           AND JSON_VALUE(outcome, '$.success') = 'true'`,
        [ticketKey],
      );
      return (rows[0]?.cnt ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async evaluate(event: TicketEvent): Promise<AutoRuleMatch | null> {
    const overrides = await this.getOverrides();
    for (const rule of AUTO_RULES) {
      if (overrides[rule.id] === false) {
        console.debug(`[auto-rules] Skipping disabled rule '${rule.id}'`);
        continue;
      }
      const result = this.matchRule(rule, event);
      if (result.matched) return { rule, ticketKey: event.ticketKey, ticketId: event.ticketId, matchedFields: result.fields };
      if (result.nearMiss) {
        const matched = Object.entries(result.fields).filter(([, v]) => v).map(([k]) => k).join(', ');
        const missed = Object.entries(result.fields).filter(([, v]) => !v).map(([k]) => k).join(', ');
        console.debug(`[auto-rules] Near miss: '${rule.id}' on ${event.ticketKey} — ${matched} matched, ${missed} did not`);
      }
    }
    return null;
  }

  private matchRule(rule: AutoRule, event: TicketEvent): { matched: boolean; nearMiss: boolean; fields: Record<string, boolean> } {
    const ci = rule.caseInsensitive !== false;
    const mode = rule.matchMode ?? 'all';
    const fields: Record<string, boolean> = {};
    let checkedCount = 0;
    let passedCount = 0;

    if (rule.match.subject) {
      checkedCount++;
      const pass = this.matchOperator(rule.match.subject, event.summary, ci);
      fields.subject = pass;
      if (pass) passedCount++;
    }

    if (rule.match.description) {
      checkedCount++;
      const pass = this.matchOperator(rule.match.description, event.description ?? '', ci);
      fields.description = pass;
      if (pass) passedCount++;
    }

    if (rule.match.reporter_email) {
      checkedCount++;
      // Resolve reporter email from multiple possible sources (WP-49 fix)
      const email = event.reporterEmail
        ?? (event.fields?.reporter as { emailAddress?: string } | undefined)?.emailAddress
        ?? '';
      const pass = this.matchOperator(rule.match.reporter_email, email, ci);
      fields.reporter_email = pass;
      if (pass) passedCount++;
    }

    let matched: boolean;
    if (mode === 'any') {
      matched = checkedCount > 0 && passedCount > 0;
    } else {
      matched = checkedCount > 0 && passedCount === checkedCount;
    }

    const nearMiss = !matched && passedCount > 0 && passedCount < checkedCount;
    return { matched, nearMiss, fields };
  }

  private matchOperator(op: Record<string, unknown>, value: string, ci: boolean): boolean {
    const v = ci ? value.toLowerCase() : value;

    if ('equals' in op) {
      const target = ci ? String(op.equals).toLowerCase() : String(op.equals);
      return v === target;
    }
    if ('contains' in op) {
      const target = ci ? String(op.contains).toLowerCase() : String(op.contains);
      return v.includes(target);
    }
    if ('startsWith' in op) {
      const target = ci ? String(op.startsWith).toLowerCase() : String(op.startsWith);
      return v.startsWith(target);
    }
    if ('startsWithAny' in op) {
      const targets = (op.startsWithAny as string[]).map(s => ci ? s.toLowerCase() : s);
      return targets.some(t => v.startsWith(t));
    }
    if ('containsAll' in op) {
      const targets = (op.containsAll as string[]).map(s => ci ? s.toLowerCase() : s);
      return targets.every(t => v.includes(t));
    }
    if ('regex' in op) {
      const pattern = String(op.regex);
      const cacheKey = `${pattern}:${ci}`;
      let re = this.regexCache.get(cacheKey);
      if (!re) {
        re = new RegExp(pattern, ci ? 'i' : '');
        this.regexCache.set(cacheKey, re);
      }
      return re.test(value); // test against original value — regex has its own flags
    }
    return false;
  }

  private async checkConditional(rule: AutoRule, event: TicketEvent): Promise<boolean> {
    if (!rule.conditional) return true;

    if (rule.conditional.type === 'duplicate_open_ticket' && rule.conditional.sameSubject) {
      // Use JQL ~  (contains) instead of = (exact) for more reliable matching
      const summary = event.summary.replace(/[\\"\[\](){}]/g, ' ').trim();
      const jql = `project = NT AND statusCategory IN ("To Do", "In Progress") AND summary ~ "${summary}" AND key != ${event.ticketKey} ORDER BY created DESC`;
      try {
        const result = await this.jiraClient.searchJql(jql, ['summary'], 5);
        // Verify at least one result has the exact same summary (contains match may be broad)
        const exactMatch = result.issues.some((issue: { fields?: { summary?: string } }) => {
          const issueSummary = issue.fields?.summary ?? '';
          return issueSummary.toLowerCase().trim() === event.summary.toLowerCase().trim();
        });
        if (exactMatch) {
          console.log(`[auto-rules] Conditional '${rule.id}': found ${result.issues.length} sibling(s) for "${event.summary}" — condition met`);
        } else {
          console.log(`[auto-rules] Conditional '${rule.id}': JQL returned ${result.issues.length} result(s) but no exact summary match for "${event.summary}"`);
        }
        return exactMatch;
      } catch (err) {
        console.error(`[auto-rules] Conditional JQL FAILED for '${rule.id}' on ${event.ticketKey}: ${err instanceof Error ? err.message : err}`);
        return false;
      }
    }

    if (rule.conditional.type === 'pre_emption') {
      const maxRetries = rule.conditional.maxRetries ?? MAX_PRE_EMPTION_RETRIES;
      const indicators = rule.conditional.actionedIndicators ?? [];

      // Check retry exhaustion
      try {
        const rows = await query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM hybrid_action_log
           WHERE source_ticket_key = ? AND action_id = ? AND status = 'failed'`,
          [event.ticketKey, rule.action.type],
        );
        const failCount = rows[0]?.cnt ?? 0;
        if (failCount >= maxRetries) {
          console.warn(`[auto-rules] Pre-emption: '${rule.id}' on ${event.ticketKey} exhausted ${maxRetries} retries — skipping`);
          await executeAndGetId(
            `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, detail)
             VALUES (?, ?, 'failed_permanent', ?)`,
            [rule.action.type, event.ticketKey, `Exhausted ${maxRetries} retries — manual intervention needed`],
          );
          return false;
        }
      } catch (err) {
        console.warn(`[auto-rules] Pre-emption retry check failed for ${event.ticketKey}:`, err);
        // Continue — don't block on DB failure
      }

      // Check if already actioned (status resolved, or indicator comments found)
      try {
        const issue = await this.jiraClient.getIssue(event.ticketKey, ['status']);
        if (!issue) {
          console.log(`[auto-rules] Pre-emption: ${event.ticketKey} no longer exists — skipping`);
          return false;
        }
        const statusCat = (issue.fields?.status as { statusCategory?: { key?: string } })?.statusCategory?.key;
        if (statusCat === 'done') {
          console.log(`[auto-rules] Pre-emption: ${event.ticketKey} already resolved — skipping`);
          return false;
        }

        if (indicators.length > 0) {
          const comments = await this.jiraClient.getComments(event.ticketKey, 20);
          for (const c of comments) {
            const bodyText = typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
            const authorName = c.author?.displayName ?? '';
            for (const indicator of indicators) {
              if (bodyText.includes(indicator) || authorName.includes(indicator)) {
                console.log(`[auto-rules] Pre-emption: ${event.ticketKey} already actioned (found "${indicator}") — skipping`);
                return false;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[auto-rules] Pre-emption status check failed for ${event.ticketKey}:`, err instanceof Error ? err.message : err);
        // Continue — don't block on check failure
      }

      return true; // Not pre-empted, not exhausted — proceed
    }

    return false;
  }

  private async executeAction(match: AutoRuleMatch, event: TicketEvent): Promise<void> {
    const { rule, ticketKey } = match;
    const action = rule.action;

    const decisionId = await this.observer.logDecision({
      ticketId: event.ticketId,
      ticketKey,
      eventType: 'ticket_created',
      action: `auto_rule_${rule.id}` as any,
      confidence: 1.0,
      reasoning: `Auto-rule '${rule.id}' matched (deterministic, no LLM)`,
      approvalRequired: rule.requiresApproval ?? false,
      shadowMode: false,
      inputs: { summary: event.summary, matchedFields: match.matchedFields, ruleId: rule.id },
      output: { action_type: action.type, ...('resolution' in action ? { resolution: action.resolution } : {}), ...('tier' in action ? { tier: action.tier } : {}), ...('team' in action ? { team: action.team } : {}) },
    });

    try {
      if (action.type === 'close') {
        await this.handleClose(ticketKey, action as { type: 'close'; resolution: string; note: string }, rule);
      } else if (action.type === 'set_tier') {
        await this.handleSetTier(ticketKey, action as { type: 'set_tier'; tier: string; note: string }, rule);
      } else if (action.type === 'plugin_to_tpj') {
        await this.handlePluginToTpj(match, event);
      } else if (action.type === 'abuse_report') {
        await this.handleAbuseReport(match, event);
      } else if (action.type === 'assign') {
        await this.handleAssign(match, event, action as { type: 'assign'; team: string; comment: string; note?: string });
      } else if (action.type === 'tag') {
        await this.handleTag(ticketKey, action as { type: 'tag'; note: string; sub_category?: string }, rule);
      }

      await this.observer.logOutcome(decisionId, {
        success: true,
        action: `auto_rule_${rule.id}` as any,
        ticketKey,
        detail: `Auto-rule '${rule.id}' executed: ${action.type}`,
      });
      console.log(`[auto-rules] Executed '${rule.id}' on ${ticketKey} (${action.type})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.observer.logOutcome(decisionId, {
        success: false,
        action: `auto_rule_${rule.id}` as any,
        ticketKey,
        detail: `Auto-rule '${rule.id}' failed: ${msg}`,
        error: msg,
      });
      console.error(`[auto-rules] Failed '${rule.id}' on ${ticketKey}:`, msg);

      // Log failure to hybrid_action_log for retry tracking
      try {
        await executeAndGetId(
          `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, detail)
           VALUES (?, ?, 'failed', ?)`,
          [action.type, ticketKey, msg],
        );
      } catch { /* best effort */ }
    }
  }

  private async handleClose(
    ticketKey: string,
    action: { type: 'close'; resolution: string; note: string },
    rule: AutoRule,
  ): Promise<void> {
    try {
      const issue = await this.jiraClient.getIssue(ticketKey, ['status']);
      const statusCat = (issue?.fields?.status as { statusCategory?: { key?: string } })?.statusCategory?.key;
      if (statusCat === 'done') {
        console.log(`[auto-rules] ${ticketKey} already resolved — skipping close`);
        return;
      }
    } catch (err) {
      console.warn(`[auto-rules] Could not check status for ${ticketKey} — proceeding with close:`, err instanceof Error ? err.message : err);
    }

    // Post internal note before transition
    await this.jiraClient.addComment(
      ticketKey,
      `\u{1F916} Auto-actioned by NOVA rule '${rule.id}'. ${action.note}`,
      { internal: true },
    );

    // Assign to NOVA service account
    const novaAccountId = this.settings.get('nova_ai_jira_account_id');
    if (novaAccountId) {
      await this.jiraClient.updateFields(ticketKey, { assignee: { accountId: novaAccountId } });
    }

    // Validate transition is available before attempting
    try {
      const transResult = await this.jiraClient.getTransitionsWithFields(ticketKey);
      const available = (transResult as any)?.transitions as Array<{ id: string; name: string }> | undefined;
      if (available && !available.some(t => t.id === QUICK_RESOLVE_TRANSITION_ID)) {
        const availableNames = available.map(t => `${t.name} (${t.id})`).join(', ');
        throw new Error(`Transition ${QUICK_RESOLVE_TRANSITION_ID} not available for ${ticketKey}. Available: ${availableNames}`);
      }
    } catch (err) {
      if ((err as Error).message?.includes('not available for')) throw err;
      console.warn(`[auto-rules] Could not verify transitions for ${ticketKey}, proceeding:`, err instanceof Error ? err.message : err);
    }

    // Transition to resolved with all required fields in one call
    const { fields, comment } = buildResolveFields({
      tldr: action.note,
      resolution: action.resolution,
      comment: `Auto-actioned by NOVA rule '${rule.id}'. ${action.note}`,
    });
    await this.jiraClient.transitionIssue(ticketKey, QUICK_RESOLVE_TRANSITION_ID, { fields, comment });
  }

  private async handleSetTier(
    ticketKey: string,
    action: { type: 'set_tier'; tier: string; note: string; requestType?: string; priority?: string },
    rule: AutoRule,
  ): Promise<void> {
    const tierId = TIER_IDS[action.tier];
    if (!tierId) throw new Error(`Unknown tier '${action.tier}' — valid: ${Object.keys(TIER_IDS).join(', ')}`);

    const updatePayload: Record<string, unknown> = {
      [CF_CURRENT_TIER]: { id: tierId },
    };

    if (action.priority) {
      updatePayload.priority = { name: action.priority };
    }

    await this.jiraClient.updateFields(ticketKey, updatePayload);

    // Request type in JSM is set via a separate field (customfield_10010)
    if (action.requestType) {
      try {
        await this.jiraClient.updateFields(ticketKey, {
          issuetype: { name: action.requestType },
        });
      } catch (err) {
        console.warn(`[auto-rules] Failed to set request type '${action.requestType}' on ${ticketKey}:`, err instanceof Error ? err.message : err);
      }
    }

    await this.jiraClient.addComment(
      ticketKey,
      `\u{1F916} Auto-actioned by NOVA rule '${rule.id}'. ${action.note}`,
      { internal: true },
    );
  }

  private async handlePluginToTpj(match: AutoRuleMatch, event: TicketEvent): Promise<void> {
    const hybridMatch = {
      actionId: 'plugin_to_tpj' as const,
      ticketKey: match.ticketKey,
      ticketId: match.ticketId,
      summary: event.summary,
      description: event.description,
      parsedData: { ruleId: match.rule.id, detectionMethod: 'auto_rule' },
      requiresApproval: false,
    };
    const result = await this.pluginExecutor.execute(hybridMatch);
    if (!result.success) {
      throw new Error(result.error ? `${result.detail}: ${result.error}` : result.detail);
    }
  }

  private async handleAbuseReport(match: AutoRuleMatch, event: TicketEvent): Promise<void> {
    if (!this.abuseExecutor) {
      throw new Error('Abuse executor not available — cannot process abuse report');
    }

    // Parse fields from description
    const desc = event.description || '';
    const parsed: Record<string, unknown> = {};
    for (const [key, pattern] of Object.entries(ABUSE_FIELD_PATTERNS)) {
      const m = desc.match(pattern);
      if (m) parsed[key] = m[1].trim();
    }

    if (!parsed.contactId || !parsed.instanceId) {
      throw new Error(`Abuse report missing required fields (contactId=${parsed.contactId}, instanceId=${parsed.instanceId})`);
    }

    const hybridMatch = {
      actionId: 'abuse_report' as const,
      ticketKey: match.ticketKey,
      ticketId: match.ticketId,
      summary: event.summary,
      description: event.description,
      parsedData: parsed,
      requiresApproval: true,
    };
    const result = await this.abuseExecutor.executePhaseA(hybridMatch);
    if (!result.success) {
      throw new Error(result.error ? `${result.detail}: ${result.error}` : result.detail);
    }
  }

  private async handleAssign(
    match: AutoRuleMatch,
    event: TicketEvent,
    action: { type: 'assign'; team: string; comment: string; note?: string },
  ): Promise<void> {
    if (!this.assignmentEngine) {
      throw new Error('AssignmentEngine not available — cannot process assign action');
    }

    const { ticketKey } = match;
    const { team, comment, note } = action;

    const normalizedPool = team.toLowerCase().replace(/\s+/g, '') as any;
    const pool = ({ cc: 'cc', customercare: 'cc', t2: 't2', t3: 't2', tpj: 'tpj', digital: 'digital' } as Record<string, string>)[normalizedPool] ?? 'cc';

    const result = await this.assignmentEngine.assignToJira(ticketKey, pool as any);
    if (!result) {
      throw new Error(`No available agents in pool '${team}' — ticket ${ticketKey} left unassigned`);
    }

    console.log(`[auto-rules] Assigned ${ticketKey} to ${result.agent.display_name} (${team}, ${result.reason})`);

    await this.jiraClient.addComment(ticketKey, comment, { internal: false });

    if (note) {
      await this.jiraClient.addComment(
        ticketKey,
        `\u{1F916} Auto-actioned by NOVA rule '${match.rule.id}'. ${note}\nAssigned to: ${result.agent.display_name}`,
        { internal: true },
      );
    }
  }

  private async handleTag(
    ticketKey: string,
    action: { type: 'tag'; note: string; sub_category?: string },
    rule: AutoRule,
  ): Promise<void> {
    await this.jiraClient.addComment(
      ticketKey,
      `\u{1F916} Auto-tagged by NOVA rule '${rule.id}'. ${action.note}`,
      { internal: true },
    );

    if (action.sub_category) {
      try {
        await executeAndGetId(
          `INSERT INTO ticket_classifications (ticket_key, classification_type, category, sub_category, confidence, provider)
           VALUES (?, 'auto_rule', 'Email', ?, 1.0, 'deterministic')`,
          [ticketKey, action.sub_category],
        );
      } catch { /* best effort — table may not exist yet */ }
    }
  }

  private async logShadowDecision(match: AutoRuleMatch, event: TicketEvent, reason: string): Promise<void> {
    const { rule, ticketKey } = match;
    const decisionId = await this.observer.logDecision({
      ticketId: event.ticketId,
      ticketKey,
      eventType: 'ticket_created',
      action: `auto_rule_${rule.id}` as any,
      confidence: 1.0,
      reasoning: `Auto-rule '${rule.id}' matched — ${reason}`,
      approvalRequired: rule.requiresApproval ?? false,
      shadowMode: true,
      inputs: { summary: event.summary, matchedFields: match.matchedFields, ruleId: rule.id },
      output: { action_type: rule.action.type, shadow: true, reason },
    });
    await this.observer.logOutcome(decisionId, {
      success: true,
      action: `auto_rule_${rule.id}` as any,
      ticketKey,
      detail: `[SHADOW] Would execute auto-rule '${rule.id}': ${rule.action.type}. ${reason}`,
    });
  }

  private async postShadowNote(match: AutoRuleMatch, event: TicketEvent): Promise<void> {
    const { rule } = match;
    const a = rule.action;
    const actionDesc = a.type === 'close'
      ? `close with resolution '${(a as { resolution: string }).resolution}'`
      : a.type === 'set_tier'
        ? `set tier to '${(a as { tier: string }).tier}'`
        : a.type === 'plugin_to_tpj'
          ? `route via plugin_to_tpj`
          : a.type === 'assign'
            ? `assign to team '${(a as { team: string }).team}'`
            : `process abuse report`;
    try {
      await this.jiraClient.addComment(
        event.ticketKey,
        `[SHADOW MODE — observe only]\n\nAuto-rule '${rule.id}' matched. Would ${actionDesc}.`,
        { internal: true },
      );
    } catch { /* best effort */ }
  }

  private getDailyCap(rule: AutoRule): number {
    const override = this.settings.get(`agent_auto_rule_cap_${rule.id}`);
    if (override) {
      const parsed = parseInt(override, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return rule.dailyCap ?? DEFAULT_DAILY_CAP;
  }

  async getDailyStats(): Promise<Array<{ ruleId: string; count: number; cap: number }>> {
    const today = new Date().toISOString().slice(0, 10);
    return AUTO_RULES.map(rule => {
      const entry = this.dailyCounts.get(rule.id);
      return {
        ruleId: rule.id,
        count: (entry?.date === today ? entry.count : 0),
        cap: this.getDailyCap(rule),
      };
    });
  }

  getRules(): AutoRule[] {
    return AUTO_RULES;
  }

  async getRulesWithStats(): Promise<AutoRuleStatus[]> {
    const today = new Date().toISOString().slice(0, 10);

    const rows = await query<{ action: string; cnt: number; last_fired: string }>(
      `SELECT action, COUNT(*) as cnt, MAX(created_at) as last_fired
       FROM agent_decisions
       WHERE created_at >= CAST(? AS DATE)
         AND action LIKE 'auto_rule_%'
       GROUP BY action`,
      [today],
    );
    const statsMap = new Map(rows.map(r => [r.action, { count: r.cnt, lastFired: r.last_fired }]));
    const overrides = await this.getOverrides();

    return AUTO_RULES.map(rule => {
      const actionKey = `auto_rule_${rule.id}`;
      const stats = statsMap.get(actionKey);
      return {
        id: rule.id,
        match: rule.match,
        matchMode: rule.matchMode,
        action: rule.action,
        conditional: rule.conditional,
        dailyCap: this.getDailyCap(rule),
        requiresApproval: rule.requiresApproval,
        todayCount: stats?.count ?? 0,
        lastFired: stats?.lastFired ?? null,
        enabled: overrides[rule.id] !== false,
        matchSummary: this.summarizeMatch(rule),
      };
    });
  }

  private summarizeMatch(rule: AutoRule): string {
    const parts: string[] = [];
    const m = rule.match;
    if (m.subject) {
      const op = Object.keys(m.subject)[0];
      const val = Object.values(m.subject)[0];
      parts.push(`Subject ${op}: ${Array.isArray(val) ? val.join(', ') : val}`);
    }
    if (m.description) {
      const op = Object.keys(m.description)[0];
      const val = Object.values(m.description)[0];
      parts.push(`Description ${op}: ${Array.isArray(val) ? val.join(', ') : val}`);
    }
    if (m.reporter_email) {
      const op = Object.keys(m.reporter_email)[0];
      const val = Object.values(m.reporter_email)[0];
      parts.push(`Reporter ${op}: ${Array.isArray(val) ? val.join(', ') : val}`);
    }
    const joiner = rule.matchMode === 'any' ? ' OR ' : ' AND ';
    return parts.join(joiner);
  }
}

export interface AutoRuleStatus {
  id: string;
  match: object;
  matchMode: 'all' | 'any';
  action: object;
  conditional?: object;
  dailyCap: number;
  requiresApproval: boolean;
  todayCount: number;
  lastFired: string | null;
  enabled: boolean;
  matchSummary: string;
}
