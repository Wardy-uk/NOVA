import { executeAndGetId, query, execute } from './database.js';
import type { AgentDecision, ActionResult } from './agent-types.js';
import type { SelfDirectedLearning } from './self-directed-learning.js';

export class Observer {
  private learning: SelfDirectedLearning | null = null;

  setLearning(learning: SelfDirectedLearning): void {
    this.learning = learning;
  }

  async checkAndMarkNovelty(decisionId: number, classification: { category?: string; sub_category?: string } | null): Promise<void> {
    if (!this.learning || !classification) return;
    try {
      const requestType = classification.category ?? null;
      const component = classification.sub_category ?? null;
      const novelty = await this.learning.checkNovelty(requestType, component);
      if (novelty.is_novel) {
        await execute(
          `UPDATE agent_decisions SET is_novel_type = 1 WHERE id = ?`,
          [decisionId],
        );
        console.log(`[observer] Novel ticket type detected for decision #${decisionId} (${requestType}/${component}, prior count: ${novelty.prior_count})`);
      }
    } catch (err) {
      console.warn(`[observer] Novelty check failed for decision #${decisionId}:`, err instanceof Error ? err.message : err);
    }
  }

  async recordLearningAcquisition(ticketKey: string): Promise<void> {
    if (!this.learning) return;
    try {
      await this.learning.recordLearning(ticketKey);
    } catch (err) {
      console.warn(`[observer] Learning acquisition failed for ${ticketKey}:`, err instanceof Error ? err.message : err);
    }
  }

