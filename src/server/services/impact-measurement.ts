import { query, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

export interface ImpactMetrics {
  period_start: string;
  period_end: string;
  autonomous_resolution_rate: number;
  deflection_rate: number;
  queue_hours_saved: number;
  approval_rate: number;
  reversal_rate: number;
  assignment_automation_rate: number;
  kb_coverage_delta: number;
  escalation_accuracy: number;
}

interface CountRow { cnt: number }

export class ImpactMeasurement {
  constructor(private settings: SettingsQueries) {}

  async computeMetrics(days: number = 7): Promise<ImpactMetrics> {
    const periodEnd = new Date().toISOString();
    const periodStart = new Date(Date.now() - days * 86400_000).toISOString();

    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (err) {
        console.error('[ImpactMeasurement] Metric computation failed:', err);
        return fallback;
      }
    };

    const [
      autonomousRate,
      deflectionRate,
      approvalStats,
      assignmentRate,
      kbDelta,
      escalationAcc,
    ] = await Promise.all([
      safe(() => this.computeAutonomousResolutionRate(days), 0),
      safe(() => this.computeDeflectionRate(days), 0),
      safe(() => this.computeApprovalStats(days), { approvalRate: 0, reversalRate: 0 }),
      safe(() => this.computeAssignmentAutomationRate(days), 0),
      safe(() => this.computeKbCoverageDelta(days), 0),
      safe(() => this.computeEscalationAccuracy(days), 0),
    ]);

    const avgHandleMinutes = parseInt(this.settings.get('agent_avg_handle_time_minutes') ?? '12', 10);
    const autonomousResolved = await safe(() => this.countAutonomousResolved(days), 0);
    const autoClosed = await safe(() => this.countAutoClosed(days), 0);
    const queueHoursSaved = (autonomousResolved + autoClosed) * avgHandleMinutes / 60;

    return {
      period_start: periodStart,
      period_end: periodEnd,
      autonomous_resolution_rate: autonomousRate,
      deflection_rate: deflectionRate,
      queue_hours_saved: Math.round(queueHoursSaved * 100) / 100,
      approval_rate: approvalStats.approvalRate,
      reversal_rate: approvalStats.reversalRate,
      assignment_automation_rate: assignmentRate,
      kb_coverage_delta: kbDelta,
      escalation_accuracy: escalationAcc,
    };
  }

  async saveSnapshot(metrics: ImpactMetrics): Promise<void> {
    await execute(
      `INSERT INTO agent_impact_snapshots
        (period_start, period_end, autonomous_resolution_rate, deflection_rate,
         queue_hours_saved, approval_rate, reversal_rate, assignment_automation_rate,
         kb_coverage_delta, escalation_accuracy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE())`,
      [
        metrics.period_start, metrics.period_end,
        metrics.autonomous_resolution_rate, metrics.deflection_rate,
        metrics.queue_hours_saved, metrics.approval_rate,
        metrics.reversal_rate, metrics.assignment_automation_rate,
        metrics.kb_coverage_delta, metrics.escalation_accuracy,
      ]
    );
  }

  async getHistory(limit: number = 12): Promise<ImpactMetrics[]> {
    return query<ImpactMetrics>(
      `SELECT TOP (?) period_start, period_end, autonomous_resolution_rate, deflection_rate,
              queue_hours_saved, approval_rate, reversal_rate, assignment_automation_rate,
              kb_coverage_delta, escalation_accuracy
       FROM agent_impact_snapshots
       ORDER BY created_at DESC`,
      [limit]
    );
  }

  async getLatest(): Promise<ImpactMetrics | null> {
    const rows = await query<ImpactMetrics>(
      `SELECT TOP (1) period_start, period_end, autonomous_resolution_rate, deflection_rate,
              queue_hours_saved, approval_rate, reversal_rate, assignment_automation_rate,
              kb_coverage_delta, escalation_accuracy
       FROM agent_impact_snapshots
       ORDER BY created_at DESC`
    );
    return rows[0] ?? null;
  }

  private async computeAutonomousResolutionRate(days: number): Promise<number> {
    const rows = await query<{ resolved: number; total: number }>(
      `SELECT
         SUM(CASE WHEN outcome = 'resolved' THEN 1 ELSE 0 END) AS resolved,
         COUNT(*) AS total
       FROM agent_decisions
       WHERE action != 'no_action'
         AND shadow_mode = 0
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const r = rows[0];
    if (!r || r.total === 0) return 0;
    return Math.round((r.resolved / r.total) * 10000) / 10000;
  }

  private async countAutonomousResolved(days: number): Promise<number> {
    const rows = await query<CountRow>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE action != 'no_action' AND shadow_mode = 0 AND outcome = 'resolved'
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    return rows[0]?.cnt ?? 0;
  }

  private async computeDeflectionRate(days: number): Promise<number> {
    const qwRows = await query<CountRow>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE shadow_mode = 0
         AND quick_win_type IS NOT NULL
         AND quick_win_executed = 1
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const arRows = await query<CountRow>(
      `SELECT COUNT(*) AS cnt FROM hybrid_action_log
       WHERE action_id = 'close'
         AND status = 'completed'
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const totalRows = await query<CountRow>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE shadow_mode = 0
         AND action != 'no_action'
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const deflected = (qwRows[0]?.cnt ?? 0) + (arRows[0]?.cnt ?? 0);
    const total = totalRows[0]?.cnt ?? 0;
    if (total === 0) return 0;
    return Math.round((deflected / total) * 10000) / 10000;
  }

  private async countAutoClosed(days: number): Promise<number> {
    const qwRows = await query<CountRow>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE shadow_mode = 0
         AND quick_win_type IS NOT NULL
         AND quick_win_executed = 1
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const arRows = await query<CountRow>(
      `SELECT COUNT(*) AS cnt FROM hybrid_action_log
       WHERE action_id = 'close'
         AND status = 'completed'
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    return (qwRows[0]?.cnt ?? 0) + (arRows[0]?.cnt ?? 0);
  }

  private async computeApprovalStats(days: number): Promise<{ approvalRate: number; reversalRate: number }> {
    const rows = await query<{ approved: number; total: number }>(
      `SELECT
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
         COUNT(*) AS total
       FROM approval_queue
       WHERE status NOT IN ('pending', 'cancelled')
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const r = rows[0];
    if (!r || r.total === 0) return { approvalRate: 0, reversalRate: 0 };
    const approvalRate = Math.round((r.approved / r.total) * 10000) / 10000;

    const revRows = await query<{ overridden: number; total_approved: number }>(
      `SELECT
         SUM(CASE WHEN approval_status = 'overridden' THEN 1 ELSE 0 END) AS overridden,
         SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS total_approved
       FROM agent_decisions
       WHERE approval_required = 1
         AND shadow_mode = 0
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const rv = revRows[0];
    const reversalRate = (!rv || rv.total_approved === 0) ? 0
      : Math.round((rv.overridden / rv.total_approved) * 10000) / 10000;

    return { approvalRate, reversalRate };
  }

  private async computeAssignmentAutomationRate(days: number): Promise<number> {
    const rows = await query<{ auto_assigned: number; total_actions: number }>(
      `SELECT
         SUM(CASE WHEN action_id = 'assign' AND status = 'completed' THEN 1 ELSE 0 END) AS auto_assigned,
         COUNT(*) AS total_actions
       FROM hybrid_action_log
       WHERE status IN ('completed', 'failed', 'failed_permanent')
         AND created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const r = rows[0];
    if (!r || r.total_actions === 0) return 0;
    return Math.round((r.auto_assigned / r.total_actions) * 10000) / 10000;
  }

  private async computeKbCoverageDelta(days: number): Promise<number> {
    const rows = await query<{ closed: number; opened: number }>(
      `SELECT
         SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS opened
       FROM kb_gap_log
       WHERE created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const r = rows[0];
    if (!r || r.opened === 0) return 0;
    return Math.round((r.closed / r.opened) * 10000) / 10000;
  }

  private async computeEscalationAccuracy(days: number): Promise<number> {
    const rows = await query<{ actioned: number; total: number }>(
      `SELECT
         SUM(CASE WHEN actioned_by IS NOT NULL THEN 1 ELSE 0 END) AS actioned,
         COUNT(*) AS total
       FROM escalation_log
       WHERE created_at >= DATEADD(DAY, -${days}, GETUTCDATE())`
    );
    const r = rows[0];
    if (!r || r.total === 0) return 0;
    return Math.round((r.actioned / r.total) * 10000) / 10000;
  }
}
