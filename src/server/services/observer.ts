import { executeAndGetId, query } from './database.js';
import type { AgentDecision, ActionResult } from './agent-types.js';

export class Observer {
  async logDecision(decision: AgentDecision): Promise<number> {
    return executeAndGetId(
      `INSERT INTO agent_decisions
         (ticket_id, event_type, inputs, reasoning, output, action, confidence,
          provider, model, approval_required, shadow_mode, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        decision.ticketKey,
        decision.eventType,
        JSON.stringify(decision.inputs),
        decision.reasoning,
        JSON.stringify(decision.output),
        decision.action,
        decision.confidence,
        decision.provider ?? null,
        decision.model ?? null,
        decision.approvalRequired ? 1 : 0,
        decision.shadowMode ? 1 : 0,
        0,
      ],
    );
  }

  async logOutcome(decisionId: number, result: ActionResult): Promise<void> {
    await executeAndGetId(
      `UPDATE agent_decisions
       SET outcome = ?, resolved_at = GETUTCDATE()
       WHERE id = ?`,
      [
        JSON.stringify({ success: result.success, detail: result.detail, error: result.error }),
        decisionId,
      ],
    );
  }

  async getDecisions(limit = 50, offset = 0): Promise<unknown[]> {
    return query(
      `SELECT * FROM agent_decisions ORDER BY created_at DESC
       OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      [offset, limit],
    );
  }

  async getDecisionById(id: number): Promise<unknown | undefined> {
    const rows = await query(`SELECT * FROM agent_decisions WHERE id = ?`, [id]);
    return rows[0];
  }

  async getDecisionsByTicket(ticketKey: string, limit = 20): Promise<unknown[]> {
    return query(
      `SELECT TOP(?) * FROM agent_decisions WHERE ticket_id = ? ORDER BY created_at DESC`,
      [limit, ticketKey],
    );
  }

  async getStats(): Promise<{
    today: Record<string, number>;
    byAction: Record<string, number>;
    byConfidence: { high: number; medium: number; low: number };
    shadow: number;
    total: number;
  }> {
    const todayRows = await query<{ action: string; cnt: number }>(
      `SELECT action, COUNT(*) as cnt FROM agent_decisions
       WHERE created_at >= CAST(GETUTCDATE() AS DATE)
       GROUP BY action`,
    );
    const byAction: Record<string, number> = {};
    let total = 0;
    for (const r of todayRows) {
      byAction[r.action] = r.cnt;
      total += r.cnt;
    }

    const confRows = await query<{ band: string; cnt: number }>(
      `SELECT
         CASE WHEN confidence >= 0.8 THEN 'high'
              WHEN confidence >= 0.5 THEN 'medium'
              ELSE 'low' END as band,
         COUNT(*) as cnt
       FROM agent_decisions
       WHERE created_at >= CAST(GETUTCDATE() AS DATE)
       GROUP BY CASE WHEN confidence >= 0.8 THEN 'high'
                     WHEN confidence >= 0.5 THEN 'medium'
                     ELSE 'low' END`,
    );
    const byConfidence = { high: 0, medium: 0, low: 0 };
    for (const r of confRows) {
      if (r.band in byConfidence) (byConfidence as any)[r.band] = r.cnt;
    }

    const shadowRows = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM agent_decisions
       WHERE created_at >= CAST(GETUTCDATE() AS DATE) AND shadow_mode = 1`,
    );
    const shadow = shadowRows[0]?.cnt ?? 0;

    return { today: byAction, byAction, byConfidence, shadow, total };
  }

  async getProviderStats(days = 7): Promise<Array<{ provider: string; model: string; cnt: number; avg_latency: number }>> {
    return query<{ provider: string; model: string; cnt: number; avg_latency: number }>(
      `SELECT provider, model, COUNT(*) as cnt, AVG(latency_ms) as avg_latency
       FROM agent_llm_calls
       WHERE created_at >= DATEADD(day, -?, GETUTCDATE())
       GROUP BY provider, model
       ORDER BY cnt DESC`,
      [days],
    );
  }

  async getConfidenceHistory(days = 30): Promise<Array<{ day: string; avg_confidence: number; cnt: number }>> {
    return query<{ day: string; avg_confidence: number; cnt: number }>(
      `SELECT CONVERT(VARCHAR(10), created_at, 120) as day,
              AVG(confidence) as avg_confidence,
              COUNT(*) as cnt
       FROM agent_decisions
       WHERE created_at >= DATEADD(day, -?, GETUTCDATE())
         AND confidence IS NOT NULL
       GROUP BY CONVERT(VARCHAR(10), created_at, 120)
       ORDER BY day`,
      [days],
    );
  }

  async getOverrideLog(limit = 50): Promise<unknown[]> {
    return query(
      `SELECT TOP(?) * FROM agent_decisions
       WHERE outcome IS NOT NULL
         AND (outcome LIKE '%Declined%' OR outcome LIKE '%Edited%' OR outcome LIKE '%Approved%')
       ORDER BY resolved_at DESC`,
      [limit],
    );
  }
}
