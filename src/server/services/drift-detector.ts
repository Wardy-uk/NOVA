import { query, execute } from './database.js';
import type { AlertService } from './alert-service.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

interface DriftSegment {
  callType: string;
  promptVersion: string | null;
  provider: string | null;
  acceptRate: number | null;
  latencyP95Ms: number | null;
  costPerDecision: number | null;
  baselineAcceptRate: number | null;
  baselineLatencyP95Ms: number | null;
  baselineCostPerDecision: number | null;
  severity: 'none' | 'warn' | 'alert';
}

export interface DriftSnapshot {
  id: number;
  snapshotDate: string;
  periodDays: number;
  callType: string;
  promptVersion: string | null;
  provider: string | null;
  acceptRate: number | null;
  latencyP95Ms: number | null;
  costPerDecision: number | null;
  baselineAcceptRate: number | null;
  baselineLatencyP95Ms: number | null;
  baselineCostPerDecision: number | null;
  severity: string;
  createdAt: string;
}

const MIN_DECISIONS = 20;

export class DriftDetector {
  constructor(
    private settings: FileSettingsQueries,
    private alertService: AlertService,
  ) {}

  async computeDrift(periodDays = 7): Promise<DriftSegment[]> {
    const segments = await this.getSegmentKeys(periodDays);
    const results: DriftSegment[] = [];

    for (const seg of segments) {
      const current = await this.getWindowMetrics(seg.callType, seg.promptVersion, seg.provider, 0, periodDays);
      const baseline = await this.getWindowMetrics(seg.callType, seg.promptVersion, seg.provider, periodDays, periodDays);

      if (current.decisionCount < MIN_DECISIONS || baseline.decisionCount < MIN_DECISIONS) continue;

      const severity = this.computeSeverity(current, baseline);

      results.push({
        callType: seg.callType,
        promptVersion: seg.promptVersion,
        provider: seg.provider,
        acceptRate: current.acceptRate,
        latencyP95Ms: current.latencyP95Ms,
        costPerDecision: current.costPerDecision,
        baselineAcceptRate: baseline.acceptRate,
        baselineLatencyP95Ms: baseline.latencyP95Ms,
        baselineCostPerDecision: baseline.costPerDecision,
        severity,
      });
    }

    return results;
  }

