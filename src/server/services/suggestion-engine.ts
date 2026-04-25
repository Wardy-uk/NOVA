import { query, execute, executeAndGetId } from './database.js';
import { createHash } from 'crypto';
import type { Guardrails } from './guardrails.js';
import type { AutonomyEngine } from './autonomy-engine.js';
import type { SettingsQueries } from '../db/settings-store.js';

// ── Types ──

export interface Suggestion {
  id: number;
  type: 'guardrail' | 'autonomy';
  suggestionKey: string;
  suggestion: SuggestionPayload;
  evidence: Record<string, unknown>;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
  updatedAt: string;
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
    status: row.status as 'pending' | 'applied' | 'dismissed',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Engine ──

export class SuggestionEngine {
  private guardrails: Guardrails;
  private autonomy: AutonomyEngine;
  private settings: SettingsQueries;

  constructor(guardrails: Guardrails, autonomy: AutonomyEngine, settings: SettingsQueries) {
    this.guardrails = guardrails;
    this.autonomy = autonomy;
    this.settings = settings;
  }

  private getGoLiveDays(): number {
    const goLiveStr = this.settings.get('agent_go_live_date') ?? '2026-04-23';
    const goLive = new Date(goLiveStr + 'T00:00:00Z');
    return Math.max(0, Math.floor((Date.now() - goLive.getTime()) / 86_400_000));
  }

  // ── CRUD ──

  async getSuggestions(type?: 'guardrail' | 'autonomy', status = 'pending'): Promise<Suggestion[]> {
    const conditions = ['status = ?'];
    const params: unknown[] = [status];
    if (type) { conditions.push('type = ?'); params.push(type); }
    const rows = await query<RawSuggestionRow>(
      `SELECT * FROM agent_suggestions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return rows.map(mapRow);
  }

  async dismissSuggestion(id: number): Promise<boolean> {
    const rows = await query<RawSuggestionRow>(
      `SELECT * FROM agent_suggestions WHERE id = ? AND status = 'pending'`, [id],
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
    const daysLive = this.getGoLiveDays();
    if (daysLive < 30) return; // too early to suggest disabling rules

    const lookbackDays = Math.min(daysLive, 90);
    const rules = this.guardrails.getRules().filter(r => r.enabled);
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
          description: `This guardrail hasn't triggered in ${lookbackDays} days (agent live since ${this.settings.get('agent_go_live_date') ?? '2026-04-23'}). Consider disabling it to reduce processing overhead.`,
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
        await insert('autonomy', `enable_${row.category.replace(/\s+/g, '_').toLowerCase()}`, {
          action: 'enable_autonomy',
          title: `Enable autonomy for "${row.category}"`,
          description: `${row.total} decisions with ${Math.round(acceptRate)}% accept rate and ${row.avg_conf.toFixed(2)} avg confidence over 90 days.`,
          category: row.category,
          suggestedConfidence: 0.85,
          suggestedAcceptRate: 90,
          suggestedMinDecisions: 50,
        }, {
          category: row.category,
          total: row.total,
          acceptRate: Math.round(acceptRate),
          avgConfidence: parseFloat(row.avg_conf.toFixed(2)),
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
      await insert('autonomy', `new_category_${row.category.replace(/\s+/g, '_').toLowerCase()}`, {
        action: 'new_category',
        title: `Create rule for "${row.category}"`,
        description: `${row.cnt} decisions in the last 30 days for this category but no autonomy rule exists. Consider creating one to track performance.`,
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

    const outcomeRows = await query<{ approved: number; declined: number }>(
      `SELECT
         SUM(CASE WHEN outcome LIKE '%Approved%' OR outcome LIKE '%success%' OR outcome LIKE '%auto%' THEN 1 ELSE 0 END) as approved,
         SUM(CASE WHEN outcome LIKE '%Declined%' OR outcome LIKE '%rejected%' OR outcome LIKE '%edited%' THEN 1 ELSE 0 END) as declined
       FROM agent_decisions
       WHERE JSON_VALUE(inputs, '$.classification.category') = ?
         AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [category, days],
    );

    return {
      actionBreakdown,
      exampleTickets,
      approvedCount: outcomeRows[0]?.approved ?? 0,
      declinedCount: outcomeRows[0]?.declined ?? 0,
    };
  }
}
