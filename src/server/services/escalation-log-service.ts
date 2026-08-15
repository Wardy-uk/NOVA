import { query, execute, executeAndGetId } from './database.js';

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

export interface EscalationStats {
  total: number;
  by_type: Array<{ escalation_type: string; count: number }>;
  by_tier: Array<{ to_tier: string; count: number }>;
  by_reason: Array<{ reason_code: string; reason_label: string | null; count: number }>;
  daily: Array<{ date: string; count: number }>;
  escalation_rate: number | null;
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

export class EscalationLogService {

  async log(input: LogEscalationInput): Promise<number> {
    return executeAndGetId(
      `INSERT INTO escalation_log
       (ticket_key, escalation_type, from_tier, to_tier, reason_code, reason_label,
        escalated_by, assigned_to, notes, decision_id, disputes_escalation_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  async getStats(days = 30): Promise<EscalationStats> {
    const [totalRows, byType, byTier, byReason, daily, ticketCount] = await Promise.all([
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM escalation_log WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND escalation_type <> 'rejection'`,
        [-days],
      ),
      query<{ escalation_type: string; count: number }>(
        `SELECT escalation_type, COUNT(*) as count FROM escalation_log
         WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND escalation_type <> 'rejection'
         GROUP BY escalation_type ORDER BY count DESC`,
        [-days],
      ),
      query<{ to_tier: string; count: number }>(
        `SELECT ISNULL(to_tier, 'Unknown') as to_tier, COUNT(*) as count FROM escalation_log
         WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND escalation_type <> 'rejection'
         GROUP BY to_tier ORDER BY count DESC`,
        [-days],
      ),
      query<{ reason_code: string; reason_label: string | null; count: number }>(
        `SELECT ISNULL(reason_code, 'unknown') as reason_code, MAX(reason_label) as reason_label, COUNT(*) as count
         FROM escalation_log WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND escalation_type <> 'rejection'
         GROUP BY reason_code ORDER BY count DESC`,
        [-days],
      ),
      query<{ date: string; count: number }>(
        `SELECT CONVERT(VARCHAR(10), created_at, 120) as date, COUNT(*) as count
         FROM escalation_log WHERE created_at >= DATEADD(day, ?, GETUTCDATE()) AND escalation_type <> 'rejection'
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
    };
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
    for (const entry of changelog) {
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
          source: 'jira_backfill',
          created_at: entry.created,
        });
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
            source: 'jira_backfill',
            created_at: entry.created,
          });
          inserted++;
        }
      }
    }
    return inserted;
  }
}
