import { executeAndGetId, query, execute } from './database.js';
import type { AgentDecision, ActionResult } from './agent-types.js';
import type { SelfDirectedLearning } from './self-directed-learning.js';
import type { SettingsQueries } from '../db/settings-store.js';

const DEFAULT_MINUTES_PER_ACTION: Record<string, number> = {
  no_action: 0,
  respond: 15,
  draft_response: 10,
  escalate: 5,
  gather_context: 8,
  assign: 3,
  chase: 5,
  transition: 2,
  comment: 5,
  update_fields: 2,
  bug_redirect: 5,
  quick_win_close: 8,
  close: 5,
};

export class Observer {
  private learning: SelfDirectedLearning | null = null;
  private settings: SettingsQueries | null = null;

  setLearning(learning: SelfDirectedLearning): void {
    this.learning = learning;
  }

  setSettings(settings: SettingsQueries): void {
    this.settings = settings;
  }

  private getMinutesSaved(action: string): number {
    const overrides = this.settings?.get('agent_minutes_per_action');
    if (overrides) {
      try {
        const parsed = JSON.parse(overrides) as Record<string, number>;
        if (parsed[action] !== undefined) return parsed[action];
      } catch { /* use defaults */ }
    }
    return DEFAULT_MINUTES_PER_ACTION[action] ?? 5;
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
    const minutesSaved = this.getMinutesSaved(decision.action);

    const decisionId = await executeAndGetId(
      `INSERT INTO agent_decisions
         (ticket_id, event_type, inputs, reasoning, output, action, confidence,
          provider, model, approval_required, shadow_mode, latency_ms, prompt_version, call_type,
          quick_win_type, quick_win_confidence, estimated_minutes_saved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        minutesSaved,
      ],
    );

    const classification = decision.output?.classification as { category?: string; sub_category?: string } | undefined;
    this.checkAndMarkNovelty(decisionId, classification ?? null).catch(() => {});

    return decisionId;
  }

  async logOutcome(decisionId: number, result: ActionResult): Promise<void> {
    const outcomeJson = JSON.stringify({ success: result.success, detail: result.detail, error: result.error });
    if (result.success) {
      await executeAndGetId(
        `UPDATE agent_decisions
         SET outcome = ?, resolved_at = GETUTCDATE(), resolved_by = 'system'
         WHERE id = ?`,
        [outcomeJson, decisionId],
      );
    } else {
      await executeAndGetId(
        `UPDATE agent_decisions
         SET outcome = ?
         WHERE id = ?`,
        [outcomeJson, decisionId],
      );
    }
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
    /** Calls whose model has no MODEL_PRICING entry (estimated_cost IS NULL) —
     *  their spend is missing from totalCost, so surface it rather than imply £0. */
    unpricedCalls: number;
    byProvider: Array<{ provider: string; cost: number; calls: number }>;
    byModel: Array<{ model: string; provider: string; cost: number; calls: number; input_tokens: number; output_tokens: number; unpriced: number }>;
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
      query<{ total_cost: number; total_calls: number; unpriced_calls: number }>(
        `SELECT ISNULL(SUM(estimated_cost), 0) as total_cost, COUNT(*) as total_calls,
                SUM(CASE WHEN estimated_cost IS NULL THEN 1 ELSE 0 END) as unpriced_calls
         FROM agent_llm_calls WHERE ${dateFilter}`,
      ),
      query<{ provider: string; cost: number; calls: number }>(
        `SELECT provider, ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls
         FROM agent_llm_calls WHERE ${dateFilter}
         GROUP BY provider ORDER BY cost DESC`,
      ),
      query<{ model: string; provider: string; cost: number; calls: number; input_tokens: number; output_tokens: number; unpriced: number }>(
        `SELECT model, provider, ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls,
                ISNULL(SUM(input_tokens), 0) as input_tokens, ISNULL(SUM(output_tokens), 0) as output_tokens,
                SUM(CASE WHEN estimated_cost IS NULL THEN 1 ELSE 0 END) as unpriced
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
      unpricedCalls: totalRows[0]?.unpriced_calls ?? 0,
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

  async getTimeSavedStats(days = 30): Promise<{
    total_minutes: number;
    today_minutes: number;
    by_action: Array<{ action: string; minutes: number; count: number }>;
    daily_trend: Array<{ day: string; minutes: number; count: number }>;
    actual: { total_minutes: number; today_minutes: number; by_action: Array<{ action: string; minutes: number; count: number }> };
    potential: { total_minutes: number; today_minutes: number; by_action: Array<{ action: string; minutes: number; count: number }> };
    daily_trend_split: Array<{ day: string; actual_minutes: number; potential_minutes: number }>;
  }> {
    const ACTUAL_FILTER = `AND (approval_required = 0 OR approval_status IN ('approved', 'confirmed', 'executed'))`;
    const POTENTIAL_FILTER = `AND approval_required = 1 AND (approval_status IS NULL OR approval_status = 'pending' OR approval_status = 'declined')`;
    const BASE = `FROM agent_decisions WHERE estimated_minutes_saved > 0 AND shadow_mode = 0`;

    const [
      totalRows, todayRows, byActionRows, dailyRows,
      actualTotal, actualToday, actualByAction,
      potentialTotal, potentialToday, potentialByAction,
      dailySplit,
    ] = await Promise.all([
      // Backwards-compat totals
      query<{ mins: number }>(`SELECT ISNULL(SUM(estimated_minutes_saved), 0) AS mins ${BASE} AND created_at >= DATEADD(day, -?, GETUTCDATE())`, [days]),
      query<{ mins: number }>(`SELECT ISNULL(SUM(estimated_minutes_saved), 0) AS mins ${BASE} AND created_at >= CAST(GETUTCDATE() AS DATE)`),
      query<{ action: string; minutes: number; count: number }>(`SELECT action, SUM(estimated_minutes_saved) AS minutes, COUNT(*) AS count ${BASE} AND created_at >= DATEADD(day, -?, GETUTCDATE()) GROUP BY action ORDER BY minutes DESC`, [days]),
      query<{ day: string; minutes: number; count: number }>(`SELECT CONVERT(VARCHAR(10), created_at, 120) AS day, SUM(estimated_minutes_saved) AS minutes, COUNT(*) AS count ${BASE} AND created_at >= DATEADD(day, -?, GETUTCDATE()) GROUP BY CONVERT(VARCHAR(10), created_at, 120) ORDER BY day`, [days]),
      // Actual (executed)
      query<{ mins: number }>(`SELECT ISNULL(SUM(estimated_minutes_saved), 0) AS mins ${BASE} ${ACTUAL_FILTER} AND created_at >= DATEADD(day, -?, GETUTCDATE())`, [days]),
      query<{ mins: number }>(`SELECT ISNULL(SUM(estimated_minutes_saved), 0) AS mins ${BASE} ${ACTUAL_FILTER} AND created_at >= CAST(GETUTCDATE() AS DATE)`),
      query<{ action: string; minutes: number; count: number }>(`SELECT action, SUM(estimated_minutes_saved) AS minutes, COUNT(*) AS count ${BASE} ${ACTUAL_FILTER} AND created_at >= DATEADD(day, -?, GETUTCDATE()) GROUP BY action ORDER BY minutes DESC`, [days]),
      // Potential (not realised)
      query<{ mins: number }>(`SELECT ISNULL(SUM(estimated_minutes_saved), 0) AS mins ${BASE} ${POTENTIAL_FILTER} AND created_at >= DATEADD(day, -?, GETUTCDATE())`, [days]),
      query<{ mins: number }>(`SELECT ISNULL(SUM(estimated_minutes_saved), 0) AS mins ${BASE} ${POTENTIAL_FILTER} AND created_at >= CAST(GETUTCDATE() AS DATE)`),
      query<{ action: string; minutes: number; count: number }>(`SELECT action, SUM(estimated_minutes_saved) AS minutes, COUNT(*) AS count ${BASE} ${POTENTIAL_FILTER} AND created_at >= DATEADD(day, -?, GETUTCDATE()) GROUP BY action ORDER BY minutes DESC`, [days]),
      // Daily split
      query<{ day: string; actual_minutes: number; potential_minutes: number }>(
        `SELECT CONVERT(VARCHAR(10), created_at, 120) AS day,
                ISNULL(SUM(CASE WHEN approval_required = 0 OR approval_status IN ('approved', 'confirmed', 'executed') THEN estimated_minutes_saved ELSE 0 END), 0) AS actual_minutes,
                ISNULL(SUM(CASE WHEN approval_required = 1 AND (approval_status IS NULL OR approval_status = 'pending' OR approval_status = 'declined') THEN estimated_minutes_saved ELSE 0 END), 0) AS potential_minutes
         ${BASE} AND created_at >= DATEADD(day, -?, GETUTCDATE())
         GROUP BY CONVERT(VARCHAR(10), created_at, 120) ORDER BY day`, [days]),
    ]);

    return {
      total_minutes: totalRows[0]?.mins ?? 0,
      today_minutes: todayRows[0]?.mins ?? 0,
      by_action: byActionRows,
      daily_trend: dailyRows,
      actual: {
        total_minutes: actualTotal[0]?.mins ?? 0,
        today_minutes: actualToday[0]?.mins ?? 0,
        by_action: actualByAction,
      },
      potential: {
        total_minutes: potentialTotal[0]?.mins ?? 0,
        today_minutes: potentialToday[0]?.mins ?? 0,
        by_action: potentialByAction,
      },
      daily_trend_split: dailySplit,
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