  async logDecision(decision: AgentDecision): Promise<number> {
    const qw = decision.output?.quick_win as { type?: string; confidence?: number } | undefined;
    const qwType = (qw?.type && qw.type !== 'none') ? qw.type : null;
    const qwConf = qwType ? (qw?.confidence ?? null) : null;

    const decisionId = await executeAndGetId(
      `INSERT INTO agent_decisions
         (ticket_id, event_type, inputs, reasoning, output, action, confidence,
          provider, model, approval_required, shadow_mode, latency_ms, prompt_version, call_type,
          quick_win_type, quick_win_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        decision.promptVersion ?? null,
        decision.callType ?? decision.action,
        qwType,
        qwConf,
      ],
    );

    const classification = decision.output?.classification as { category?: string; sub_category?: string } | undefined;
    this.checkAndMarkNovelty(decisionId, classification ?? null).catch(() => {});

    return decisionId;
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

  async getDecisionsCount(): Promise<number> {
    const rows = await query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM agent_decisions');
    return rows[0]?.cnt ?? 0;
  }

  async getDecisions(limit = 50, offset = 0): Promise<unknown[]> {
    return query(
      `SELECT d.*, c.summary AS ticket_subject
       FROM agent_decisions d
       LEFT JOIN jira_issue_cache c ON c.issue_key = d.ticket_id
       ORDER BY d.created_at DESC
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

  async getCostSummary(days = 30): Promise<{
    totalCost: number;
    totalCalls: number;
    byProvider: Array<{ provider: string; cost: number; calls: number }>;
    byModel: Array<{ model: string; provider: string; cost: number; calls: number; input_tokens: number; output_tokens: number }>;
    byCallType: Array<{ call_type: string; cost: number; calls: number }>;
    dailyTrend: Array<{ day: string; cost: number; calls: number }>;
    avgCostPerDecision: number;
    topTickets: Array<{ ticket_id: string; cost: number; calls: number }>;
  }> {
    // days=1 means "today from midnight UTC", not rolling 24h
    const dateFilter = days === 1
      ? `created_at >= CAST(GETUTCDATE() AS DATE)`
      : `created_at >= DATEADD(day, -${days}, GETUTCDATE())`;

    const [totalRows, byProviderRows, byModelRows, byCallTypeRows, dailyRows, decisionCount, topTicketRows] = await Promise.all([
      query<{ total_cost: number; total_calls: number }>(
        `SELECT ISNULL(SUM(estimated_cost), 0) as total_cost, COUNT(*) as total_calls
         FROM agent_llm_calls WHERE ${dateFilter}`,
      ),
      query<{ provider: string; cost: number; calls: number }>(
        `SELECT provider, ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls WHERE ${dateFilter}
         GROUP BY provider ORDER BY cost DESC`,
      ),
      query<{ model: string; provider: string; cost: number; calls: number; input_tokens: number; output_tokens: number }>(
        `SELECT model, provider, ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls,
                ISNULL(SUM(input_tokens), 0) as input_tokens, ISNULL(SUM(output_tokens), 0) as output_tokens
         FROM agent_llm_calls WHERE ${dateFilter}
         GROUP BY model, provider ORDER BY cost DESC`,
      ),
      query<{ call_type: string; cost: number; calls: number }>(
        `SELECT call_type, ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls WHERE ${dateFilter}
         GROUP BY call_type ORDER BY cost DESC`,
      ),
      query<{ day: string; cost: number; calls: number }>(
        `SELECT CONVERT(VARCHAR(10), created_at, 120) as day,
                ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls WHERE ${dateFilter}
         GROUP BY CONVERT(VARCHAR(10), created_at, 120) ORDER BY day`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_decisions
         WHERE ${dateFilter}`,
      ),
      query<{ ticket_id: string; cost: number; calls: number }>(
        `SELECT TOP(10) ticket_id, ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls
         WHERE ${dateFilter} AND ticket_id IS NOT NULL
         GROUP BY ticket_id ORDER BY cost DESC`,
      ),
    ]);

    const totalCost = totalRows[0]?.total_cost ?? 0;
    const totalCalls = totalRows[0]?.total_calls ?? 0;
    const decisions = decisionCount[0]?.cnt ?? 0;

    return {
      totalCost,
      totalCalls,
      byProvider: byProviderRows,
      byModel: byModelRows,
      byCallType: byCallTypeRows,
      dailyTrend: dailyRows,
      avgCostPerDecision: decisions > 0 ? totalCost / decisions : 0,
      topTickets: topTicketRows,
    };
  }

  async getCostTrend(startDate: string, endDate: string): Promise<Array<{ period: string; cost: number; calls: number; decisions: number }>> {
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);

    let costRows: Array<{ period: string; cost: number; calls: number }>;
    let decisionRows: Array<{ period: string; decisions: number }>;

    if (diffDays <= 1) {
      costRows = await query<{ period: string; cost: number; calls: number }>(
        `SELECT FORMAT(created_at, 'HH') as period,
                ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls
         WHERE CONVERT(DATE, created_at) = CONVERT(DATE, ?)
         GROUP BY FORMAT(created_at, 'HH') ORDER BY period`,
        [startDate],
      );
      decisionRows = await query<{ period: string; decisions: number }>(
        `SELECT FORMAT(created_at, 'HH') as period, COUNT(*) as decisions
         FROM agent_decisions
         WHERE CONVERT(DATE, created_at) = CONVERT(DATE, ?)
         GROUP BY FORMAT(created_at, 'HH')`,
        [startDate],
      );
    } else {
      costRows = await query<{ period: string; cost: number; calls: number }>(
        `SELECT CONVERT(VARCHAR(10), created_at, 120) as period,
                ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls
         WHERE CONVERT(DATE, created_at) >= CONVERT(DATE, ?)
           AND CONVERT(DATE, created_at) <= CONVERT(DATE, ?)
         GROUP BY CONVERT(VARCHAR(10), created_at, 120) ORDER BY period`,
        [startDate, endDate],
      );
      decisionRows = await query<{ period: string; decisions: number }>(
        `SELECT CONVERT(VARCHAR(10), created_at, 120) as period, COUNT(*) as decisions
         FROM agent_decisions
         WHERE CONVERT(DATE, created_at) >= CONVERT(DATE, ?)
           AND CONVERT(DATE, created_at) <= CONVERT(DATE, ?)
         GROUP BY CONVERT(VARCHAR(10), created_at, 120)`,
        [startDate, endDate],
      );
    }

    const decisionMap = new Map(decisionRows.map(r => [r.period, r.decisions]));
    return costRows.map(r => ({ ...r, decisions: decisionMap.get(r.period) ?? 0 }));
  }

  async getCostsByMode(days: number, workingHours: string, workingDays: string): Promise<{
    working: { cost: number; calls: number };
    outOfHours: { cost: number; calls: number };
  }> {
    const match = workingHours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    const startHour = match ? parseInt(match[1], 10) : 8;
    const endHour = match ? parseInt(match[3], 10) : 18;
    const daySet = workingDays.split(',').map(d => d.trim()).join(',');

    const dateFilter = days === 1
      ? `created_at >= CAST(GETUTCDATE() AS DATE)`
      : `created_at >= DATEADD(day, -${days}, GETUTCDATE())`;

    const rows = await query<{ is_working: number; cost: number; calls: number }>(
      `SELECT
         CASE WHEN DATEPART(WEEKDAY, created_at) - 1 IN (${daySet})
              AND DATEPART(HOUR, created_at) >= ${startHour}
              AND DATEPART(HOUR, created_at) < ${endHour}
              THEN 1 ELSE 0 END as is_working,
         ISNULL(SUM(estimated_cost), 0) as cost,
         COUNT(*) as calls
       FROM agent_llm_calls
       WHERE ${dateFilter}
       GROUP BY CASE WHEN DATEPART(WEEKDAY, created_at) - 1 IN (${daySet})
                     AND DATEPART(HOUR, created_at) >= ${startHour}
                     AND DATEPART(HOUR, created_at) < ${endHour}
                     THEN 1 ELSE 0 END`,
    );

    const working = rows.find(r => r.is_working === 1);
    const outOfHours = rows.find(r => r.is_working === 0);

    return {
      working: { cost: working?.cost ?? 0, calls: working?.calls ?? 0 },
      outOfHours: { cost: outOfHours?.cost ?? 0, calls: outOfHours?.calls ?? 0 },
    };
  }

  async getDecisionsFiltered(opts: {
    limit: number;
    offset: number;
    quickWinType?: string;
    eventType?: string;
  }): Promise<unknown[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.quickWinType) {
      if (opts.quickWinType === 'all') {
        conditions.push(`d.quick_win_type IS NOT NULL AND d.quick_win_type != 'none'`);
      } else {
        conditions.push(`d.quick_win_type = ?`);
        params.push(opts.quickWinType);
      }
    }
    if (opts.eventType) {
      conditions.push(`d.event_type = ?`);
      params.push(opts.eventType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(opts.offset, opts.limit);

    return query(
      `SELECT d.*, c.summary AS ticket_subject
       FROM agent_decisions d
       LEFT JOIN jira_issue_cache c ON c.issue_key = d.ticket_id
       ${where}
       ORDER BY d.created_at DESC
       OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      params,
    );
  }

  async getQuickWinStats(): Promise<{
    byType: Record<string, number>;
    totalToday: number;
    executedToday: number;
    undoRate30d: number;
  }> {
    const [typeRows, execRows, undoRows] = await Promise.all([
      query<{ quick_win_type: string; cnt: number }>(
        `SELECT quick_win_type, COUNT(*) as cnt FROM agent_decisions
         WHERE quick_win_type IS NOT NULL AND quick_win_type != 'none'
           AND created_at >= CAST(GETUTCDATE() AS DATE)
         GROUP BY quick_win_type`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_decisions
         WHERE quick_win_executed = 1
           AND quick_win_executed_at >= CAST(GETUTCDATE() AS DATE)`,
      ),
      query<{ executed: number; undone: number }>(
        `SELECT
           COUNT(*) as executed,
           SUM(CASE WHEN quick_win_undone = 1 THEN 1 ELSE 0 END) as undone
         FROM agent_decisions
         WHERE quick_win_executed = 1
           AND quick_win_executed_at >= DATEADD(day, -30, GETUTCDATE())`,
      ),
    ]);

    const byType: Record<string, number> = {};
    let totalToday = 0;
    for (const r of typeRows) {
      byType[r.quick_win_type] = r.cnt;
      totalToday += r.cnt;
    }

    const executed30d = undoRows[0]?.executed ?? 0;
    const undone30d = undoRows[0]?.undone ?? 0;

    return {
      byType,
      totalToday,
      executedToday: execRows[0]?.cnt ?? 0,
      undoRate30d: executed30d > 0 ? undone30d / executed30d : 0,
    };
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
