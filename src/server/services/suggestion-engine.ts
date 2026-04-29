import { query, execute, executeAndGetId } from './database.js';
import { createHash } from 'crypto';
import type { Guardrails } from './guardrails.js';
import type { AutonomyEngine } from './autonomy-engine.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import { loadPrompt } from './prompt-loader.js';
import { z } from 'zod';

// ── Types ──

export type Verdict = 'apply' | 'wait' | 'skip';

export interface VerdictResult {
  verdict: Verdict;
  headline: string;
  reason: string;
}

export interface Suggestion {
  id: number;
  type: 'guardrail' | 'autonomy';
  suggestionKey: string;
  suggestion: SuggestionPayload;
  evidence: Record<string, unknown>;
  status: 'pending' | 'applied' | 'dismissed' | 'snoozed';
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  verdict?: VerdictResult;
  bodyText?: string;
}

export interface SuggestionPayload {
  action: string;
  title: string;
  description: string;
  [key: string]: unknown;
}

interface RawSuggestionRow {
  id: number;
  type: string;
  suggestion_key: string;
  suggestion_json: string;
  evidence_json: string | null;
  status: string;
  dismissed_hash: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

// ── Helpers ──

function hashEvidence(evidence: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 16);
}

function mapRow(row: RawSuggestionRow): Suggestion {
  return {
    id: row.id,
    type: row.type as 'guardrail' | 'autonomy',
    suggestionKey: row.suggestion_key,
    suggestion: JSON.parse(row.suggestion_json),
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : {},
    status: row.status as Suggestion['status'],
    snoozedUntil: row.snoozed_until ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Verdict Logic ──

export function computeVerdict(evidence: Record<string, unknown>): VerdictResult {
  const approvalRate = Number(evidence.approvalRate ?? 0);
  const declinedCount = Number(evidence.declinedCount ?? 0);
  const total = Number(evidence.decisionCount ?? evidence.total ?? 0);
  const avgConfidence = Number(evidence.avgConfidence ?? 0) / 100;
  const minConfidence = Number(evidence.minConfidence ?? 0) / 100;

  // 🔴 Skip: any decline in data, OR confidence < 0.75, OR fewer than 15 decisions
  if (declinedCount > 0) {
    return {
      verdict: 'skip',
      headline: 'Don’t auto-approve this yet',
      reason: `${declinedCount} decision${declinedCount > 1 ? 's were' : ' was'} declined — the agent isn't reliable enough here yet.`,
    };
  }
  if (avgConfidence < 0.75) {
    return {
      verdict: 'skip',
      headline: 'Don’t auto-approve this yet',
      reason: `Average confidence is ${Math.round(avgConfidence * 100)}%, well below the 75% floor.`,
    };
  }
  if (total < 15) {
    return {
      verdict: 'skip',
      headline: 'Don’t auto-approve this yet',
      reason: `Only ${total} decisions so far — need at least 15 before a pattern is meaningful.`,
    };
  }

  // 🟢 Apply: approval rate ≥95%, decisions ≥50, confidence ≥0.85
  if (approvalRate >= 95 && total >= 50 && avgConfidence >= 0.85) {
    return {
      verdict: 'apply',
      headline: 'Safe to switch on',
      reason: `${approvalRate}% approval across ${total} decisions with strong confidence.`,
    };
  }

  // 🟡 Wait: everything else in between
  const waitReasons: string[] = [];
  if (approvalRate < 95) waitReasons.push(`approval rate is ${approvalRate}% (need 95%)`);
  if (total < 50) waitReasons.push(`only ${total} decisions (need 50)`);
  if (avgConfidence < 0.85) waitReasons.push(`avg confidence is ${Math.round(avgConfidence * 100)}% (need 85%)`);

  return {
    verdict: 'wait',
    headline: 'Probably right, not enough data',
    reason: waitReasons.length > 0
      ? `Close, but ${waitReasons.join(' and ')}.`
      : 'Getting there — give it another couple of weeks.',
  };
}

// ── Engine ──

export class SuggestionEngine {
  private guardrails: Guardrails;
  private autonomy: AutonomyEngine;
  private settings: SettingsQueries;
  private llm: LlmService | null;
  private bodyTextCache = new Map<string, { text: string; hash: string }>();

  constructor(guardrails: Guardrails, autonomy: AutonomyEngine, settings: SettingsQueries, llm?: LlmService) {
    this.guardrails = guardrails;
    this.autonomy = autonomy;
    this.settings = settings;
    this.llm = llm ?? null;
  }

  private goLiveDaysCache: number | null = null;

  private getGoLiveDays(): number {
    if (this.goLiveDaysCache !== null) return this.goLiveDaysCache;
    const goLiveStr = this.settings.get('agent_go_live_date') ?? '2026-04-23';
    const goLive = new Date(goLiveStr + 'T00:00:00Z');
    this.goLiveDaysCache = Math.max(0, Math.floor((Date.now() - goLive.getTime()) / 86_400_000));
    return this.goLiveDaysCache;
  }

  private async getActualDaysActive(): Promise<number> {
    const rows = await query<{ first_decision: string | null }>(
      `SELECT MIN(created_at) as first_decision FROM agent_decisions`,
    );
    if (!rows[0]?.first_decision) return 0;
    const first = new Date(rows[0].first_decision);
    return Math.max(0, Math.floor((Date.now() - first.getTime()) / 86_400_000));
  }

  // ── Body text generation ──

  private async generateBodyText(
    evidence: Record<string, unknown>,
    verdict: VerdictResult,
  ): Promise<string> {
    if (!this.llm) return '';

    const evHash = hashEvidence(evidence);
    const cached = this.bodyTextCache.get(evHash);
    if (cached && cached.hash === evHash) return cached.text;

    const actionBreakdown = evidence.actionBreakdown as Record<string, number> | undefined;
    const actions = actionBreakdown ? Object.entries(actionBreakdown).sort((a, b) => b[1] - a[1]).map(([a, c]) => `${a} (${c})`).join(', ') : 'unknown';

    try {
      const systemPrompt = loadPrompt('autonomy-recommendation', {
        category: String(evidence.category ?? 'unknown'),
        actions,
        verdict: verdict.verdict,
        headline: verdict.headline,
        approved: String(evidence.approvedCount ?? 0),
        declined: String(evidence.declinedCount ?? 0),
        total: String(evidence.decisionCount ?? evidence.total ?? 0),
        days: String(evidence.days ?? 30),
        approvalRate: String(evidence.approvalRate ?? 0),
        avgConfidence: String(evidence.avgConfidence ?? 0),
        minConfidence: String(evidence.minConfidence ?? 0),
        weeklySavings: String(evidence.estimatedWeeklySavings ?? 0),
      });

      const result = await this.llm.call(
        systemPrompt,
        'Generate the two-paragraph recommendation.',
        z.object({ text: z.string() }),
        { tier: 'cheap', callType: 'autonomy_recommendation', maxTokens: 300, temperature: 0.4 },
      );
      const text = result.data.text;
      this.bodyTextCache.set(evHash, { text, hash: evHash });
      return text;
    } catch (err) {
      console.warn('[suggestion-engine] Body text generation failed, using fallback:', err instanceof Error ? err.message : err);
      return '';
    }
  }

  async enrichSuggestions(suggestions: Suggestion[]): Promise<Suggestion[]> {
    return Promise.all(suggestions.map(async (s) => {
      if (s.type !== 'autonomy') return s;
      const verdict = computeVerdict(s.evidence);
      const bodyText = await this.generateBodyText(s.evidence, verdict);
      return { ...s, verdict, bodyText };
    }));
  }

  // ── CRUD ──

  async getSuggestions(type?: 'guardrail' | 'autonomy', status = 'pending'): Promise<Suggestion[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (type) { conditions.push('type = ?'); params.push(type); }
    // Show pending items + snoozed items whose re-check date has passed
    conditions.push("(status = ? OR (status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= GETUTCDATE()))");
    params.push(status);
    const rows = await query<RawSuggestionRow>(
      `SELECT * FROM agent_suggestions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return rows.map(mapRow);
  }

  async snoozeSuggestion(id: number, days = 14): Promise<boolean> {
    const rows = await query<RawSuggestionRow>(
      `SELECT * FROM agent_suggestions WHERE id = ? AND status IN ('pending', 'snoozed')`, [id],
    );
    if (rows.length === 0) return false;
    await execute(
      `UPDATE agent_suggestions SET status = 'snoozed', snoozed_until = DATEADD(day, ?, GETUTCDATE()), updated_at = GETUTCDATE() WHERE id = ?`,
      [days, id],
    );
    return true;
  }

  async dismissSuggestion(id: number): Promise<boolean> {
    const rows = await query<RawSuggestionRow>(
      `SELECT * FROM agent_suggestions WHERE id = ? AND status IN ('pending', 'snoozed')`, [id],
    );
    if (rows.length === 0) return false;
    const row = rows[0];
    const hash = row.evidence_json ? hashEvidence(JSON.parse(row.evidence_json)) : null;
    await execute(
      `UPDATE agent_suggestions SET status = 'dismissed', dismissed_hash = ?, updated_at = GETUTCDATE() WHERE id = ?`,
      [hash, id],
    );
    return true;
  }

  async applySuggestion(id: number): Promise<Suggestion | null> {
    const rows = await query<RawSuggestionRow>(
      `SELECT * FROM agent_suggestions WHERE id = ? AND status = 'pending'`, [id],
    );
    if (rows.length === 0) return null;
    await execute(
      `UPDATE agent_suggestions SET status = 'applied', updated_at = GETUTCDATE() WHERE id = ?`, [id],
    );
    return mapRow(rows[0]);
  }

  // ── Analysis ──

  async generateSuggestions(): Promise<number> {
    let created = 0;

    const dismissed = await query<{ suggestion_key: string; dismissed_hash: string | null }>(
      `SELECT suggestion_key, dismissed_hash FROM agent_suggestions WHERE status = 'dismissed'`,
    );
    const dismissedMap = new Map(dismissed.map(d => [d.suggestion_key, d.dismissed_hash]));

    const pending = await query<{ suggestion_key: string }>(
      `SELECT suggestion_key FROM agent_suggestions WHERE status = 'pending'`,
    );
    const pendingKeys = new Set(pending.map(p => p.suggestion_key));

    const insert = async (
      type: 'guardrail' | 'autonomy',
      key: string,
      suggestion: SuggestionPayload,
      evidence: Record<string, unknown>,
    ): Promise<void> => {
      if (pendingKeys.has(key)) return;
      const hash = hashEvidence(evidence);
      if (dismissedMap.get(key) === hash) return;
      await executeAndGetId(
        `INSERT INTO agent_suggestions (type, suggestion_key, suggestion_json, evidence_json) VALUES (?, ?, ?, ?)`,
        [type, key, JSON.stringify(suggestion), JSON.stringify(evidence)],
      );
      created++;
    };

    await Promise.all([
      this.analyzeDisableRule(insert),
      this.analyzeOverriddenRules(insert),
      this.analyzeDeclinedPatterns(insert),
      this.analyzeEnableAutonomy(insert),
      this.analyzeThresholds(insert),
      this.analyzeNewCategory(insert),
    ]);

    return created;
  }

  // ── Guardrail: rule hasn't triggered since go-live → suggest disable (only after 30+ days live) ──

  private async analyzeDisableRule(
    insert: (t: 'guardrail', k: string, s: SuggestionPayload, e: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const daysActive = await this.getActualDaysActive();
    if (daysActive < 30) return; // too early to suggest disabling rules

    const lookbackDays = Math.min(daysActive, 90);
    const rules = this.guardrails.getRules().filter(r => r.enabled && !r.critical);
    for (const rule of rules) {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_decisions
         WHERE outcome LIKE ? AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
        [`%${rule.id}%`, lookbackDays],
      );
      if ((rows[0]?.cnt ?? 0) === 0) {
        await insert('guardrail', `disable_${rule.id}`, {
          action: 'disable_rule',
          title: `Disable "${rule.id}"`,
          description: `This guardrail hasn't triggered in ${lookbackDays} days since the agent's first decision. Consider disabling it to reduce processing overhead.`,
          ruleId: rule.id,
        }, { ruleId: rule.id, triggerCount: 0, days: lookbackDays });
      }
    }
  }

  // ── Guardrail: rule triggers but gets overridden → suggest loosen/amend ──

  private async analyzeOverriddenRules(
    insert: (t: 'guardrail', k: string, s: SuggestionPayload, e: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const rules = this.guardrails.getRules().filter(r => r.enabled);
    for (const rule of rules) {
      const rows = await query<{ blocked: number; overridden: number }>(
        `SELECT
           SUM(CASE WHEN outcome LIKE ? THEN 1 ELSE 0 END) as blocked,
           SUM(CASE WHEN outcome LIKE ? AND (outcome LIKE '%override%' OR outcome LIKE '%approved%') THEN 1 ELSE 0 END) as overridden
         FROM agent_decisions
         WHERE created_at >= DATEADD(day, -30, GETUTCDATE())
           AND outcome LIKE ?`,
        [`%${rule.id}%`, `%${rule.id}%`, `%${rule.id}%`],
      );
      const blocked = rows[0]?.blocked ?? 0;
      const overridden = rows[0]?.overridden ?? 0;
      if (blocked >= 5 && overridden / blocked > 0.2) {
        const rate = Math.round((overridden / blocked) * 100);
        await insert('guardrail', `loosen_${rule.id}`, {
          action: 'loosen_rule',
          title: `Loosen "${rule.id}"`,
          description: `${rate}% of blocks by this rule (${overridden}/${blocked}) were manually overridden in the last 30 days — likely too aggressive.`,
          ruleId: rule.id,
        }, { ruleId: rule.id, blocked, overridden, rate, days: 30 });
      }
    }
  }

  // ── Guardrail: declined decisions with common patterns → suggest new rule ──

  private async analyzeDeclinedPatterns(
    insert: (t: 'guardrail', k: string, s: SuggestionPayload, e: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const rows = await query<{ category: string; cnt: number; sample_tickets: string }>(
      `SELECT
         ISNULL(JSON_VALUE(inputs, '$.classification.category'), 'uncategorised') as category,
         COUNT(*) as cnt,
         STRING_AGG(ticket_id, ',') as sample_tickets
       FROM agent_decisions
       WHERE created_at >= DATEADD(day, -30, GETUTCDATE())
         AND (outcome LIKE '%Declined%' OR outcome LIKE '%rejected%' OR outcome LIKE '%edited%')
         AND action IN ('draft_response', 'respond', 'comment')
       GROUP BY JSON_VALUE(inputs, '$.classification.category')
       HAVING COUNT(*) >= 5
       ORDER BY cnt DESC`,
    );
    for (const row of rows) {
      const tickets = row.sample_tickets?.split(',').slice(0, 5) ?? [];
      await insert('guardrail', `new_rule_${row.category.replace(/\s+/g, '_').toLowerCase()}`, {
        action: 'new_rule',
        title: `Review declined responses in "${row.category}"`,
        description: `${row.cnt} draft responses in this category were declined or edited in the last 30 days. Review for common patterns that could be caught by a guardrail.`,
        category: row.category,
      }, { category: row.category, declinedCount: row.cnt, sampleTickets: tickets });
    }
  }

  // ── Autonomy: category with high accept rate → suggest enabling ──

  private async analyzeEnableAutonomy(
    insert: (t: 'autonomy', k: string, s: SuggestionPayload, e: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const existingRules = await this.autonomy.getRules();
    const existingCategories = new Set(existingRules.map(r => r.category));

    const rows = await query<{ category: string; total: number; approved: number; avg_conf: number }>(
      `SELECT
         JSON_VALUE(inputs, '$.classification.category') as category,
         COUNT(*) as total,
         SUM(CASE WHEN outcome LIKE '%Approved%' OR outcome LIKE '%success%' THEN 1 ELSE 0 END) as approved,
         AVG(confidence) as avg_conf
       FROM agent_decisions
       WHERE created_at >= DATEADD(day, -90, GETUTCDATE())
         AND JSON_VALUE(inputs, '$.classification.category') IS NOT NULL
       GROUP BY JSON_VALUE(inputs, '$.classification.category')
       HAVING COUNT(*) >= 50`,
    );

    for (const row of rows) {
      if (existingCategories.has(row.category)) continue;
      const acceptRate = row.total > 0 ? (row.approved / row.total) * 100 : 0;
      if (acceptRate >= 90 && row.avg_conf >= 0.85) {
        const detail = await this.getCategoryDetail(row.category, 90);
        const riskNote = detail.riskFlag ? ` ⚠️ ${detail.riskFlag}.` : '';
        await insert('autonomy', `enable_${row.category.replace(/\s+/g, '_').toLowerCase()}`, {
          action: 'enable_autonomy',
          title: `Enable autonomy for "${row.category}"`,
          description: `${detail.proposedRule}. ${detail.approvedCount} approved, ${detail.declinedCount} declined (${detail.approvalRate}% approval). Avg confidence: ${detail.avgConfidence}%, lowest: ${detail.minConfidence}%. Would save ~${detail.estimatedWeeklySavings} approvals/week.${riskNote}`,
          category: row.category,
          suggestedConfidence: 0.85,
          suggestedAcceptRate: 90,
          suggestedMinDecisions: 50,
        }, {
          category: row.category,
          total: row.total,
          acceptRate: Math.round(acceptRate),
          ...detail,
        });
      }
    }
  }

  // ── Autonomy: threshold adjustments ──

  private async analyzeThresholds(
    insert: (t: 'autonomy', k: string, s: SuggestionPayload, e: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const rules = await this.autonomy.getRules();
    for (const rule of rules.filter(r => r.enabled)) {
      const rows = await query<{ total: number; approved: number; declined: number }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN outcome LIKE '%Approved%' OR outcome LIKE '%success%' OR outcome LIKE '%auto%' THEN 1 ELSE 0 END) as approved,
           SUM(CASE WHEN outcome LIKE '%Declined%' OR outcome LIKE '%rejected%' THEN 1 ELSE 0 END) as declined
         FROM agent_decisions
         WHERE JSON_VALUE(inputs, '$.classification.category') = ?
           AND created_at >= DATEADD(day, -30, GETUTCDATE())`,
        [rule.category],
      );
      const total = rows[0]?.total ?? 0;
      const declined = rows[0]?.declined ?? 0;
      const approved = rows[0]?.approved ?? 0;
      if (total < 10) continue;

      const declineRate = declined / total;
      const acceptRate = total > 0 ? (approved / total) * 100 : 0;

      if (declineRate > 0.1) {
        await insert('autonomy', `raise_${rule.id}`, {
          action: 'raise_threshold',
          title: `Raise threshold for "${rule.category}"`,
          description: `${Math.round(declineRate * 100)}% of autonomous decisions were declined in the last 30 days (${declined}/${total}). Consider raising the confidence threshold from ${rule.minConfidence} to ${Math.min(0.95, rule.minConfidence + 0.05).toFixed(2)}.`,
          ruleId: rule.id,
          suggestedConfidence: Math.min(0.95, rule.minConfidence + 0.05),
        }, { ruleId: rule.id, total, declined, declineRate: Math.round(declineRate * 100) });
      } else if (acceptRate === 100 && total >= 30 && rule.minConfidence > 0.8) {
        await insert('autonomy', `lower_${rule.id}`, {
          action: 'lower_threshold',
          title: `Lower threshold for "${rule.category}"`,
          description: `100% accept rate over ${total} decisions in the last 30 days. Current threshold ${rule.minConfidence} could safely drop to ${Math.max(0.7, rule.minConfidence - 0.05).toFixed(2)}.`,
          ruleId: rule.id,
          suggestedConfidence: Math.max(0.7, rule.minConfidence - 0.05),
        }, { ruleId: rule.id, total, acceptRate: 100 });
      }
    }
  }

  // ── Autonomy: frequent category with no rule ──

  private async analyzeNewCategory(
    insert: (t: 'autonomy', k: string, s: SuggestionPayload, e: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const existingRules = await this.autonomy.getRules();
    const existingCategories = new Set(existingRules.map(r => r.category));

    const rows = await query<{ category: string; cnt: number }>(
      `SELECT
         JSON_VALUE(inputs, '$.classification.category') as category,
         COUNT(*) as cnt
       FROM agent_decisions
       WHERE created_at >= DATEADD(day, -30, GETUTCDATE())
         AND JSON_VALUE(inputs, '$.classification.category') IS NOT NULL
       GROUP BY JSON_VALUE(inputs, '$.classification.category')
       HAVING COUNT(*) >= 20
       ORDER BY cnt DESC`,
    );

    for (const row of rows) {
      if (existingCategories.has(row.category)) continue;
      const detail = await this.getCategoryDetail(row.category, 30);
      const riskNote = detail.riskFlag ? ` ⚠️ ${detail.riskFlag}.` : '';
      await insert('autonomy', `new_category_${row.category.replace(/\s+/g, '_').toLowerCase()}`, {
        action: 'new_category',
        title: `Create rule for "${row.category}"`,
        description: `${detail.proposedRule}. ${detail.approvedCount} approved, ${detail.declinedCount} declined (${detail.approvalRate}% approval). Avg confidence: ${detail.avgConfidence}%, lowest: ${detail.minConfidence}%. Would save ~${detail.estimatedWeeklySavings} approvals/week.${riskNote}`,
        category: row.category,
      }, { category: row.category, decisionCount: row.cnt, days: 30, ...detail });
    }
  }

  // ── Shared: fetch action breakdown + example tickets for a category ──

  private async getCategoryDetail(category: string, days: number): Promise<{
    actionBreakdown: Record<string, number>;
    exampleTickets: string[];
    approvedCount: number;
    declinedCount: number;
    approvalRate: number;
    avgConfidence: number;
    minConfidence: number;
    riskFlag: string | null;
    estimatedWeeklySavings: number;
    proposedRule: string;
  }> {
    const actionRows = await query<{ action: string; cnt: number }>(
      `SELECT action, COUNT(*) as cnt
       FROM agent_decisions
       WHERE JSON_VALUE(inputs, '$.classification.category') = ?
         AND created_at >= DATEADD(day, -?, GETUTCDATE())
       GROUP BY action
       ORDER BY cnt DESC`,
      [category, days],
    );
    const actionBreakdown: Record<string, number> = {};
    for (const r of actionRows) actionBreakdown[r.action] = r.cnt;

    const ticketRows = await query<{ ticket_id: string }>(
      `SELECT TOP 5 ticket_id
       FROM agent_decisions
       WHERE JSON_VALUE(inputs, '$.classification.category') = ?
         AND created_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY created_at DESC`,
      [category, days],
    );
    const exampleTickets = ticketRows.map(r => r.ticket_id);

    const statsRows = await query<{ approved: number; declined: number; avg_conf: number; min_conf: number; total: number }>(
      `SELECT
         SUM(CASE WHEN outcome LIKE '%Approved%' OR outcome LIKE '%success%' OR outcome LIKE '%auto%' THEN 1 ELSE 0 END) as approved,
         SUM(CASE WHEN outcome LIKE '%Declined%' OR outcome LIKE '%rejected%' OR outcome LIKE '%edited%' THEN 1 ELSE 0 END) as declined,
         AVG(confidence) as avg_conf,
         MIN(confidence) as min_conf,
         COUNT(*) as total
       FROM agent_decisions
       WHERE JSON_VALUE(inputs, '$.classification.category') = ?
         AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [category, days],
    );

    const approved = statsRows[0]?.approved ?? 0;
    const declined = statsRows[0]?.declined ?? 0;
    const total = statsRows[0]?.total ?? 0;
    const avgConf = statsRows[0]?.avg_conf ?? 0;
    const minConf = statsRows[0]?.min_conf ?? 0;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;
    const weeklyRate = days > 0 ? Math.round((total / days) * 7) : 0;

    const topAction = Object.entries(actionBreakdown).sort((a, b) => b[1] - a[1])[0];
    const proposedRule = topAction
      ? `Auto-approve ${topAction[0]} for ${category} tickets when confidence ≥ ${Math.max(85, Math.round(avgConf * 100))}%`
      : `Enable autonomy for ${category}`;

    let riskFlag: string | null = null;
    if (declined > 0) riskFlag = `${declined} decision(s) were declined — review before enabling`;
    else if (approvalRate < 95 && total > 0) riskFlag = `Approval rate ${approvalRate}% is below 95% — suggest caution`;

    return {
      actionBreakdown,
      exampleTickets,
      approvedCount: approved,
      declinedCount: declined,
      approvalRate,
      avgConfidence: Math.round(avgConf * 100),
      minConfidence: Math.round(minConf * 100),
      riskFlag,
      estimatedWeeklySavings: weeklyRate,
      proposedRule,
    };
  }
}
