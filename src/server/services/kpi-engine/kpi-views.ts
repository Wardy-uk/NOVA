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
import { hasComputer } from './metric-computers.js';

/** A per-space metric binding joined with its definition (incl. view flags). */
export interface SpaceMetricBinding {
  metricKey: string;
  displayName: string;
  category: string;
  valueType: string;
  direction: string;
  source: string;
  computationKey: string | null;
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
  /**
   * True when this is a computed metric whose computation_key has NO registered
   * computer (and no live/manual source), so it can never carry a value in the
   * current build. Lets the UI render "not yet wired" honestly instead of an
   * ambiguous "—" that reads as missing/late data. Always false for sourced
   * (manual/api) or implemented computed metrics.
   */
  unwired: boolean;
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

/**
 * The clean-sheet QA metric family wired in KPX-WP3 (source-providers.ts):
 *   qa_score_avg     ← jira_qa_results     (KPI / techservicesjsm pool)
 *   golden_rules_avg ← Jira_QA_GoldenRules (KPI / techservicesjsm pool)
 * The QA parity surface is scoped to exactly these — no other metric family.
 */
export const QA_METRIC_KEYS = ['qa_score_avg', 'golden_rules_avg'] as const;

/** One agent's QA-family values for the latest report date that has agent rows. */
export interface QaAgentRow {
  agentId: string;
  agentName: string | null;
  /** metric_key -> value (only the QA family); absent key = no row for that metric. */
  metrics: Record<string, number>;
}

/** Per-space QA parity card: the QA family resolved + per-agent breakdown. */
export interface QaParitySpace {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  isJiraSpace: boolean;
  /** True once any QA-family value (space-level or agent-level) exists. */
  hasData: boolean;
  /** Honest note when the space carries QA metrics but has no rows yet. */
  note: string | null;
  /** The QA-family metrics resolved to current value/target/RAG + 7-day history. */
  metrics: Array<ResolvedMetric & { history: Array<{ date: string; value: number }> }>;
  /** Report date the agent rows are for (latest with QA agent data); null if none. */
  agentReportDate: string | null;
  /** Per-agent QA-family values for that date. */
  agents: QaAgentRow[];
}

export interface QaParitySummary {
  generatedAt: string;
  qaMetricKeys: string[];
  /** Only spaces that actually carry the QA family (enabled binding). */
  spaces: QaParitySpace[];
}

/**
 * The clean-sheet escalation metric family wired across KPX-WP3/WP5 (escalation
 * source) and KPX-WP5 (rejection / bounce-back source):
 *   escalation_rate     ← escalation_log (NOVA main pool, non-rejection rows)
 *   escalation_accuracy ← escalation_log escalations vs captured rejections
 *   rejection_rate      ← escalation_log rejection (bounce-back) rows
 * The Escalations parity surface is scoped to exactly these three — no other
 * metric family. `escalation_accuracy` / `rejection_rate` depend on the explicit
 * rejection capture path: until at least one bounce-back has been captured they
 * resolve to null (rendered "—", wired-but-awaiting-capture), never a fabricated
 * 100% / 0%.
 */
export const ESCALATION_METRIC_KEYS = ['escalation_rate', 'escalation_accuracy', 'rejection_rate'] as const;

/** One agent's escalation-family values for the latest report date that has agent rows. */
export interface EscalationAgentRow {
  agentId: string;
  agentName: string | null;
  /** metric_key -> value (only the escalation family); absent key = no row for that metric. */
  metrics: Record<string, number>;
}

/** Per-space Escalations parity card: the family resolved + per-agent breakdown. */
export interface EscalationParitySpace {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  isJiraSpace: boolean;
  /** True once any escalation-family value (space-level or agent-level) exists. */
  hasData: boolean;
  /** Honest note when the space carries the family but has no rows yet. */
  note: string | null;
  /** The escalation-family metrics resolved to current value/target/RAG + 7-day history. */
  metrics: Array<ResolvedMetric & { history: Array<{ date: string; value: number }> }>;
  /** Report date the agent rows are for (latest with escalation agent data); null if none. */
  agentReportDate: string | null;
  /** Per-agent escalation-family values for that date. */
  agents: EscalationAgentRow[];
}

export interface EscalationParitySummary {
  generatedAt: string;
  escalationMetricKeys: string[];
  /** Only spaces that actually carry the escalation family (enabled binding). */
  spaces: EscalationParitySpace[];
}

/**
 * Trends parity surface (KPX-WP7). A clean-sheet, per-space multi-day trend view
 * over the SAME frozen `kpi_daily` history every other Phase 3 view reads — but
 * across a configurable multi-day window (default 30 days) and with real trend
 * analytics, going beyond the thin fixed 7-day sparkline the Team / QA /
 * Escalations grids carry.
 *
 * A metric is classified honestly into one of three trend states, never faked:
 *   - 'supported'   : it has ≥2 distinct frozen daily points in the window, so a
 *                     real multi-day trend (line + delta + direction) can be drawn.
 *   - 'awaiting'    : it is wired (has a value path) but has <2 frozen daily points
 *                     yet, so there is not enough history to trend — surfaced as
 *                     "awaiting history", never a fabricated flat/straight line.
 *   - 'unsupported' : it is a computed metric with no registered computer (the
 *                     existing `unwired` flag), so it can never carry history in
 *                     this build — surfaced as "not wired", never a fabricated line.
 */
export type TrendStatus = 'supported' | 'awaiting' | 'unsupported';

export interface TrendPoint { date: string; value: number; }

/** Direction-aware summary of a metric's movement across the window. */
export interface TrendStats {
  /** Number of frozen daily points in the window. */
  points: number;
  first: number;
  last: number;
  min: number;
  max: number;
  /** last − first (rounded). */
  deltaAbs: number;
  /** Percentage change first→last; null when first is 0 (undefined %). */
  deltaPct: number | null;
  /** True if the latest value is better than the first per the metric's direction; false if worse; null if flat or direction is neutral. */
  improving: boolean | null;
}

export interface TrendMetric extends ResolvedMetric {
  history: TrendPoint[];
  trendStatus: TrendStatus;
  /** Populated only when trendStatus === 'supported'. */
  stats: TrendStats | null;
  /** Honest reason string for awaiting / unsupported; null when supported. */
  trendNote: string | null;
}

export interface TrendsSpace {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  timezone: string;
  isJiraSpace: boolean;
  /** The window actually used (clamped). */
  windowDays: number;
  /** True once at least one metric has a real multi-day (supported) trend. */
  hasData: boolean;
  /** Honest note when nothing is trendable yet. */
  note: string | null;
  /** Metrics with real multi-day history (a trend can be drawn). */
  supported: TrendMetric[];
  /** Metrics with no trend yet — awaiting history or structurally unwired. Surfaced honestly, never fabricated. */
  unsupported: TrendMetric[];
}

/**
 * Agent Breaches parity surface (KPX-WP8). A clean-sheet, per-agent breach view
 * over the SAME frozen `kpi_agent_daily` rows the Agent Scorecard reads — but
 * oriented around *breaches* (failing a target) rather than ranking.
 *
 * A metric is "breach-evaluable" only when the clean-sheet platform can honestly
 * judge an agent against a standard: it is agent-level, has a registered computer
 * (so it can carry a real per-agent value), carries a target, and has a RAG-able
 * direction ('higher'/'lower'). For each such metric the existing RAG logic
 * decides the per-agent breach state:
 *   - red   → breach   (failing the target beyond the amber band)
 *   - amber → at-risk  (within the amber band of the target)
 *   - green → met
 * No metric without a computer/target/direction is ever shown as a breach, and a
 * missing per-agent value renders "—" (null), never a fabricated 0 / pass / fail.
 *
 * The legacy Agent-Breaches board (live per-agent ticket health: open-over-SLA
 * count, not-updated-today count, oldest open ticket age) draws on per-agent LIVE
 * queue counts the clean-sheet agent path does not capture — it freezes per-agent
 * SLA *attainment %*, not per-agent live ticket counts. Those families are
 * surfaced as honestly unsupported rather than fabricated.
 */
export type AgentBreachStatus = 'breach' | 'at_risk' | 'clear' | 'no_data';

/** A breach-evaluable agent-level metric (computer + target + RAG-able direction). */
export interface AgentBreachMetricDef {
  metricKey: string;
  displayName: string;
  valueType: string;
  direction: string;
  target: number | null;
  amberBand: number | null;
}

/** One agent's value + RAG for a single breach-evaluable metric. */
export interface AgentBreachCell {
  metricKey: string;
  value: number | null;
  rag: RagStatus | null;
}

/** One agent's breach row for the latest frozen date. */
export interface AgentBreachRow {
  agentId: string;
  agentName: string | null;
  status: AgentBreachStatus;
  /** Count of red (breaching) metrics. */
  breachCount: number;
  /** Count of amber (at-risk) metrics. */
  atRiskCount: number;
  cells: AgentBreachCell[];
}

/** A legacy breach family the clean-sheet agent path cannot honestly produce. */
export interface UnsupportedBreachFamily {
  key: string;
  label: string;
  reason: string;
}

/** Per-space Agent Breaches card: breach-evaluable metric defs + per-agent rows. */
export interface AgentBreachesSpace {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  isJiraSpace: boolean;
  /** True once at least one frozen per-agent breach value exists. */
  hasData: boolean;
  /** Honest note when the space carries breach-evaluable metrics but has no rows yet. */
  note: string | null;
  /** Report date the agent rows are for (latest frozen with agent data); null if none. */
  reportDate: string | null;
  /** The breach-evaluable agent metric definitions in scope (column headers + targets). */
  metricDefs: AgentBreachMetricDef[];
  /** Per-agent breach rows, breaching agents first. */
  agents: AgentBreachRow[];
  summary: {
    agentsBreaching: number;
    agentsAtRisk: number;
    agentsClear: number;
    /** metric_key -> number of agents breaching (red) on it. */
    breachesByMetric: Record<string, number>;
  };
}

export interface AgentBreachesSummary {
  generatedAt: string;
  /** Legacy live-queue breach families honestly unsupported by the clean-sheet agent path. */
  unsupportedFamilies: UnsupportedBreachFamily[];
  /** Only Jira spaces that carry ≥1 breach-evaluable agent metric. */
  spaces: AgentBreachesSpace[];
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
      direction: string; source: string; computation_key: string | null; is_agent_level: number | boolean;
      target_value: number | null; amber_band: number | null; display_order: number | null;
      show_on_slt_view: number | boolean; show_on_wallboard: number | boolean;
    }>(
      `SELECT d.metric_key, d.display_name, d.category, d.value_type, d.direction, d.source,
              d.computation_key, d.is_agent_level, sm.target_value, sm.amber_band, sm.display_order,
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
      computationKey: r.computation_key,
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
      // A computed metric with no registered computer can never carry a value in
      // this build — flag it so the value is null *and* honestly labelled, rather
      // than being mistaken for late/missing data that might still arrive.
      const unwired = b.source === 'computed' && !hasComputer(b.computationKey ?? b.metricKey);
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
        unwired,
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
      const allBindings = await this.getSpaceMetricBindings(space.spaceKey);
      // Jira spaces curate a headline SLT subset via show_on_slt_view. Manual /
      // non-Jira teams have NO show_on_slt_view flags seeded, so filtering by it
      // leaves them with zero bindings — which made the SLT card report "no KPIs
      // entered yet" even when kpi_daily holds real manual values (while the Team
      // Dashboard, which uses the full enabled set, showed them correctly). For
      // manual spaces, fall back to the full enabled set so SLT resolves the same
      // daily data the Team view does. Honest empty state is preserved: empty
      // manual spaces still yield all-null values → hasData=false → empty note.
      const bindings = space.isJiraSpace ? allBindings.filter((b) => b.showOnSlt) : allBindings;
      // Manual / non-Jira spaces never snapshot, but their manual entries are
      // promoted into kpi_daily — so resolve them from the latest frozen daily
      // exactly like Jira spaces (with no live snapshot layer). This is the fix
      // for manual data being invisible on the SLT view after entry/import.
      const snapshots = space.isJiraSpace
        ? ((await this.engine.getLatestSnapshot(space.spaceKey)) as unknown as SnapshotRow[])
        : [];
      const latestDaily = await this.getLatestDailyByMetric(space.spaceKey);
      const metrics = this.resolveCurrent(bindings, snapshots, latestDaily);
      const hasData = metrics.some((m) => m.value !== null);
      cards.push({
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        ownerName: space.ownerName,
        timezone: space.timezone,
        isJiraSpace: space.isJiraSpace,
        hasData,
        note: hasData
          ? null
          : space.isJiraSpace
            ? 'No clean-sheet data captured yet for this space (sync coverage may be sparse).'
            : 'Manual / non-Jira team — no KPIs entered yet for the latest available date.',
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

    // Manual / non-Jira spaces never snapshot, never have tiers, and never carry a
    // computed EOD ticket-state snapshot — but their manual entries ARE promoted
    // into kpi_daily. So resolve them through the same daily path (with no live
    // snapshot layer); the tier/EOD sections below naturally yield empty for them.
    // This is the fix for manual data being invisible on the Team Dashboard.
    const snapshots = space.isJiraSpace
      ? ((await this.engine.getLatestSnapshot(spaceKey)) as unknown as SnapshotRow[])
      : [];
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
      note: hasData
        ? null
        : space.isJiraSpace
          ? 'No clean-sheet data captured yet for this space (sync coverage may be sparse).'
          : 'Manual / non-Jira team — no KPIs entered yet for the latest available date.',
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

  /**
   * QA parity surface (KPX-WP4). A focused cross-space view of the now-wired QA
   * metric family (`qa_score_avg`, `golden_rules_avg`) — and ONLY that family.
   *
   * Reads the SAME clean-sheet path as every other Phase 3 view: current value
   * resolves live-snapshot-first then latest frozen daily (kpi_snapshots /
   * kpi_daily), 7-day daily history for sparklines, and per-agent values from the
   * frozen kpi_agent_daily rows. It never touches the legacy KPI pipeline, the
   * QA source tables directly, or any forbidden table — the QA values arrive
   * pre-computed through the engine's source-context wiring.
   *
   * Honesty: only spaces with an enabled QA binding appear at all. Where a QA
   * metric has no upstream rows it resolves to value=null (rendered "—"), never a
   * fabricated 0 — exactly the null-not-zero behaviour the rest of the platform
   * uses. A space carrying the family but holding no QA value yet is surfaced
   * with hasData=false and an honest note.
   */
  async getQaParity(): Promise<QaParitySummary> {
    const qaKeys = [...QA_METRIC_KEYS] as string[];
    const inList = qaKeys.map(() => '?').join(', ');
    const spaces = await this.engine.listSpaces();
    const cards: QaParitySpace[] = [];

    for (const space of spaces) {
      const bindings = await this.getSpaceMetricBindings(space.spaceKey);
      const qaBindings = bindings.filter((b) => qaKeys.includes(b.metricKey));
      if (qaBindings.length === 0) continue; // space does not carry the QA family — skip entirely

      // Current value: same live-snapshot-then-daily resolution as Team/SLT views.
      const snapshots = space.isJiraSpace
        ? ((await this.engine.getLatestSnapshot(space.spaceKey)) as unknown as SnapshotRow[])
        : [];
      const latestDaily = await this.getLatestDailyByMetric(space.spaceKey);
      const resolved = this.resolveCurrent(qaBindings, snapshots, latestDaily);

      // 7-day space-level daily history for the QA family only.
      const historyRows = await query<{ metric_key: string; report_date: string | Date; value: number }>(
        `SELECT metric_key, report_date, value
         FROM kpi_daily
         WHERE space_key = ? AND tier_name IS NULL AND metric_key IN (${inList})
           AND report_date >= DATEADD(day, -7, CAST(GETUTCDATE() AS DATE))
         ORDER BY report_date`,
        [space.spaceKey, ...qaKeys],
      );
      const histByMetric = new Map<string, Array<{ date: string; value: number }>>();
      for (const r of historyRows) {
        const arr = histByMetric.get(r.metric_key) ?? [];
        arr.push({ date: dateKey(r.report_date), value: r.value });
        histByMetric.set(r.metric_key, arr);
      }
      const metrics = resolved.map((m) => ({ ...m, history: histByMetric.get(m.metricKey) ?? [] }));

      // Per-agent QA values for the latest frozen date that actually has QA agent rows.
      let agentReportDate: string | null = null;
      let agents: QaAgentRow[] = [];
      if (space.isJiraSpace) {
        const dateRow = await query<{ d: string | Date }>(
          `SELECT TOP 1 report_date AS d FROM kpi_agent_daily
           WHERE space_key = ? AND metric_key IN (${inList}) ORDER BY report_date DESC`,
          [space.spaceKey, ...qaKeys],
        );
        if (dateRow[0]) {
          agentReportDate = dateKey(dateRow[0].d);
          const agentRows = await query<{ agent_id: string; agent_name: string | null; metric_key: string; value: number }>(
            `SELECT agent_id, agent_name, metric_key, value FROM kpi_agent_daily
             WHERE space_key = ? AND report_date = ? AND metric_key IN (${inList})`,
            [space.spaceKey, agentReportDate, ...qaKeys],
          );
          const byAgent = new Map<string, QaAgentRow>();
          for (const r of agentRows) {
            let a = byAgent.get(r.agent_id);
            if (!a) { a = { agentId: r.agent_id, agentName: r.agent_name, metrics: {} }; byAgent.set(r.agent_id, a); }
            a.metrics[r.metric_key] = r.value;
          }
          agents = [...byAgent.values()].sort((x, y) => (x.agentName ?? '').localeCompare(y.agentName ?? ''));
        }
      }

      const hasData = metrics.some((m) => m.value !== null) || agents.length > 0;
      cards.push({
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        ownerName: space.ownerName,
        isJiraSpace: space.isJiraSpace,
        hasData,
        note: hasData
          ? null
          : 'QA metrics are wired for this space but no QA scores have been captured yet (awaiting upstream QA / golden-rules rows).',
        metrics,
        agentReportDate,
        agents,
      });
    }

    return { generatedAt: new Date().toISOString(), qaMetricKeys: qaKeys, spaces: cards };
  }

  /**
   * Escalations parity surface (KPX-WP6). A focused cross-space view of the
   * now-wired escalation metric family (`escalation_rate`, `escalation_accuracy`,
   * `rejection_rate`) — and ONLY that family — now that the escalation-family
   * source (escalation_log) and capture paths are runtime-proven.
   *
   * Reads the SAME clean-sheet path as every other Phase 3 view: current value
   * resolves live-snapshot-first then latest frozen daily (kpi_snapshots /
   * kpi_daily), 7-day daily history for sparklines, and per-agent values from the
   * frozen kpi_agent_daily rows. It never touches the legacy KPI pipeline, the
   * escalation_log table directly, or any forbidden table — the escalation values
   * arrive pre-computed through the engine's source-context wiring.
   *
   * Honesty: only spaces with an enabled escalation binding appear at all. Where a
   * metric has no captured value it resolves to value=null (rendered "—"), never a
   * fabricated 0% / 100%. This is load-bearing for `escalation_accuracy` and
   * `rejection_rate`: until the rejection (bounce-back) capture path has produced
   * at least one event their computers return null, so the EOD freeze writes no
   * row and they read "—" (wired, awaiting capture) rather than asserting an
   * unfounded 100% accurate / 0% rejected. A space carrying the family but holding
   * no value yet is surfaced with hasData=false and an honest note.
   */
  async getEscalationsParity(): Promise<EscalationParitySummary> {
    const escKeys = [...ESCALATION_METRIC_KEYS] as string[];
    const inList = escKeys.map(() => '?').join(', ');
    const spaces = await this.engine.listSpaces();
    const cards: EscalationParitySpace[] = [];

    for (const space of spaces) {
      const bindings = await this.getSpaceMetricBindings(space.spaceKey);
      const escBindings = bindings.filter((b) => escKeys.includes(b.metricKey));
      if (escBindings.length === 0) continue; // space does not carry the escalation family — skip entirely

      // Current value: same live-snapshot-then-daily resolution as Team/SLT views.
      const snapshots = space.isJiraSpace
        ? ((await this.engine.getLatestSnapshot(space.spaceKey)) as unknown as SnapshotRow[])
        : [];
      const latestDaily = await this.getLatestDailyByMetric(space.spaceKey);
      const resolved = this.resolveCurrent(escBindings, snapshots, latestDaily);

      // 7-day space-level daily history for the escalation family only.
      const historyRows = await query<{ metric_key: string; report_date: string | Date; value: number }>(
        `SELECT metric_key, report_date, value
         FROM kpi_daily
         WHERE space_key = ? AND tier_name IS NULL AND metric_key IN (${inList})
           AND report_date >= DATEADD(day, -7, CAST(GETUTCDATE() AS DATE))
         ORDER BY report_date`,
        [space.spaceKey, ...escKeys],
      );
      const histByMetric = new Map<string, Array<{ date: string; value: number }>>();
      for (const r of historyRows) {
        const arr = histByMetric.get(r.metric_key) ?? [];
        arr.push({ date: dateKey(r.report_date), value: r.value });
        histByMetric.set(r.metric_key, arr);
      }
      const metrics = resolved.map((m) => ({ ...m, history: histByMetric.get(m.metricKey) ?? [] }));

      // Per-agent escalation values for the latest frozen date that actually has rows.
      let agentReportDate: string | null = null;
      let agents: EscalationAgentRow[] = [];
      if (space.isJiraSpace) {
        const dateRow = await query<{ d: string | Date }>(
          `SELECT TOP 1 report_date AS d FROM kpi_agent_daily
           WHERE space_key = ? AND metric_key IN (${inList}) ORDER BY report_date DESC`,
          [space.spaceKey, ...escKeys],
        );
        if (dateRow[0]) {
          agentReportDate = dateKey(dateRow[0].d);
          const agentRows = await query<{ agent_id: string; agent_name: string | null; metric_key: string; value: number }>(
            `SELECT agent_id, agent_name, metric_key, value FROM kpi_agent_daily
             WHERE space_key = ? AND report_date = ? AND metric_key IN (${inList})`,
            [space.spaceKey, agentReportDate, ...escKeys],
          );
          const byAgent = new Map<string, EscalationAgentRow>();
          for (const r of agentRows) {
            let a = byAgent.get(r.agent_id);
            if (!a) { a = { agentId: r.agent_id, agentName: r.agent_name, metrics: {} }; byAgent.set(r.agent_id, a); }
            a.metrics[r.metric_key] = r.value;
          }
          agents = [...byAgent.values()].sort((x, y) => (x.agentName ?? '').localeCompare(y.agentName ?? ''));
        }
      }

      const hasData = metrics.some((m) => m.value !== null) || agents.length > 0;
      cards.push({
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        ownerName: space.ownerName,
        isJiraSpace: space.isJiraSpace,
        hasData,
        note: hasData
          ? null
          : 'Escalation metrics are wired for this space but no escalation-family values have been captured yet (awaiting escalation_log rows; rejection-dependent accuracy/rejection-rate await a captured bounce-back).',
        metrics,
        agentReportDate,
        agents,
      });
    }

    return { generatedAt: new Date().toISOString(), escalationMetricKeys: escKeys, spaces: cards };
  }

  /** Direction-aware movement summary for a ≥2-point series. */
  private computeTrendStats(history: TrendPoint[], direction: string): TrendStats {
    const values = history.map((h) => h.value);
    const first = values[0];
    const last = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const deltaAbs = Math.round((last - first) * 1000) / 1000;
    const deltaPct = first === 0 ? null : Math.round(((last - first) / Math.abs(first)) * 1000) / 10;
    // Direction-aware: 'higher' is better when it rises, 'lower' is better when it
    // falls; flat → null; 'neutral'/unknown direction → null (no better/worse).
    let improving: boolean | null;
    if (last === first) improving = null;
    else if (direction === 'higher') improving = last > first;
    else if (direction === 'lower') improving = last < first;
    else improving = null;
    return { points: values.length, first, last, min, max, deltaAbs, deltaPct, improving };
  }

  /**
   * Trends parity surface (KPX-WP7). Clean-sheet, per-space multi-day trend view.
   *
   * Reads the SAME clean-sheet path as every other Phase 3 view — the frozen
   * `kpi_daily` space-level rows (NOVA main pool) — but across a configurable
   * window (default 30 days, clamped 2–90) instead of the fixed 7-day sparkline.
   * It never touches the legacy KPI pipeline, the techservicesjsm tables, the
   * legacy Trends view's data path, or any forbidden table. Current value still
   * resolves live-snapshot-first then latest frozen daily, purely for context.
   *
   * Honesty (no fabrication): every enabled metric is classified into exactly one
   * of supported / awaiting / unsupported. Only metrics with ≥2 real frozen daily
   * points are "supported" and carry a trend; metrics with <2 points ("awaiting")
   * or no registered computer ("unsupported") are listed honestly with a reason
   * and NO drawn line — a missing or single-point series is never extended,
   * flattened, or back-filled into a fake trend.
   */
  async getTrends(spaceKey: string, days = 30): Promise<TrendsSpace | null> {
    const space = await this.engine.getSpaceConfig(spaceKey);
    if (!space) return null;
    const windowDays = Math.max(2, Math.min(90, Math.floor(Number(days)) || 30));
    const bindings = await this.getSpaceMetricBindings(spaceKey);

    // Current value (context only): same live-snapshot-then-daily resolution as
    // the Team Dashboard. Manual spaces never snapshot.
    const snapshots = space.isJiraSpace
      ? ((await this.engine.getLatestSnapshot(spaceKey)) as unknown as SnapshotRow[])
      : [];
    const latestDaily = await this.getLatestDailyByMetric(spaceKey);
    const resolved = this.resolveCurrent(bindings, snapshots, latestDaily);

    // Windowed space-level (tier_name NULL) frozen daily history for every metric.
    const historyRows = await query<{ metric_key: string; report_date: string | Date; value: number }>(
      `SELECT metric_key, report_date, value
       FROM kpi_daily
       WHERE space_key = ? AND tier_name IS NULL
         AND report_date >= DATEADD(day, ?, CAST(GETUTCDATE() AS DATE))
       ORDER BY report_date`,
      [spaceKey, -windowDays],
    );
    const histByMetric = new Map<string, TrendPoint[]>();
    for (const r of historyRows) {
      const arr = histByMetric.get(r.metric_key) ?? [];
      arr.push({ date: dateKey(r.report_date), value: r.value });
      histByMetric.set(r.metric_key, arr);
    }

    const supported: TrendMetric[] = [];
    const unsupported: TrendMetric[] = [];
    for (const m of resolved) {
      const history = histByMetric.get(m.metricKey) ?? [];
      // Structurally unwired computed metric — can never carry a trend in this build.
      if (m.unwired) {
        unsupported.push({
          ...m, history: [], trendStatus: 'unsupported', stats: null,
          trendNote: 'No data source wired yet — no trend can be drawn (not fabricated).',
        });
        continue;
      }
      // Wired but not enough frozen history to form a multi-day trend.
      if (history.length < 2) {
        unsupported.push({
          ...m, history, trendStatus: 'awaiting', stats: null,
          trendNote: history.length === 1
            ? 'Only one frozen day so far — a multi-day trend appears after a second EOD freeze.'
            : 'No frozen daily history yet — a trend appears once EOD freezes accumulate.',
        });
        continue;
      }
      supported.push({
        ...m, history, trendStatus: 'supported',
        stats: this.computeTrendStats(history, m.direction), trendNote: null,
      });
    }

    const hasData = supported.length > 0;
    return {
      spaceKey: space.spaceKey,
      displayName: space.displayName,
      ownerName: space.ownerName,
      timezone: space.timezone,
      isJiraSpace: space.isJiraSpace,
      windowDays,
      hasData,
      note: hasData
        ? null
        : space.isJiraSpace
          ? 'No multi-day clean-sheet history yet for this space — trends appear as EOD freezes accumulate (≥2 frozen days per metric).'
          : 'Manual / non-Jira team — trends appear once ≥2 days of manual entries exist per metric.',
      supported,
      unsupported,
    };
  }

  /**
   * The legacy Agent-Breaches board's live per-agent ticket-health families that
   * the clean-sheet agent path does not capture. The clean-sheet EOD freeze stores
   * per-agent SLA *attainment %* (frt/resolution compliance, csat, …) — not a
   * per-agent count of live open / stale / oldest tickets. The EOD ticket-state
   * snapshot (kpi_eod_snapshot) carries over-SLA counts grouped by tier / status /
   * request-type, never by agent. So these families are surfaced honestly as
   * unsupported rather than fabricated from data that does not exist.
   */
  private static readonly UNSUPPORTED_BREACH_FAMILIES: UnsupportedBreachFamily[] = [
    {
      key: 'open_over_sla_per_agent',
      label: 'Open tickets over SLA (per agent)',
      reason: 'Clean-sheet per-agent capture freezes SLA attainment % (frt_compliance / resolution_compliance), not a per-agent count of currently-open over-SLA tickets. The EOD ticket-state snapshot holds over-SLA counts grouped by tier/status/request-type, not by agent.',
    },
    {
      key: 'not_updated_per_agent',
      label: 'Tickets not updated today (per agent)',
      reason: 'No clean-sheet per-agent stale-ticket (no-update) metric is computed or frozen — there is no honest per-agent value to render.',
    },
    {
      key: 'oldest_ticket_per_agent',
      label: 'Oldest open ticket age (per agent)',
      reason: 'oldest_actionable_hrs is captured at space level only, not per agent — a per-agent oldest-ticket age cannot be derived from the clean-sheet path.',
    },
  ];

  /**
   * Agent Breaches parity surface (KPX-WP8). Cross-space, per-agent breach view
   * over the frozen `kpi_agent_daily` rows — the SAME clean-sheet path the Agent
   * Scorecard uses. For each Jira space carrying ≥1 breach-evaluable agent metric
   * it returns, for the latest frozen date that has agent rows, one row per agent
   * with each metric's value + RAG and a derived breach status (breach / at-risk /
   * clear / no-data), plus per-space summary counts.
   *
   * Honesty: only spaces with a breach-evaluable agent metric appear; a missing
   * per-agent value renders null ("—"), never a fabricated pass/fail; a space with
   * the metrics but no frozen agent rows yet is surfaced with hasData=false and an
   * honest note. Legacy live-queue breach families the clean-sheet agent path
   * cannot produce are listed under unsupportedFamilies, never invented.
   *
   * Reads only the clean-sheet `kpi_*` tables (NOVA main pool). It never touches
   * the legacy KPI pipeline, the legacy Agent-Breaches data path
   * (`/api/kpi-data/agents`), the techservicesjsm tables, or any forbidden table.
   */
  async getAgentBreaches(date?: string): Promise<AgentBreachesSummary> {
    const spaces = await this.engine.listSpaces();
    const cards: AgentBreachesSpace[] = [];

    for (const space of spaces) {
      const bindings = await this.getSpaceMetricBindings(space.spaceKey);
      // Breach-evaluable = agent-level, has a registered computer (can carry a real
      // per-agent value), carries a target, and has a RAG-able direction.
      const breachDefs = bindings.filter(
        (b) =>
          b.isAgentLevel &&
          hasComputer(b.computationKey ?? b.metricKey) &&
          b.targetValue !== null &&
          (b.direction === 'higher' || b.direction === 'lower'),
      );
      if (breachDefs.length === 0) continue; // space carries no breach-evaluable agent metric — skip

      const metricDefs: AgentBreachMetricDef[] = breachDefs.map((b) => ({
        metricKey: b.metricKey,
        displayName: b.displayName,
        valueType: b.valueType,
        direction: b.direction,
        target: b.targetValue,
        amberBand: b.amberBand,
      }));
      const breachKeys = breachDefs.map((b) => b.metricKey);
      const inList = breachKeys.map(() => '?').join(', ');

      const baseCard = {
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        ownerName: space.ownerName,
        isJiraSpace: space.isJiraSpace,
        metricDefs,
      };

      const emptySummary = { agentsBreaching: 0, agentsAtRisk: 0, agentsClear: 0, breachesByMetric: {} as Record<string, number> };

      // Most recent frozen date (≤ requested) that has agent rows for these metrics.
      const dateRow = await query<{ d: string | Date }>(
        date
          ? `SELECT TOP 1 report_date AS d FROM kpi_agent_daily WHERE space_key = ? AND report_date <= ? AND metric_key IN (${inList}) ORDER BY report_date DESC`
          : `SELECT TOP 1 report_date AS d FROM kpi_agent_daily WHERE space_key = ? AND metric_key IN (${inList}) ORDER BY report_date DESC`,
        date ? [space.spaceKey, date, ...breachKeys] : [space.spaceKey, ...breachKeys],
      );
      if (!dateRow[0]) {
        cards.push({
          ...baseCard,
          hasData: false,
          note: 'Breach-evaluable agent metrics are wired for this space but no per-agent values have been captured yet (populated at EOD freeze where agents have agent-level rows).',
          reportDate: null,
          agents: [],
          summary: emptySummary,
        });
        continue;
      }
      const reportDate = dateKey(dateRow[0].d);

      const rows = await query<{ agent_id: string; agent_name: string | null; metric_key: string; value: number }>(
        `SELECT agent_id, agent_name, metric_key, value FROM kpi_agent_daily
         WHERE space_key = ? AND report_date = ? AND metric_key IN (${inList})`,
        [space.spaceKey, reportDate, ...breachKeys],
      );

      const byAgent = new Map<string, { agentId: string; agentName: string | null; values: Map<string, number> }>();
      for (const r of rows) {
        let a = byAgent.get(r.agent_id);
        if (!a) { a = { agentId: r.agent_id, agentName: r.agent_name, values: new Map() }; byAgent.set(r.agent_id, a); }
        a.values.set(r.metric_key, r.value);
      }

      const breachesByMetric: Record<string, number> = {};
      for (const k of breachKeys) breachesByMetric[k] = 0;
      let agentsBreaching = 0, agentsAtRisk = 0, agentsClear = 0;

      const agents: AgentBreachRow[] = [];
      for (const a of byAgent.values()) {
        const cells: AgentBreachCell[] = [];
        let red = 0, amber = 0, green = 0;
        for (const def of breachDefs) {
          const v = a.values.has(def.metricKey) ? a.values.get(def.metricKey)! : null;
          const rag = v === null ? null : this.eod.computeRag(v, def.targetValue, def.amberBand, def.direction);
          if (rag === 'red') { red++; breachesByMetric[def.metricKey]++; }
          else if (rag === 'amber') amber++;
          else if (rag === 'green') green++;
          cells.push({ metricKey: def.metricKey, value: v, rag });
        }
        let status: AgentBreachStatus;
        if (red > 0) { status = 'breach'; agentsBreaching++; }
        else if (amber > 0) { status = 'at_risk'; agentsAtRisk++; }
        else if (green > 0) { status = 'clear'; agentsClear++; }
        else status = 'no_data';
        agents.push({ agentId: a.agentId, agentName: a.agentName, status, breachCount: red, atRiskCount: amber, cells });
      }

      // Breaching agents first (most breaches), then at-risk, then clear, then no-data; ties by name.
      const rank: Record<AgentBreachStatus, number> = { breach: 0, at_risk: 1, clear: 2, no_data: 3 };
      agents.sort((x, y) => {
        if (rank[x.status] !== rank[y.status]) return rank[x.status] - rank[y.status];
        if (x.breachCount !== y.breachCount) return y.breachCount - x.breachCount;
        if (x.atRiskCount !== y.atRiskCount) return y.atRiskCount - x.atRiskCount;
        return (x.agentName ?? x.agentId).localeCompare(y.agentName ?? y.agentId);
      });

      cards.push({
        ...baseCard,
        hasData: agents.length > 0,
        note: agents.length ? null : 'No per-agent breach values captured for this date.',
        reportDate,
        agents,
        summary: { agentsBreaching, agentsAtRisk, agentsClear, breachesByMetric },
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      unsupportedFamilies: KpiViewsService.UNSUPPORTED_BREACH_FAMILIES,
      spaces: cards,
    };
  }
}
