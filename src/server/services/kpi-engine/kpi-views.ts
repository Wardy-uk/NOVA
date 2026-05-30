/**
 * KPI Recovery — Clean-Sheet View Read Models (P3-WP1)
 *
 * Phase 3 of the clean-sheet KPI system. Everything here is NEW and read-only,
 * running in parallel with the untouched legacy KPI system. It composes the
 * payloads the three Phase 3 dashboards and the rewired wallboards consume,
 * sourced ENTIRELY from the clean-sheet tables (kpi_snapshots / kpi_daily /
 * kpi_agent_daily / kpi_eod_snapshot in the NOVA main pool) via the Phase 1
 * engine and the Phase 2 EOD service. It never touches the legacy KPI pipeline
 * pool, the techservicesjsm tables, or any forbidden table.
 *
 * Honesty rules (design constraint):
 *   - Manual / non-Jira spaces (CS, KAM, ONBOARD, COMMS) have no computed
 *     capture in the current phases. They are surfaced with isJiraSpace=false
 *     and captured=false rather than faked with zeros.
 *   - A Jira space with no snapshot AND no daily row for a metric returns
 *     value=null (rendered as "—"), never a fabricated 0.
 *   - "Current" value prefers the latest live snapshot; if a metric has never
 *     snapshotted it falls back to the most recent frozen daily value, with the
 *     timestamp it came from exposed so staleness is visible.
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §6 (Views), §9 (read endpoints).
 */
import { query } from '../database.js';
import type { KpiEngine } from './kpi-engine.js';
import { KpiEodService, type RagStatus } from './kpi-eod.js';

/** A per-space metric binding joined with its definition (incl. view flags). */
export interface SpaceMetricBinding {
  metricKey: string;
  displayName: string;
  category: string;
  valueType: string;
  direction: string;
  source: string;
  isAgentLevel: boolean;
  targetValue: number | null;
  amberBand: number | null;
  displayOrder: number;
  showOnSlt: boolean;
  showOnWallboard: boolean;
}

/** A metric resolved to its current value (live-or-daily) with RAG. */
export interface ResolvedMetric {
  metricKey: string;
  displayName: string;
  category: string;
  valueType: string;
  direction: string;
  source: string;
  value: number | null;
  target: number | null;
  rag: RagStatus | null;
  /** ISO timestamp (snapshot) or YYYY-MM-DD (daily) the value came from; null if none. */
  asOf: string | null;
  /** 'snapshot' | 'daily' | null — provenance of the current value. */
  valueSource: 'snapshot' | 'daily' | null;
}

export interface SltSpaceCard {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  timezone: string;
  isJiraSpace: boolean;
  /** True once at least one clean-sheet value (snapshot or daily) exists. */
  hasData: boolean;
  /** Honest note for empty/manual spaces. */
  note: string | null;
  metrics: ResolvedMetric[];
}

export interface SltSummary {
  generatedAt: string;
  spaces: SltSpaceCard[];
}

export interface TeamTierMetric {
  tierName: string;
  metricKey: string;
  value: number | null;
  asOf: string | null;
}

export interface TeamDashboard {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  timezone: string;
  isJiraSpace: boolean;
  hasTiers: boolean;
  hasData: boolean;
  note: string | null;
  generatedAt: string;
  /** All enabled metrics with current value/target/RAG + 7-day daily history. */
  metrics: Array<ResolvedMetric & { history: Array<{ date: string; value: number }> }>;
  /** Per-tier latest values for tier-aware metrics (NT only). */
  tiers: Array<{ tierName: string; metrics: Array<{ metricKey: string; value: number | null; asOf: string | null }> }>;
  /** Most recent frozen EOD ticket-state snapshot for the space. */
  eodSnapshot: {
    date: string | null;
    snapshotTime: string | null;
    totalTickets: number;
    overSla: number;
    groups: Array<{ tierName: string | null; status: string | null; requestType: string | null; ticketCount: number; overSlaCount: number }>;
  } | null;
}

