import { AUTO_RULES, type AutoRule } from '../config/auto-rules.js';
import type { TicketEvent, AgentShadowMode } from './agent-types.js';
import type { JiraRestClient } from './jira-client.js';
import type { PluginToTpjExecutor } from './plugin-to-tpj-executor.js';
import type { Observer } from './observer.js';
import type { SettingsQueries } from '../db/settings-store.js';

const QUICK_RESOLVE_TRANSITION_ID = '17';
const CF_RESOLUTION_TYPE = 'customfield_14494';
const CF_CURRENT_TIER = 'customfield_12981';

const TIER_IDS: Record<string, string> = {
  'Customer Care': '13061',
  'Tier 2': '13062',
  'Tier 3': '13063',
  'Development': '13064',
  'Production': '13700',
};

const DEFAULT_DAILY_CAP = 50;

export interface AutoRuleMatch {
  rule: AutoRule;
  ticketKey: string;
  ticketId: string;
  matchedFields: Record<string, boolean>;
}

export class AutoRulesEngine {
  private dailyCounts = new Map<string, { date: string; count: number }>();

  constructor(
    private jiraClient: JiraRestClient,
    private pluginExecutor: PluginToTpjExecutor,
    private observer: Observer,
    private settings: SettingsQueries,
  ) {}

  async evaluateAndExecute(
    event: TicketEvent,
    shadowMode: AgentShadowMode,
  ): Promise<boolean> {
    if (event.eventType !== 'ticket_created') return false;

    const match = this.evaluate(event);
    if (!match) return false;

    const { rule } = match;
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

  private evaluate(event: TicketEvent): AutoRuleMatch | null {
    for (const rule of AUTO_RULES) {
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
      const email = event.reporterEmail ?? '';
      const pass = this.matchOperator(rule.match.reporter_email, email, ci);
      fields.reporter_email = pass;
      if (pass) passedCount++;
    }

    const matched = checkedCount > 0 && passedCount === checkedCount;
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
    return false;
  }

  private async checkConditional(rule: AutoRule, event: TicketEvent): Promise<boolean> {
    if (!rule.conditional) return true;

    if (rule.conditional.type === 'duplicate_open_ticket' && rule.conditional.sameSubject) {
      const escapedSummary = event.summary.replace(/"/g, '\\"');
      const jql = `project = NT AND statusCategory IN ("To Do", "In Progress") AND summary = "${escapedSummary}" AND key != ${event.ticketKey}`;
      try {
        const result = await this.jiraClient.searchJql(jql, ['summary'], 5);
        return result.issues.length > 0;
      } catch (err) {
        console.warn(`[auto-rules] Conditional JQL failed for '${rule.id}' on ${event.ticketKey}:`, err instanceof Error ? err.message : err);
        return false;
      }
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
      approvalRequired: false,
      shadowMode: false,
      inputs: { summary: event.summary, matchedFields: match.matchedFields, ruleId: rule.id },
      output: { action_type: action.type, ...('resolution' in action ? { resolution: action.resolution } : {}), ...('tier' in action ? { tier: action.tier } : {}) },
    });

    try {
      if (action.type === 'close') {
        await this.handleClose(ticketKey, action as { type: 'close'; resolution: string; note: string }, rule);
      } else if (action.type === 'set_tier') {
        await this.handleSetTier(ticketKey, action as { type: 'set_tier'; tier: string; note: string }, rule);
      } else if (action.type === 'plugin_to_tpj') {
        await this.handlePluginToTpj(match, event);
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
    }
  }

  private async handleClose(
    ticketKey: string,
    action: { type: 'close'; resolution: string; note: string },
    rule: AutoRule,
  ): Promise<void> {
    // Set resolution type before transitioning
    await this.jiraClient.updateFields(ticketKey, {
      [CF_RESOLUTION_TYPE]: { value: action.resolution },
    });

    // Post internal note
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

    // Transition to resolved
    await this.jiraClient.transitionIssue(ticketKey, QUICK_RESOLVE_TRANSITION_ID);
  }

  private async handleSetTier(
    ticketKey: string,
    action: { type: 'set_tier'; tier: string; note: string },
    rule: AutoRule,
  ): Promise<void> {
    const tierId = TIER_IDS[action.tier];
    if (!tierId) throw new Error(`Unknown tier '${action.tier}' — valid: ${Object.keys(TIER_IDS).join(', ')}`);

    await this.jiraClient.updateFields(ticketKey, {
      [CF_CURRENT_TIER]: { id: tierId },
    });

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
    if (!result.success) throw new Error(result.detail);
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
      approvalRequired: false,
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
        : `route via plugin_to_tpj`;
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
}