  async snapshotDrift(periodDays = 7): Promise<DriftSegment[]> {
    const segments = await this.computeDrift(periodDays);
    const today = new Date().toISOString().slice(0, 10);

    for (const seg of segments) {
      await execute(
        `INSERT INTO agent_drift_snapshots
         (snapshot_date, period_days, call_type, prompt_version, provider,
          accept_rate, latency_p95_ms, cost_per_decision,
          baseline_accept_rate, baseline_latency_p95_ms, baseline_cost_per_decision,
          severity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          today, periodDays, seg.callType, seg.promptVersion, seg.provider,
          seg.acceptRate, seg.latencyP95Ms, seg.costPerDecision,
          seg.baselineAcceptRate, seg.baselineLatencyP95Ms, seg.baselineCostPerDecision,
          seg.severity,
        ],
      );

      if (seg.severity === 'alert') {
        const parts: string[] = [];
        if (seg.acceptRate != null && seg.baselineAcceptRate != null) {
          parts.push(`accept: ${(seg.baselineAcceptRate * 100).toFixed(1)}% → ${(seg.acceptRate * 100).toFixed(1)}%`);
        }
        if (seg.latencyP95Ms != null && seg.baselineLatencyP95Ms != null) {
          parts.push(`p95 latency: ${seg.baselineLatencyP95Ms}ms → ${seg.latencyP95Ms}ms`);
        }
        if (seg.costPerDecision != null && seg.baselineCostPerDecision != null) {
          parts.push(`cost/decision: ${seg.baselineCostPerDecision.toFixed(4)} → ${seg.costPerDecision.toFixed(4)}`);
        }
        const label = [seg.callType, seg.promptVersion, seg.provider].filter(Boolean).join(' / ');
        await this.alertService.createAlert({
          alertType: 'drift_detected',
          severity: 'critical',
          title: `Drift detected: ${label}`,
          detail: parts.join('; '),
        });
      }
    }

    // Send Teams notification for any alerts created
    if (segments.some(s => s.severity === 'alert')) {
      const alerts = await this.alertService.getAlertsByType('drift_detected', 10);
      const recent = alerts.filter(a => a.createdAt && new Date(a.createdAt).toISOString().slice(0, 10) === today);
      if (recent.length > 0) {
        await (this.alertService as any).sendTeamsNotification(recent);
      }
    }

    console.log(`[drift-detector] Snapshot complete: ${segments.length} segments, ${segments.filter(s => s.severity === 'alert').length} alerts, ${segments.filter(s => s.severity === 'warn').length} warnings`);
    return segments;
  }

  async getLatestSnapshotDate(): Promise<Date | null> {
    const rows = await query<{ latest: string | null }>(
      `SELECT TOP(1) created_at as latest FROM agent_drift_snapshots ORDER BY created_at DESC`,
    );
    if (!rows.length || !rows[0].latest) return null;
    return new Date(rows[0].latest);
  }

  async getSnapshots(limit = 50): Promise<DriftSnapshot[]> {
    const rows = await query<any>(
      `SELECT TOP(?) * FROM agent_drift_snapshots ORDER BY snapshot_date DESC, call_type`,
      [limit],
    );
    return rows.map((r: any) => ({
      id: r.id,
      snapshotDate: r.snapshot_date,
      periodDays: r.period_days,
      callType: r.call_type,
      promptVersion: r.prompt_version ?? null,
      provider: r.provider ?? null,
      acceptRate: r.accept_rate ?? null,
      latencyP95Ms: r.latency_p95_ms ?? null,
      costPerDecision: r.cost_per_decision ?? null,
      baselineAcceptRate: r.baseline_accept_rate ?? null,
      baselineLatencyP95Ms: r.baseline_latency_p95_ms ?? null,
      baselineCostPerDecision: r.baseline_cost_per_decision ?? null,
      severity: r.severity,
      createdAt: r.created_at,
    }));
  }

  async getTrend(callType: string, limit = 12): Promise<DriftSnapshot[]> {
    const rows = await query<any>(
      `SELECT TOP(?) * FROM agent_drift_snapshots
       WHERE call_type = ?
       ORDER BY snapshot_date DESC`,
      [limit, callType],
    );
    return rows.map((r: any) => ({
      id: r.id,
      snapshotDate: r.snapshot_date,
      periodDays: r.period_days,
      callType: r.call_type,
      promptVersion: r.prompt_version ?? null,
      provider: r.provider ?? null,
      acceptRate: r.accept_rate ?? null,
      latencyP95Ms: r.latency_p95_ms ?? null,
      costPerDecision: r.cost_per_decision ?? null,
      baselineAcceptRate: r.baseline_accept_rate ?? null,
      baselineLatencyP95Ms: r.baseline_latency_p95_ms ?? null,
      baselineCostPerDecision: r.baseline_cost_per_decision ?? null,
      severity: r.severity,
      createdAt: r.created_at,
    }));
  }

  private async getSegmentKeys(periodDays: number): Promise<Array<{ callType: string; promptVersion: string | null; provider: string | null }>> {
    const rows = await query<{ call_type: string; prompt_version: string | null; provider: string | null }>(
      `SELECT DISTINCT d.call_type, d.prompt_version, l.provider
       FROM agent_decisions d
       LEFT JOIN agent_llm_calls l ON l.call_type = d.call_type
         AND l.created_at >= DATEADD(day, -?, GETUTCDATE())
       WHERE d.created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [periodDays * 2, periodDays * 2],
    );
    const seen = new Set<string>();
    const unique: Array<{ callType: string; promptVersion: string | null; provider: string | null }> = [];
    for (const r of rows) {
      const key = `${r.call_type}|${r.prompt_version ?? ''}|${r.provider ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({ callType: r.call_type, promptVersion: r.prompt_version ?? null, provider: r.provider ?? null });
      }
    }
    return unique;
  }

  private async getWindowMetrics(
    callType: string,
    promptVersion: string | null,
    provider: string | null,
    offsetDays: number,
    windowDays: number,
  ): Promise<{ decisionCount: number; acceptRate: number | null; latencyP95Ms: number | null; costPerDecision: number | null }> {
    const windowStart = offsetDays + windowDays;
    const windowEnd = offsetDays;

    // Accept rate from agent_decisions
    const pvFilter = promptVersion != null
      ? `AND prompt_version = '${promptVersion.replace(/'/g, "''")}'`
      : `AND prompt_version IS NULL`;

    const decisionRows = await query<{ total: number; approved: number; declined: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved,
         SUM(CASE WHEN approval_status = 'declined' THEN 1 ELSE 0 END) as declined
       FROM agent_decisions
       WHERE call_type = ?
         ${pvFilter}
         AND created_at >= DATEADD(day, -${windowStart}, GETUTCDATE())
         AND created_at < DATEADD(day, -${windowEnd}, GETUTCDATE())`,
      [callType],
    );

    const total = decisionRows[0]?.total ?? 0;
    const approved = decisionRows[0]?.approved ?? 0;
    const declined = decisionRows[0]?.declined ?? 0;
    const reviewedCount = approved + declined;
    const acceptRate = reviewedCount > 0 ? approved / reviewedCount : null;

    // P95 latency from agent_decisions
    const latencyRows = await query<{ p95: number | null }>(
      `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
         OVER () as p95
       FROM agent_decisions
       WHERE call_type = ?
         ${pvFilter}
         AND latency_ms IS NOT NULL
         AND created_at >= DATEADD(day, -${windowStart}, GETUTCDATE())
         AND created_at < DATEADD(day, -${windowEnd}, GETUTCDATE())`,
      [callType],
    );
    const latencyP95Ms = latencyRows[0]?.p95 != null ? Math.round(latencyRows[0].p95) : null;

    // Cost per decision from agent_llm_calls
    const providerFilter = provider != null
      ? `AND provider = '${provider.replace(/'/g, "''")}'`
      : `AND provider IS NULL`;