export interface LeaderboardAgent {
  agentId: string;
  agentName: string | null;
  /** metric_key -> value for the report date. */
  metrics: Record<string, number>;
  /** Mean attainment vs target across target-bearing metrics (0–150%), null if none. */
  compositeScore: number | null;
  rank: number | null;
}

export interface Leaderboard {
  spaceKey: string;
  displayName: string;
  isJiraSpace: boolean;
  hasData: boolean;
  note: string | null;
  /** The report date the scores are for (most recent with agent data ≤ requested). */
  reportDate: string | null;
  /** Agent-level metric definitions in scope (for column headers + formatting). */
  metricDefs: Array<{ metricKey: string; displayName: string; valueType: string; direction: string; target: number | null }>;
  agents: LeaderboardAgent[];
}

interface SnapshotRow { metricKey: string; tierName: string | null; value: number; snapshotAt: Date | string; }
interface DailyLatestRow { metric_key: string; tier_name: string | null; value: number; report_date: string | Date; }

function isoOf(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
function dateKey(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}

export class KpiViewsService {
  private readonly eod: KpiEodService;
  constructor(private readonly engine: KpiEngine) {
    this.eod = new KpiEodService(engine);
  }

  /** Enabled metric bindings for a space, including the SLT / wallboard view flags. */
  async getSpaceMetricBindings(spaceKey: string): Promise<SpaceMetricBinding[]> {
    const rows = await query<{
      metric_key: string; display_name: string; category: string; value_type: string;
      direction: string; source: string; is_agent_level: number | boolean;
      target_value: number | null; amber_band: number | null; display_order: number | null;
      show_on_slt_view: number | boolean; show_on_wallboard: number | boolean;
    }>(
      `SELECT d.metric_key, d.display_name, d.category, d.value_type, d.direction, d.source,
              d.is_agent_level, sm.target_value, sm.amber_band, sm.display_order,
              sm.show_on_slt_view, sm.show_on_wallboard
       FROM kpi_space_metrics sm
       JOIN kpi_metric_definitions d ON d.metric_key = sm.metric_key
       WHERE sm.space_key = ? AND sm.is_enabled = 1 AND d.is_active = 1
       ORDER BY sm.display_order, d.metric_key`,
      [spaceKey],
    );
    return rows.map((r) => ({
      metricKey: r.metric_key,
      displayName: r.display_name,
      category: r.category,
      valueType: r.value_type,
      direction: r.direction,
      source: r.source,
      isAgentLevel: r.is_agent_level === true || r.is_agent_level === 1,
      targetValue: r.target_value,
      amberBand: r.amber_band,
      displayOrder: r.display_order ?? 0,
      showOnSlt: r.show_on_slt_view === true || r.show_on_slt_view === 1,
      showOnWallboard: r.show_on_wallboard === true || r.show_on_wallboard === 1,
    }));
  }

  /** Latest space-level (tier_name NULL) frozen daily value per metric. */
  private async getLatestDailyByMetric(spaceKey: string): Promise<Map<string, { value: number; reportDate: string }>> {
    const rows = await query<DailyLatestRow>(
      `WITH ranked AS (
         SELECT metric_key, tier_name, value, report_date,
                ROW_NUMBER() OVER (PARTITION BY metric_key ORDER BY report_date DESC) AS rn
         FROM kpi_daily WHERE space_key = ? AND tier_name IS NULL
       )
       SELECT metric_key, tier_name, value, report_date FROM ranked WHERE rn = 1`,
      [spaceKey],
    );
    const map = new Map<string, { value: number; reportDate: string }>();
    for (const r of rows) map.set(r.metric_key, { value: r.value, reportDate: dateKey(r.report_date) });
    return map;
  }

  /** Resolve current value for each binding: live snapshot first, then latest daily. */
  private resolveCurrent(
    bindings: SpaceMetricBinding[],
    snapshots: SnapshotRow[],
    latestDaily: Map<string, { value: number; reportDate: string }>,
  ): ResolvedMetric[] {
    const snapByMetric = new Map<string, SnapshotRow>();
    for (const s of snapshots) {
      if (s.tierName) continue; // space-level only here
      snapByMetric.set(s.metricKey, s);
    }
    return bindings.map((b) => {
      let value: number | null = null;
      let asOf: string | null = null;
      let valueSource: 'snapshot' | 'daily' | null = null;
      const snap = snapByMetric.get(b.metricKey);
      if (snap) {
        value = snap.value;
        asOf = isoOf(snap.snapshotAt);
        valueSource = 'snapshot';
      } else {
        const d = latestDaily.get(b.metricKey);
        if (d) { value = d.value; asOf = d.reportDate; valueSource = 'daily'; }
      }
      const rag = value === null ? null : this.eod.computeRag(value, b.targetValue, b.amberBand, b.direction);
      return {
        metricKey: b.metricKey,
        displayName: b.displayName,
        category: b.category,
        valueType: b.valueType,
        direction: b.direction,
        source: b.source,
        value,
        target: b.targetValue,
        rag,
        asOf,
        valueSource,
      };
    });
  }

  /**
   * SLT cross-space dashboard (design §6.1). One card per space showing the
   * metrics flagged show_on_slt_view, resolved to current value + RAG. Manual /
   * non-Jira spaces are surfaced honestly (no fabricated values).
   */
  async getSltSummary(): Promise<SltSummary> {
    const spaces = await this.engine.listSpaces();
    const cards: SltSpaceCard[] = [];
    for (const space of spaces) {
      const bindings = (await this.getSpaceMetricBindings(space.spaceKey)).filter((b) => b.showOnSlt);
      if (!space.isJiraSpace) {
        cards.push({
          spaceKey: space.spaceKey,
          displayName: space.displayName,
          ownerName: space.ownerName,
          timezone: space.timezone,
          isJiraSpace: false,
          hasData: false,
          note: 'Manual / non-Jira team — KPIs captured via manual entry (not in computed scope yet).',
          metrics: bindings.map((b) => ({
            metricKey: b.metricKey, displayName: b.displayName, category: b.category,
            valueType: b.valueType, direction: b.direction, source: b.source,
            value: null, target: b.targetValue, rag: null, asOf: null, valueSource: null,
          })),
        });
        continue;
      }
      const snapshots = (await this.engine.getLatestSnapshot(space.spaceKey)) as unknown as SnapshotRow[];
      const latestDaily = await this.getLatestDailyByMetric(space.spaceKey);
      const metrics = this.resolveCurrent(bindings, snapshots, latestDaily);
      const hasData = metrics.some((m) => m.value !== null);
      cards.push({
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        ownerName: space.ownerName,
        timezone: space.timezone,
        isJiraSpace: true,
        hasData,
        note: hasData ? null : 'No clean-sheet data captured yet for this space (sync coverage may be sparse).',
        metrics,
      });
    }
    return { generatedAt: new Date().toISOString(), spaces: cards };
  }

  /**
   * Team dashboard for one space (design §6.2). Full enabled-metric grid with
   * current value/target/RAG + 7-day daily history, per-tier breakdown (NT), and
   * the most recent frozen EOD ticket-state snapshot.
   */
  async getTeamDashboard(spaceKey: string): Promise<TeamDashboard | null> {
    const space = await this.engine.getSpaceConfig(spaceKey);
    if (!space) return null;
    const bindings = await this.getSpaceMetricBindings(spaceKey);

    const base = {
      spaceKey: space.spaceKey,
      displayName: space.displayName,
      ownerName: space.ownerName,
      timezone: space.timezone,
      isJiraSpace: space.isJiraSpace,
      hasTiers: space.hasTiers,
      generatedAt: new Date().toISOString(),
    };

    if (!space.isJiraSpace) {
      return {
        ...base,
        hasData: false,
        note: 'Manual / non-Jira team — KPIs captured via manual entry (not in computed scope yet).',
        metrics: bindings.map((b) => ({
          metricKey: b.metricKey, displayName: b.displayName, category: b.category,
          valueType: b.valueType, direction: b.direction, source: b.source,
          value: null, target: b.targetValue, rag: null, asOf: null, valueSource: null, history: [],
        })),
        tiers: [],
        eodSnapshot: null,
      };
    }

    const snapshots = (await this.engine.getLatestSnapshot(spaceKey)) as unknown as SnapshotRow[];
    const latestDaily = await this.getLatestDailyByMetric(spaceKey);
    const resolved = this.resolveCurrent(bindings, snapshots, latestDaily);

    // 7-day (space-level) daily history per metric for sparklines.
    const historyRows = await query<{ metric_key: string; report_date: string | Date; value: number }>(
      `SELECT metric_key, report_date, value
       FROM kpi_daily
       WHERE space_key = ? AND tier_name IS NULL
         AND report_date >= DATEADD(day, -7, CAST(GETUTCDATE() AS DATE))
       ORDER BY report_date`,
      [spaceKey],
    );
    const histByMetric = new Map<string, Array<{ date: string; value: number }>>();
    for (const r of historyRows) {
      const arr = histByMetric.get(r.metric_key) ?? [];
      arr.push({ date: dateKey(r.report_date), value: r.value });
      histByMetric.set(r.metric_key, arr);
    }
    const metrics = resolved.map((m) => ({ ...m, history: histByMetric.get(m.metricKey) ?? [] }));

    // Per-tier latest snapshot values (tier-aware metrics).
    const tiers: TeamDashboard['tiers'] = [];
    if (space.hasTiers) {
      const tierDefs = await this.engine.getTierDefinitions(spaceKey);
      const tierSnap = new Map<string, Array<{ metricKey: string; value: number; snapshotAt: string }>>();
      for (const s of snapshots) {
        if (!s.tierName) continue;
        const arr = tierSnap.get(s.tierName) ?? [];
        arr.push({ metricKey: s.metricKey, value: s.value, snapshotAt: isoOf(s.snapshotAt) });
        tierSnap.set(s.tierName, arr);
      }
      for (const td of tierDefs) {
        const arr = tierSnap.get(td.tierName) ?? [];
        tiers.push({
          tierName: td.tierName,
          metrics: arr.map((a) => ({ metricKey: a.metricKey, value: a.value, asOf: a.snapshotAt })),
        });
      }
    }

    // Most recent frozen EOD ticket-state snapshot.
    const eodDateRow = await query<{ d: string | Date }>(
      `SELECT TOP 1 snapshot_date AS d FROM kpi_eod_snapshot WHERE space_key = ? ORDER BY snapshot_date DESC`,
      [spaceKey],
    );
    let eodSnapshot: TeamDashboard['eodSnapshot'] = null;
    if (eodDateRow[0]) {
      const d = dateKey(eodDateRow[0].d);
      const eodRows = await query<{ snapshot_time: string; tier_name: string | null; status: string | null; request_type: string | null; ticket_count: number; over_sla_count: number }>(
        `SELECT snapshot_time, tier_name, status, request_type, ticket_count, over_sla_count
         FROM kpi_eod_snapshot WHERE space_key = ? AND snapshot_date = ?`,
        [spaceKey, d],
      );
      eodSnapshot = {
        date: d,
        snapshotTime: eodRows[0]?.snapshot_time ?? null,
        totalTickets: eodRows.reduce((s, r) => s + (r.ticket_count || 0), 0),
        overSla: eodRows.reduce((s, r) => s + (r.over_sla_count || 0), 0),
        groups: eodRows.map((r) => ({
          tierName: r.tier_name, status: r.status, requestType: r.request_type,
          ticketCount: r.ticket_count, overSlaCount: r.over_sla_count,
        })),
      };
    }

    const hasData = metrics.some((m) => m.value !== null) || eodSnapshot !== null;
    return {
      ...base,
      hasData,
      note: hasData ? null : 'No clean-sheet data captured yet for this space (sync coverage may be sparse).',
      metrics,
      tiers,
      eodSnapshot,
    };
  }

  /**
   * Agent scorecard / leaderboard for a space (design §6.3, §9). Reads the most
   * recent frozen kpi_agent_daily rows (≤ requested date) and ranks agents by a
   * composite attainment score across target-bearing agent metrics.
   *
   * Composite = mean attainment across the agent's metrics that have a target,
   * where attainment is direction-aware (higher-is-better: value/target; lower-
   * is-better: target/value), clamped to [0, 1.5] and expressed as a percentage.
   * Agents with no target-bearing metric get a null composite and rank last.
   */
  async getLeaderboard(spaceKey: string, date?: string): Promise<Leaderboard | null> {
    const space = await this.engine.getSpaceConfig(spaceKey);
    if (!space) return null;

    const bindings = await this.getSpaceMetricBindings(spaceKey);
    const agentDefs = bindings.filter((b) => b.isAgentLevel);
    const metricDefs = agentDefs.map((b) => ({
      metricKey: b.metricKey, displayName: b.displayName, valueType: b.valueType,
      direction: b.direction, target: b.targetValue,
    }));

    const base = {
      spaceKey: space.spaceKey,
      displayName: space.displayName,
      isJiraSpace: space.isJiraSpace,
      metricDefs,
    };

    if (!space.isJiraSpace) {
      return { ...base, hasData: false, note: 'Manual / non-Jira team — no per-agent computed scores.', reportDate: null, agents: [] };
    }

    // Most recent report date with agent rows (≤ requested date if given).
    const dateRow = await query<{ d: string | Date }>(
      date
        ? `SELECT TOP 1 report_date AS d FROM kpi_agent_daily WHERE space_key = ? AND report_date <= ? ORDER BY report_date DESC`
        : `SELECT TOP 1 report_date AS d FROM kpi_agent_daily WHERE space_key = ? ORDER BY report_date DESC`,
      date ? [spaceKey, date] : [spaceKey],
    );
    if (!dateRow[0]) {
      return { ...base, hasData: false, note: 'No agent-level data captured yet for this space.', reportDate: null, agents: [] };
    }
    const reportDate = dateKey(dateRow[0].d);

    const rows = await query<{ metric_key: string; agent_id: string; agent_name: string | null; value: number }>(
      `SELECT metric_key, agent_id, agent_name, value
       FROM kpi_agent_daily WHERE space_key = ? AND report_date = ?`,
      [spaceKey, reportDate],
    );

    const targetByMetric = new Map<string, { target: number | null; direction: string }>();
    for (const b of agentDefs) targetByMetric.set(b.metricKey, { target: b.targetValue, direction: b.direction });

    const byAgent = new Map<string, LeaderboardAgent>();
    for (const r of rows) {
      let a = byAgent.get(r.agent_id);
      if (!a) { a = { agentId: r.agent_id, agentName: r.agent_name, metrics: {}, compositeScore: null, rank: null }; byAgent.set(r.agent_id, a); }
      a.metrics[r.metric_key] = r.value;
    }

    for (const a of byAgent.values()) {
      const attainments: number[] = [];
      for (const [mk, v] of Object.entries(a.metrics)) {
        const def = targetByMetric.get(mk);
        if (!def || def.target === null || def.target === 0) continue;
        let att: number;
        if (def.direction === 'higher') att = v / def.target;
        else if (def.direction === 'lower') att = v === 0 ? 1.5 : def.target / v;
        else continue;
        attainments.push(Math.max(0, Math.min(1.5, att)));
      }
      a.compositeScore = attainments.length ? Math.round((attainments.reduce((s, x) => s + x, 0) / attainments.length) * 1000) / 10 : null;
    }

    const agents = [...byAgent.values()].sort((x, y) => {
      if (x.compositeScore === null && y.compositeScore === null) return (x.agentName ?? '').localeCompare(y.agentName ?? '');
      if (x.compositeScore === null) return 1;
      if (y.compositeScore === null) return -1;
      return y.compositeScore - x.compositeScore;
    });
    agents.forEach((a, i) => { a.rank = a.compositeScore === null ? null : i + 1; });

    return { ...base, hasData: agents.length > 0, note: agents.length ? null : 'No agent-level data captured for this date.', reportDate, agents };
  }
}
