import { query, executeAndGetId, execute } from './database.js';
import type { AutonomyRule, AutonomyCheck, AgentDecision } from './agent-types.js';

export class AutonomyEngine {
  async checkAutonomy(decision: AgentDecision): Promise<AutonomyCheck> {
    const classification = decision.output.classification as
      | { category?: string; sub_category?: string }
      | undefined;

    if (!classification?.category) {
      return { allowed: false, reason: 'No classification category on decision' };
    }

    const category = classification.category;
    const subCategory = classification.sub_category ?? null;

    // Look up autonomy rule — try exact match first, then category-only
    const rule = await this.findRule(category, subCategory);
    if (!rule) {
      return { allowed: false, reason: `No autonomy rule for category "${category}"` };
    }

    if (!rule.enabled) {
      return { allowed: false, reason: `Autonomy disabled for category "${category}"`, rule };
    }

    // Check if the action is in the allowed set
    if (!rule.autonomousActions.includes(decision.action)) {
      return {
        allowed: false,
        reason: `Action "${decision.action}" not in autonomous allow-list for "${category}"`,
        rule,
      };
    }

    // Check confidence threshold
    if (decision.confidence < rule.minConfidence) {
      return {
        allowed: false,
        reason: `Confidence ${decision.confidence.toFixed(2)} below threshold ${rule.minConfidence}`,
        rule,
      };
    }

    // Check historical accept rate and decision count
    const stats = await this.getCategoryStats(category, subCategory);

    if (stats.totalDecisions < rule.minDecisions) {
      return {
        allowed: false,
        reason: `Only ${stats.totalDecisions} decisions for "${category}" (need ${rule.minDecisions})`,
        rule,
        actualDecisionCount: stats.totalDecisions,
        actualAcceptRate: stats.acceptRate,
      };
    }

    if (stats.acceptRate < rule.minAcceptRate) {
      return {
        allowed: false,
        reason: `Accept rate ${stats.acceptRate.toFixed(1)}% below threshold ${rule.minAcceptRate}%`,
        rule,
        actualDecisionCount: stats.totalDecisions,
        actualAcceptRate: stats.acceptRate,
      };
    }

    return {
      allowed: true,
      reason: `Autonomous execution approved: confidence=${decision.confidence.toFixed(2)}, accept_rate=${stats.acceptRate.toFixed(1)}%, decisions=${stats.totalDecisions}`,
      rule,
      actualAcceptRate: stats.acceptRate,
      actualDecisionCount: stats.totalDecisions,
    };
  }

  private async findRule(category: string, subCategory: string | null): Promise<AutonomyRule | null> {
    // Try exact match first (category + sub_category)
    if (subCategory) {
      const exact = await query<RawAutonomyRow>(
        `SELECT * FROM agent_autonomy WHERE category = ? AND sub_category = ?`,
        [category, subCategory],
      );
      if (exact.length > 0) return this.mapRow(exact[0]);
    }

    // Fall back to category-only rule
    const catOnly = await query<RawAutonomyRow>(
      `SELECT * FROM agent_autonomy WHERE category = ? AND sub_category IS NULL`,
      [category],
    );
    if (catOnly.length > 0) return this.mapRow(catOnly[0]);

    return null;
  }

  private async getCategoryStats(
    category: string,
    subCategory: string | null,
  ): Promise<{ totalDecisions: number; acceptRate: number }> {
    // Count decisions for this category from agent_decisions (last 90 days)
    const whereClause = subCategory
      ? `JSON_VALUE(inputs, '$.classification.category') = ? AND JSON_VALUE(inputs, '$.classification.sub_category') = ?`
      : `JSON_VALUE(inputs, '$.classification.category') = ?`;
    const params = subCategory ? [category, subCategory] : [category];

    const rows = await query<{ total: number; approved: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN outcome LIKE '%Approved%' OR outcome LIKE '%success%' THEN 1 ELSE 0 END) as approved
       FROM agent_decisions
       WHERE ${whereClause}
         AND created_at >= DATEADD(day, -90, GETUTCDATE())`,
      params,
    );

    const total = rows[0]?.total ?? 0;
    const approved = rows[0]?.approved ?? 0;

    return {
      totalDecisions: total,
      acceptRate: total > 0 ? (approved / total) * 100 : 0,
    };
  }

  // ── CRUD methods for admin API ──

  async getRules(): Promise<AutonomyRule[]> {
    const rows = await query<RawAutonomyRow>(
      `SELECT * FROM agent_autonomy ORDER BY category, sub_category`,
    );
    return rows.map(r => this.mapRow(r));
  }

  async getRule(id: number): Promise<AutonomyRule | null> {
    const rows = await query<RawAutonomyRow>(
      `SELECT * FROM agent_autonomy WHERE id = ?`, [id],
    );
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async createRule(rule: Omit<AutonomyRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO agent_autonomy
         (category, sub_category, enabled, min_confidence, min_accept_rate,
          min_qa_score, min_decisions, autonomous_actions, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.category,
        rule.subCategory ?? null,
        rule.enabled ? 1 : 0,
        rule.minConfidence,
        rule.minAcceptRate,
        rule.minQaScore,
        rule.minDecisions,
        JSON.stringify(rule.autonomousActions),
        rule.updatedBy ?? null,
      ],
    );
  }

  async updateRule(id: number, updates: Partial<AutonomyRule>): Promise<boolean> {
    const existing = await this.getRule(id);
    if (!existing) return false;

    const merged = { ...existing, ...updates };
    await execute(
      `UPDATE agent_autonomy SET
         category = ?, sub_category = ?, enabled = ?,
         min_confidence = ?, min_accept_rate = ?, min_qa_score = ?,
         min_decisions = ?, autonomous_actions = ?,
         updated_by = ?, updated_at = GETUTCDATE()
       WHERE id = ?`,
      [
        merged.category,
        merged.subCategory ?? null,
        merged.enabled ? 1 : 0,
        merged.minConfidence,
        merged.minAcceptRate,
        merged.minQaScore,
        merged.minDecisions,
        JSON.stringify(merged.autonomousActions),
        updates.updatedBy ?? existing.updatedBy ?? null,
        id,
      ],
    );
    return true;
  }

  async deleteRule(id: number): Promise<boolean> {
    const existing = await this.getRule(id);
    if (!existing) return false;
    await execute(`DELETE FROM agent_autonomy WHERE id = ?`, [id]);
    return true;
  }

  async getCategoryStatsPublic(category: string, subCategory?: string): Promise<{
    totalDecisions: number;
    acceptRate: number;
  }> {
    return this.getCategoryStats(category, subCategory ?? null);
  }

  async killSwitch(): Promise<void> {
    await execute(`UPDATE agent_autonomy SET enabled = 0, updated_at = GETUTCDATE()`);
  }

  private mapRow(row: RawAutonomyRow): AutonomyRule {
    let actions: string[] = ['draft_response'];
    try { actions = JSON.parse(row.autonomous_actions); } catch { /* use default */ }
    return {
      id: row.id,
      category: row.category,
      subCategory: row.sub_category,
      enabled: !!row.enabled,
      minConfidence: row.min_confidence,
      minAcceptRate: row.min_accept_rate,
      minQaScore: row.min_qa_score,
      minDecisions: row.min_decisions,
      autonomousActions: actions,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface RawAutonomyRow {
  id: number;
  category: string;
  sub_category: string | null;
  enabled: boolean | number;
  min_confidence: number;
  min_accept_rate: number;
  min_qa_score: number;
  min_decisions: number;
  autonomous_actions: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