    const costRows = await query<{ avg_cost: number | null }>(
      `SELECT AVG(estimated_cost) as avg_cost
       FROM agent_llm_calls
       WHERE call_type = ?
         ${providerFilter}
         AND created_at >= DATEADD(day, -${windowStart}, GETUTCDATE())
         AND created_at < DATEADD(day, -${windowEnd}, GETUTCDATE())`,
      [callType],
    );
    const costPerDecision = costRows[0]?.avg_cost ?? null;

    return { decisionCount: total, acceptRate, latencyP95Ms, costPerDecision };
  }

  private computeSeverity(
    current: { acceptRate: number | null; latencyP95Ms: number | null; costPerDecision: number | null },
    baseline: { acceptRate: number | null; latencyP95Ms: number | null; costPerDecision: number | null },
  ): 'none' | 'warn' | 'alert' {
    const acceptDelta = parseFloat(this.settings.get('agent_drift_alert_accept_delta') || '0.10');
    const latencyMult = parseFloat(this.settings.get('agent_drift_alert_latency_multiplier') || '1.5');
    const costMult = parseFloat(this.settings.get('agent_drift_alert_cost_multiplier') || '1.3');

    let isAlert = false;
    let isWarn = false;

    if (current.acceptRate != null && baseline.acceptRate != null && baseline.acceptRate > 0) {
      const drop = baseline.acceptRate - current.acceptRate;
      if (drop >= acceptDelta) isAlert = true;
      else if (drop >= acceptDelta / 2) isWarn = true;
    }

    if (current.latencyP95Ms != null && baseline.latencyP95Ms != null && baseline.latencyP95Ms > 0) {
      const ratio = current.latencyP95Ms / baseline.latencyP95Ms;
      if (ratio >= latencyMult) isAlert = true;
      else if (ratio >= 1 + (latencyMult - 1) / 2) isWarn = true;
    }

    if (current.costPerDecision != null && baseline.costPerDecision != null && baseline.costPerDecision > 0) {
      const ratio = current.costPerDecision / baseline.costPerDecision;
      if (ratio >= costMult) isAlert = true;
      else if (ratio >= 1 + (costMult - 1) / 2) isWarn = true;
    }

    if (isAlert) return 'alert';
    if (isWarn) return 'warn';
    return 'none';
  }
}
