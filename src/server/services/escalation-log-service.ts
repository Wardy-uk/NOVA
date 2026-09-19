import { query, execute, executeAndGetId } from './database.js';
import { GENUINE_ESCALATION } from './escalation-sql.js';

export interface EscalationLogEntry {
  id: number;
  ticket_key: string;
  escalation_type: string;
  from_tier: string | null;
  to_tier: string | null;
  reason_code: string | null;
  reason_label: string | null;
  escalated_by: string | null;
  assigned_to: string | null;
  notes: string | null;
  decision_id: number | null;
  source: string;
  created_at: string;
  /** Minutes the ticket spent in `from_tier` before this move. NULL when unknown. */
  minutes_in_from_tier: number | null;
}

export interface LogEscalationInput {
  ticket_key: string;
  escalation_type: 'manual' | 'ai_agent' | 'jira_transition' | 'sla_risk' | 'complaint_portal' | 'rejection' | 'dispute';
  from_tier?: string;
  to_tier?: string;
  reason_code?: string;
  reason_label?: string;
  escalated_by?: string;
  assigned_to?: string;
  notes?: string;
  decision_id?: number;
  /** Set on escalation_type='dispute' rows: the escalation being contested. */
  disputes_escalation_id?: number;
  /** How long the ticket sat in `from_tier` before this move. */
  minutes_in_from_tier?: number | null;
  source?: string;
  created_at?: string;
}

/**
 * A bounce-back / rejection capture: a higher tier formally returning a ticket
 * to a lower tier. This is the clean-sheet replacement for the deprecated
 * JiraTickets.*RejectionAt columns — recorded explicitly when a rejection
 * happens, never inferred from ambiguous tier-move heuristics.
 */
export interface LogRejectionInput {
  ticket_key: string;
  /** Tier that rejected/returned the ticket (the higher tier). */
  from_tier?: string;
  /** Tier the ticket was returned to (the lower tier). */
  to_tier?: string;
  reason_code?: string;
  reason_label?: string;
  /** Who rejected it (the returning party). */
  rejected_by?: string;
  /** Agent/queue the ticket was returned to. */
  returned_to?: string;
  notes?: string;
  source?: string;
  created_at?: string;
}

export interface RejectionStats {
  total: number;
  /** Which way work is coming back, busiest route first. */
  by_route: Array<{ from_tier: string; to_tier: string; count: number }>;
  /** Free text as written on the rejection screen — never bucketed. */
  by_reason: Array<{ reason: string; count: number }>;
  /** Rejections carrying no reason at all. Shown, not hidden: a reason
   *  breakdown over a third of the data, presented as if it were the whole,
   *  is worse than no breakdown. */
  without_reason: number;
}

/** Where the time actually goes. Median and p90 rather than mean — one ticket
 *  parked for six weeks drags an average somewhere no real ticket has ever been. */
export interface TierDwell {
  tier: string;
  moves: number;
  median_minutes: number | null;
  p90_minutes: number | null;
}

export interface EscalationStats {
  total: number;
  by_type: Array<{ escalation_type: string; count: number }>;
  by_tier: Array<{ to_tier: string; count: number }>;
  by_reason: Array<{ reason_code: string; reason_label: string | null; count: number }>;
  daily: Array<{ date: string; count: number }>;
  escalation_rate: number | null;
  /** Rejections, counted SEPARATELY rather than filtered away. Every aggregate
   *  above excludes `escalation_type = 'rejection'` — right for measuring
   *  escalation volume, and the reason handbacks were invisible on this screen. */
  rejections: RejectionStats;
  /** Null when the measurement is unavailable, never an empty list dressed up
   *  as "nothing waited" — the rows predating the column genuinely cannot say. */
  dwell: TierDwell[] | null;
}

const TIER_PATTERNS: Record<string, string> = {
  'waiting for support': 'T1',
  'in progress': 'T1',
  'waiting for t2 support': 'T2',
  't2 in progress': 'T2',
  'waiting for t3 support': 'T3',
  't3 in progress': 'T3',
  'with development': 'Dev',
  'development in progress': 'Dev',
  'escalated': 'T2',
};

export function detectTierFromStatus(status: string): string | null {
  return TIER_PATTERNS[status.toLowerCase()] ?? null;
}

/** Minutes between the previous tier move and this one. NULL for the first move,
 *  or if the history is out of order despite the sort. */
function dwellSince(lastMoveAt: number | null, movedAt: string): number | null {
  if (lastMoveAt == null) return null;
  const mins = Math.round((new Date(movedAt).getTime() - lastMoveAt) / 60000);
  return mins >= 0 ? mins : null;
}

export class EscalationLogService {
  /** Set by index.ts. Optional so the logger keeps working without the predictor wired. */
  private onEscalated?: (ticketKey: string) => void;

  setEscalationObserver(fn: (ticketKey: string) => void): void {
    this.onEscalated = fn;
  }

  async log(input: LogEscalationInput): Promise<number> {
    // Grade any open prediction for this ticket. Fire-and-forget on purpose: scoring a
    // forecast must never be able to fail the escalation it is scoring.
    try { this.onEscalated?.(input.ticket_key); } catch { /* never block the log */ }
    return executeAndGetId(
      `INSERT INTO escalation_log
       (ticket_key, escalation_type, from_tier, to_tier, reason_code, reason_label,
        escalated_by, assigned_to, notes, decision_id, disputes_escalation_id, source, created_at,
        minutes_in_from_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.ticket_key,
        input.escalation_type,
        input.from_tier ?? null,
        input.to_tier ?? null,
        input.reason_code ?? null,
        input.reason_label ?? null,
        input.escalated_by ?? null,
        input.assigned_to ?? null,
        input.notes ?? null,
        input.decision_id ?? null,
        input.disputes_escalation_id ?? null,
        input.source ?? 'manual',
        input.created_at ?? new Date().toISOString(),
        input.minutes_in_from_tier ?? null,
      ],
    );
  }

  /**
   * Capture an explicit rejection / bounce-back event into escalation_log with
   * escalation_type='rejection'. This is the source-of-truth capture path that
   * lets rejection_rate / escalation_accuracy be computed honestly from real
   * recorded events. Reuses the existing escalation_log columns: from_tier/to_tier
   * carry the tier movement, escalated_by = who rejected, assigned_to = where it
   * was returned.
   */
  async logRejection(input: LogRejectionInput): Promise<number> {
    return this.log({
      ticket_key: input.ticket_key,
      escalation_type: 'rejection',
      from_tier: input.from_tier,
      to_tier: input.to_tier,
      reason_code: input.reason_code,
      reason_label: input.reason_label,
      escalated_by: input.rejected_by,
      assigned_to: input.returned_to,
      notes: input.notes,
      source: input.source ?? 'manual',
      created_at: input.created_at,
    });
  }

  async getAll(opts?: { days?: number; type?: string; tier?: string }): Promise<EscalationLogEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.days) {
      conditions.push('created_at >= DATEADD(day, ?, GETUTCDATE())');
      params.push(-opts.days);
    }
    if (opts?.type) {
      conditions.push('escalation_type = ?');
      params.push(opts.type);
    }
    if (opts?.tier) {
      conditions.push('to_tier = ?');
      params.push(opts.tier);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return query<EscalationLogEntry>(
      `SELECT * FROM escalation_log ${where} ORDER BY created_at DESC`,
      params,
    );
  }

  /**
   * Escalation volume over the window.
   *
   * Counts GENUINE escalations — upward tier moves and deliberate escalations —
   * not merely "everything that was not a rejection", which is what these
   * aggregates used to do. That older test put every downward move into the tier
   * it landed in, so the screen reported 168 escalations TO Customer Care. Nothing
   * escalates into the bottom tier; those were handbacks. The same rows inflated
   * the total and, through it, the escalation rate.
   *
   * Rejections are still excluded here and counted separately by
   * getRejectionStats(), because escalation volume and handback volume are
   * different questions.
   */
  async getStats(days = 30): Promise<EscalationStats> {
    const [totalRows, byType, byTier, byReason, daily, ticketCount] = await Promise.all([
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM escalation_log WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND ${GENUINE_ESCALATION}`,
        [-days],
      ),
      query<{ escalation_type: string; count: number }>(
        `SELECT escalation_type, COUNT(*) as count FROM escalation_log
         WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND ${GENUINE_ESCALATION}
         GROUP BY escalation_type ORDER BY count DESC`,
        [-days],
      ),
      query<{ to_tier: string; count: number }>(
        `SELECT ISNULL(to_tier, 'Unknown') as to_tier, COUNT(*) as count FROM escalation_log
         WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND ${GENUINE_ESCALATION}
         GROUP BY to_tier ORDER BY count DESC`,
        [-days],
      ),
      query<{ reason_code: string; reason_label: string | null; count: number }>(
        `SELECT ISNULL(reason_code, 'unknown') as reason_code, MAX(reason_label) as reason_label, COUNT(*) as count
         FROM escalation_log WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND ${GENUINE_ESCALATION}
         GROUP BY reason_code ORDER BY count DESC`,
        [-days],
      ),
      query<{ date: string; count: number }>(
        `SELECT CONVERT(VARCHAR(10), created_at, 120) as date, COUNT(*) as count
         FROM escalation_log WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND ${GENUINE_ESCALATION}
         GROUP BY CONVERT(VARCHAR(10), created_at, 120) ORDER BY date`,
        [-days],
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(DISTINCT issue_key) as cnt FROM jira_issue_cache
         WHERE jira_created >= DATEADD(day, ?, GETUTCDATE())`,
        [-days],
      ),
    ]);

    const total = totalRows[0]?.cnt ?? 0;
    const tickets = ticketCount[0]?.cnt ?? 0;

    return {
      total,
      by_type: byType,
      by_tier: byTier,
      by_reason: byReason,
      daily,
      escalation_rate: tickets > 0 ? Math.round((total / tickets) * 100 * 10) / 10 : null,
      rejections: await this.getRejectionStats(days),
      dwell: await this.getTierDwell(days),
    };
  }

  /**
   * Rejections over the window: how many, along which routes, and why.
   *
   * Only `escalation_type = 'rejection'`, which the sync sets solely when the
   * Rejection Reason field changed on the same transition. Downward moves with
   * no such evidence are NOT swept in here — most Development → Tier 3 moves are
   * a shipped fix returning for test, and counting those as rejections would
   * report the working part of the flow as the broken one.
   */
  async getRejectionStats(days = 30): Promise<RejectionStats> {
    const [routes, reasons] = await Promise.all([
      query<{ from_tier: string; to_tier: string; count: number }>(
        `SELECT ISNULL(from_tier, 'Unknown') AS from_tier, ISNULL(to_tier, 'Unknown') AS to_tier, COUNT(*) AS count
           FROM escalation_log
          WHERE escalation_type = 'rejection' AND created_at >= DATEADD(day, ?, GETUTCDATE())
          GROUP BY from_tier, to_tier ORDER BY COUNT(*) DESC`,
        [-days],
      ),
      query<{ reason: string | null; count: number }>(
        `SELECT reason_label AS reason, COUNT(*) AS count
           FROM escalation_log
          WHERE escalation_type = 'rejection' AND created_at >= DATEADD(day, ?, GETUTCDATE())
          GROUP BY reason_label ORDER BY COUNT(*) DESC`,
        [-days],
      ),
    ]);

    return {
      total: routes.reduce((sum, r) => sum + r.count, 0),
      by_route: routes,
      by_reason: reasons
        .filter(r => r.reason && r.reason.trim())
        .map(r => ({ reason: (r.reason as string).trim(), count: r.count })),
      without_reason: reasons
        .filter(r => !r.reason || !r.reason.trim())
        .reduce((sum, r) => sum + r.count, 0),
    };
  }

  /** Median/p90 minutes spent in each tier before leaving it. */
  async getTierDwell(days = 30): Promise<TierDwell[] | null> {
    try {
      return await query<TierDwell>(
        `SELECT DISTINCT from_tier AS tier,
                COUNT(*) OVER (PARTITION BY from_tier) AS moves,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes_in_from_tier)
                  OVER (PARTITION BY from_tier) AS median_minutes,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY minutes_in_from_tier)
                  OVER (PARTITION BY from_tier) AS p90_minutes
           FROM escalation_log
          WHERE created_at >= DATEADD(day, ?, GETUTCDATE())
            AND from_tier IS NOT NULL
            AND minutes_in_from_tier IS NOT NULL`,
        [-days],
      );
    } catch {
      // Older rows carry no duration and a freshly-migrated database carries
      // none at all. Null says "not measured"; an empty array would read as
      // "nothing waited anywhere", which is the one thing it cannot mean.
      return null;
    }
  }

  async backfillFromChangelog(
    ticketKey: string,
    changelog: Array<{
      created: string;
      author: { displayName: string };
      items: Array<{ field: string; fieldId?: string; fromString: string | null; toString: string | null }>;
    }>,
  ): Promise<number> {
    let inserted = 0;
    // Ascending, defensively. Dwell is the gap between CONSECUTIVE moves, so an
    // out-of-order history would produce negative durations — and Jira's ordering
    // is a default, not a guarantee.
    const ordered = [...changelog].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
    );
    // When the ticket last moved tier. The first move of a ticket's life has no
    // predecessor here — the changelog does not record creation — so its dwell is
    // left NULL rather than measured from an arbitrary start.
    let lastMoveAt: number | null = null;
    for (const entry of ordered) {
      // Detect tier changes from Current Tier field (customfield_12981) or status transitions
      const tierChanges = entry.items.filter(i =>
        i.fieldId === 'customfield_12981' || i.field === 'Current Tier',
      );
      const statusChanges = entry.items.filter(i => i.field === 'status');

      // Prefer direct Current Tier field changes — these carry the real tier values
      for (const change of tierChanges) {
        const fromTier = change.fromString;
        const toTier = change.toString;
        if (!fromTier || !toTier || fromTier === toTier) continue;

        const existing = await query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM escalation_log
           WHERE ticket_key = ? AND source = 'jira_backfill'
           AND from_tier = ? AND to_tier = ?
           AND ABS(DATEDIFF(minute, created_at, ?)) < 5`,
          [ticketKey, fromTier, toTier, entry.created],
        );
        if ((existing[0]?.cnt ?? 0) > 0) continue;

        await this.log({
          ticket_key: ticketKey,
          escalation_type: 'jira_transition',
          from_tier: fromTier,
          to_tier: toTier,
          escalated_by: entry.author.displayName,
          notes: `Tier change: ${fromTier} → ${toTier}`,
          minutes_in_from_tier: dwellSince(lastMoveAt, entry.created),
          source: 'jira_backfill',
          created_at: entry.created,
        });
        lastMoveAt = new Date(entry.created).getTime();
        inserted++;
      }

      // Fallback: infer tier from status transitions if no direct tier field change
      if (tierChanges.length === 0) {
        for (const change of statusChanges) {
          const fromTier = detectTierFromStatus(change.fromString ?? '');
          const toTier = detectTierFromStatus(change.toString ?? '');
          if (!fromTier || !toTier || fromTier === toTier) continue;

          const existing = await query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM escalation_log
             WHERE ticket_key = ? AND source = 'jira_backfill'
             AND from_tier = ? AND to_tier = ?
             AND ABS(DATEDIFF(minute, created_at, ?)) < 5`,
            [ticketKey, fromTier, toTier, entry.created],
          );
          if ((existing[0]?.cnt ?? 0) > 0) continue;

          await this.log({
            ticket_key: ticketKey,
            escalation_type: 'jira_transition',
            from_tier: fromTier,
            to_tier: toTier,
            escalated_by: entry.author.displayName,
            notes: `${change.fromString} → ${change.toString}`,
            minutes_in_from_tier: dwellSince(lastMoveAt, entry.created),
            source: 'jira_backfill',
            created_at: entry.created,
          });
          lastMoveAt = new Date(entry.created).getTime();
          inserted++;
        }
      }
    }
    return inserted;
  }
}
