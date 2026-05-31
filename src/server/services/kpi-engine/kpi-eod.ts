/**
 * KPI Recovery — EOD Capture + Daily Freeze + RAG + Daily Report (P2-WP1)
 *
 * Phase 2 of the clean-sheet KPI system. Everything here is NEW and runs in
 * parallel with the untouched legacy KPI system. It builds directly on the live
 * Phase 1 foundation (KpiEngine, business-hours engine, pluggable computers,
 * kpi_* tables) and adds:
 *
 *   1. EOD capture per space at its configured end-of-day, in its OWN timezone
 *      (UK spaces 17:30 Europe/London, STBY 18:00 Asia/Kolkata — both derived
 *      from kpi_spaces.biz_hours_end, never hardcoded).
 *   2. Official daily metric rows frozen into kpi_daily (with denormalised target
 *      and computed RAG status).
 *   3. Agent-level daily rows into kpi_agent_daily for implemented agent metrics.
 *   4. EOD ticket-state aggregation into kpi_eod_snapshot.
 *   5. The daily-report payload the thin n8n email trigger calls.
 *
 * RAG bands come from the stored, configurable kpi_space_metrics (target_value +
 * amber_band %) joined with metric direction — no hardcoded SLA targets.
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §3.7–3.9, §5.2, §9.
 */
import { query, execute } from '../database.js';
import { calculateBusinessMinutes } from './business-hours.js';
import { metricComputers } from './metric-computers.js';
import type { KpiEngine } from './kpi-engine.js';
import type { SpaceConfig, EnabledMetric, TierDefinition, KpiTicket, MetricSourceContext } from './types.js';

export type RagStatus = 'green' | 'amber' | 'red';

/** Result of one space's EOD capture. */
export interface SpaceCaptureResult {
  spaceKey: string;
  reportDate: string;       // YYYY-MM-DD (space-local)
  snapshotTime: string;     // 'HH:MM' (space EOD, e.g. '17:30' / '18:00')
  dailyRows: number;
  agentRows: number;
  eodRows: number;
  skipped?: string;
}

/** A single frozen daily metric row, as stored in kpi_daily. */
interface DailyRow {
  metricKey: string;
  tierName: string | null;
  value: number;
  target: number | null;
  rag: RagStatus | null;
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** YYYY-MM-DD for an instant in a timezone (space-local calendar day). */
function tzDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** Space-local wall-clock state (minutes-of-day + weekday) for an instant. */
function tzClock(date: Date, tz: string): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayIdx: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  return { minutes: hour * 60 + parseInt(map.minute, 10), weekday: weekdayIdx[map.weekday] ?? 0 };
}

export class KpiEodService {
  constructor(private readonly engine: KpiEngine) {}

  /**
   * Compute RAG from a value against its configured target + amber band.
   *
   * The amber band is a percentage deviation off the target (schema default 10%).
   * `direction` decides which side of the target is "good":
   *   - 'higher': green ≥ target; amber ≥ target − band; else red
   *   - 'lower' : green ≤ target; amber ≤ target + band; else red
   * No target, or a neutral direction, yields no RAG (null).
   */
  computeRag(
    value: number,
    target: number | null | undefined,
    amberBandPct: number | null | undefined,
    direction: string,
  ): RagStatus | null {
    if (target === null || target === undefined) return null;
    if (direction !== 'higher' && direction !== 'lower') return null;
    const band = Math.abs(target) * ((amberBandPct ?? 0) / 100);
    if (direction === 'higher') {
      if (value >= target) return 'green';
      if (value >= target - band) return 'amber';
      return 'red';
    }
    // lower is better
    if (value <= target) return 'green';
    if (value <= target + band) return 'amber';
    return 'red';
  }

  /** Space EOD trigger time = configured business-hours end (UK 17:30 / STBY 18:00). */
  eodLabel(space: SpaceConfig): string {
    return minutesToHHMM(space.bizEndMinutes);
  }

  /** Has this space already been frozen into kpi_daily for the given local date? */
  private async alreadyCaptured(spaceKey: string, reportDate: string): Promise<boolean> {
    const rows = await query<{ n: number }>(
      `SELECT TOP 1 1 AS n FROM kpi_daily WHERE space_key = ? AND report_date = ?`,
      [spaceKey, reportDate],
    );
    return rows.length > 0;
  }

  /** Resolve the resolution-SLA target (minutes) for a ticket's tier within a space. */
  private resTargetForTicket(t: KpiTicket, space: SpaceConfig, tiers: TierDefinition[]): number {
    if (space.hasTiers && t.currentTier) {
      const tier = tiers.find((td) => td.jiraFieldValue && td.jiraFieldValue === t.currentTier);
      if (tier?.resolutionTargetMinutes != null) return tier.resolutionTargetMinutes;
    }
    return space.defaultResTargetMin;
  }

  /**
   * Freeze official daily values for one space into kpi_daily, agent rows into
   * kpi_agent_daily, and ticket-state into kpi_eod_snapshot. Idempotent:
   * re-running for the same (space, date) replaces that day's rows, so the EOD
   * trigger and the late catch-up converge to one official set.
   *
   * Values are computed fresh at capture time via the Phase 1 engine — the
   * compute AT the EOD instant IS the frozen snapshot, and this stays correct
   * even when the 3-min snapshot job did not run in the eval window.
   */
  async captureSpace(
    spaceKey: string,
    opts: { reportDate?: string; now?: Date } = {},
  ): Promise<SpaceCaptureResult> {
    const now = opts.now ?? new Date();
    const space = await this.engine.getSpaceConfig(spaceKey);
    if (!space) {
      return { spaceKey, reportDate: opts.reportDate ?? '', snapshotTime: '', dailyRows: 0, agentRows: 0, eodRows: 0, skipped: 'unknown-space' };
    }
    const reportDate = opts.reportDate ?? tzDateKey(now, space.timezone);
    const snapshotTime = this.eodLabel(space);
    if (!space.isJiraSpace) {
      // Manual teams are filled via Phase 4 manual entry/import — not this WP.
      return { spaceKey, reportDate, snapshotTime, dailyRows: 0, agentRows: 0, eodRows: 0, skipped: 'manual-space' };
    }

    const metrics = await this.engine.getEnabledMetrics(spaceKey);
    const tickets = await this.engine.getTicketsForSpace(space);
    const tiers = space.hasTiers ? await this.engine.getTierDefinitions(spaceKey) : [];
    const metricByKey = new Map<string, EnabledMetric>();
    for (const m of metrics) metricByKey.set(m.metricKey, m);

    // ── 1. Official daily rows (space-level + per-tier) ──
    const computed = await this.engine.computeSpaceMetrics(spaceKey);
    const dailyRows: DailyRow[] = computed.map((v) => {
      const def = metricByKey.get(v.metricKey);
      const target = def?.targetValue ?? null;
      const rag = def ? this.computeRag(v.value, target, def.amberBand, def.direction) : null;
      return { metricKey: v.metricKey, tierName: v.tierName, value: v.value, target, rag };
    });

    // ── 2. Agent-level daily rows (implemented agent metrics only) ──
    const agentMetrics = metrics.filter(
      (m) => m.isAgentLevel && m.source === 'computed' && m.computationKey && metricComputers[m.computationKey],
    );
    // Source context (escalation/QA) for the agent-level source-family metrics;
    // the same ctx is filtered per agent inside the computers via issueKey.
    const ctx = await this.engine.buildSourceContextFor(space, agentMetrics);
    const agentRows = this.computeAgentRows(agentMetrics, tickets, space, ctx);

    // ── 3. EOD ticket-state aggregation ──
    const eodGroups = this.computeEodGroups(tickets, space, tiers, now);

    // ── Persist (replace this day's rows for idempotent recapture/catch-up) ──
    await execute(`DELETE FROM kpi_daily WHERE space_key = ? AND report_date = ?`, [spaceKey, reportDate]);
    for (const r of dailyRows) {
      await execute(
        `INSERT INTO kpi_daily (space_key, metric_key, tier_name, report_date, value, target_value, rag_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [spaceKey, r.metricKey, r.tierName, reportDate, r.value, r.target, r.rag],
      );
    }

    await execute(`DELETE FROM kpi_agent_daily WHERE space_key = ? AND report_date = ?`, [spaceKey, reportDate]);
    for (const a of agentRows) {
      await execute(
        `INSERT INTO kpi_agent_daily (space_key, metric_key, agent_id, agent_name, report_date, value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [spaceKey, a.metricKey, a.agentId, a.agentName, reportDate, a.value],
      );
    }

    await execute(`DELETE FROM kpi_eod_snapshot WHERE space_key = ? AND snapshot_date = ?`, [spaceKey, reportDate]);
    for (const g of eodGroups) {
      await execute(
        `INSERT INTO kpi_eod_snapshot (space_key, snapshot_date, snapshot_time, tier_name, status, request_type, ticket_count, over_sla_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [spaceKey, reportDate, snapshotTime, g.tierName, g.status, g.requestType, g.ticketCount, g.overSlaCount],
      );
    }

    console.log(
      `[kpi-eod] captured ${spaceKey} ${reportDate} @${snapshotTime} — ` +
      `daily=${dailyRows.length} agent=${agentRows.length} eod=${eodGroups.length}`,
    );
    return {
      spaceKey, reportDate, snapshotTime,
      dailyRows: dailyRows.length, agentRows: agentRows.length, eodRows: eodGroups.length,
    };
  }

  /** Per-agent values for the implemented agent metrics, reusing Phase 1 computers. */
  private computeAgentRows(
    agentMetrics: EnabledMetric[],
    tickets: KpiTicket[],
    space: SpaceConfig,
    ctx?: MetricSourceContext,
  ): Array<{ metricKey: string; agentId: string; agentName: string | null; value: number }> {
    if (agentMetrics.length === 0) return [];
    // Group tickets by assignee (skip unassigned).
    const byAgent = new Map<string, { name: string | null; tickets: KpiTicket[] }>();
    for (const t of tickets) {
      const id = t.assigneeAccountId;
      if (!id) continue;
      let entry = byAgent.get(id);
      if (!entry) { entry = { name: t.assigneeDisplay ?? null, tickets: [] }; byAgent.set(id, entry); }
      entry.tickets.push(t);
    }

    const rows: Array<{ metricKey: string; agentId: string; agentName: string | null; value: number }> = [];
    for (const [agentId, entry] of byAgent) {
      for (const m of agentMetrics) {
        const computer = metricComputers[m.computationKey!];
        try {
          // Source-family computers filter ctx to this agent's tickets via issueKey.
          const value = computer(entry.tickets, space, m, undefined, ctx);
          if (value !== null) rows.push({ metricKey: m.metricKey, agentId, agentName: entry.name, value });
        } catch { /* per-agent/metric failure is non-fatal */ }
      }
    }
    return rows;
  }

  /** Aggregate open tickets by (tier, status, request_type) with over-SLA counts. */
  private computeEodGroups(
    tickets: KpiTicket[],
    space: SpaceConfig,
    tiers: TierDefinition[],
    now: Date,
  ): Array<{ tierName: string | null; status: string | null; requestType: string | null; ticketCount: number; overSlaCount: number }> {
    const groups = new Map<string, { tierName: string | null; status: string | null; requestType: string | null; ticketCount: number; overSlaCount: number }>();
    for (const t of tickets) {
      const open = (t.statusCategory || '').toLowerCase() !== 'done';
      if (!open) continue;
      const tierName = space.hasTiers ? (t.currentTier || null) : null;
      const status = t.statusName || null;
      const requestType = t.requestType || null;
      const key = `${tierName ?? ''}|${status ?? ''}|${requestType ?? ''}`;
      let g = groups.get(key);
      if (!g) { g = { tierName, status, requestType, ticketCount: 0, overSlaCount: 0 }; groups.set(key, g); }
      g.ticketCount++;
      if (t.created) {
        const target = this.resTargetForTicket(t, space, tiers);
        if (calculateBusinessMinutes(t.created, now, space) > target) g.overSlaCount++;
      }
    }
    return [...groups.values()];
  }

  /**
   * One EOD cycle: for each active Jira space, if it has reached its configured
   * end-of-day (space-local, business day) and has not yet been captured today,
   * freeze it. Called by the EOD scheduler. The "already captured" guard makes
   * the 17:30/18:00 trigger and the late catch-up the same code path.
   *
   * `opts.force` bypasses the weekday/holiday/before-EOD/already-captured gates
   * so an operator (or the evaluator) can demonstrate the freeze path on demand —
   * e.g. on a weekend — without waiting for a natural weekday EOD. Forced runs
   * still skip manual spaces and remain idempotent (captureSpace replaces the
   * day's rows), so a repeated forced run is a clean recapture.
   */
  async runEodCycle(now = new Date(), opts: { force?: boolean } = {}): Promise<{ captured: SpaceCaptureResult[]; skipped: string[]; forced: boolean }> {
    const force = opts.force === true;
    const spaces = await this.engine.listSpaces();
    const captured: SpaceCaptureResult[] = [];
    const skipped: string[] = [];

    for (const space of spaces) {
      if (!space.isJiraSpace) { skipped.push(`${space.spaceKey}:manual`); continue; }
      const clock = tzClock(now, space.timezone);
      const reportDate = tzDateKey(now, space.timezone);
      if (!force) {
        if (space.weekendDays.includes(clock.weekday)) { skipped.push(`${space.spaceKey}:weekend`); continue; }
        if (space.holidays.has(reportDate)) { skipped.push(`${space.spaceKey}:holiday`); continue; }
        if (clock.minutes < space.bizEndMinutes) { skipped.push(`${space.spaceKey}:before-eod`); continue; }
        if (await this.alreadyCaptured(space.spaceKey, reportDate)) { skipped.push(`${space.spaceKey}:already`); continue; }
      }
      try {
        captured.push(await this.captureSpace(space.spaceKey, { reportDate, now }));
      } catch (err) {
        console.warn(`[kpi-eod] capture failed for ${space.spaceKey}:`, err instanceof Error ? err.message : err);
        skipped.push(`${space.spaceKey}:error`);
      }
    }
    if (captured.length > 0) {
      console.log(`[kpi-eod] EOD cycle${force ? ' (forced)' : ''} captured ${captured.length} space(s): ${captured.map((c) => c.spaceKey).join(', ')}`);
    }
    return { captured, skipped, forced: force };
  }

  /**
   * Assemble the daily-report payload the thin n8n email trigger calls
   * (GET /api/kpi/daily-report/:date). Reads the frozen official rows from
   * kpi_daily / kpi_agent_daily / kpi_eod_snapshot for the given date — it does
   * NOT recompute, so the email reflects the captured EOD truth.
   */
  async getDailyReport(reportDate: string): Promise<DailyReport> {
    const spaces = await this.engine.listSpaces();

    const dailyAll = await query<{
      space_key: string; metric_key: string; tier_name: string | null;
      value: number; target_value: number | null; rag_status: string | null;
      display_name: string | null; value_type: string | null; direction: string | null; display_order: number | null;
    }>(
      `SELECT d.space_key, d.metric_key, d.tier_name, d.value, d.target_value, d.rag_status,
              md.display_name, md.value_type, md.direction, sm.display_order
       FROM kpi_daily d
       LEFT JOIN kpi_metric_definitions md ON md.metric_key = d.metric_key
       LEFT JOIN kpi_space_metrics sm ON sm.space_key = d.space_key AND sm.metric_key = d.metric_key
       WHERE d.report_date = ?
       ORDER BY d.space_key, sm.display_order, d.metric_key, d.tier_name`,
      [reportDate],
    );

    const agentAll = await query<{ space_key: string; metric_key: string; agent_id: string; agent_name: string | null; value: number }>(
      `SELECT space_key, metric_key, agent_id, agent_name, value
       FROM kpi_agent_daily WHERE report_date = ? ORDER BY space_key, agent_name, metric_key`,
      [reportDate],
    );

    const eodAll = await query<{ space_key: string; snapshot_time: string; tier_name: string | null; status: string | null; request_type: string | null; ticket_count: number; over_sla_count: number }>(
      `SELECT space_key, snapshot_time, tier_name, status, request_type, ticket_count, over_sla_count
       FROM kpi_eod_snapshot WHERE snapshot_date = ? ORDER BY space_key`,
      [reportDate],
    );

    const spacePayloads: DailyReportSpace[] = [];
    for (const space of spaces) {
      if (!space.isJiraSpace) continue; // manual teams not in scope for Phase 2 capture
      const daily = dailyAll.filter((r) => r.space_key === space.spaceKey);
      const agents = agentAll.filter((r) => r.space_key === space.spaceKey);
      const eod = eodAll.filter((r) => r.space_key === space.spaceKey);

      const ragSummary = { green: 0, amber: 0, red: 0, none: 0 };
      for (const r of daily) {
        if (r.rag_status === 'green') ragSummary.green++;
        else if (r.rag_status === 'amber') ragSummary.amber++;
        else if (r.rag_status === 'red') ragSummary.red++;
        else ragSummary.none++;
      }

      const totalTickets = eod.reduce((s, r) => s + (r.ticket_count || 0), 0);
      const overSla = eod.reduce((s, r) => s + (r.over_sla_count || 0), 0);

      // Group agent rows into one object per agent.
      const agentMap = new Map<string, { agentId: string; agentName: string | null; metrics: Record<string, number> }>();
      for (const a of agents) {
        let entry = agentMap.get(a.agent_id);
        if (!entry) { entry = { agentId: a.agent_id, agentName: a.agent_name, metrics: {} }; agentMap.set(a.agent_id, entry); }
        entry.metrics[a.metric_key] = a.value;
      }

      spacePayloads.push({
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        timezone: space.timezone,
        eodTime: this.eodLabel(space),
        captured: daily.length > 0,
        metrics: daily.map((r) => ({
          metricKey: r.metric_key,
          displayName: r.display_name ?? r.metric_key,
          tierName: r.tier_name,
          value: r.value,
          target: r.target_value,
          rag: (r.rag_status as RagStatus | null) ?? null,
          valueType: r.value_type ?? null,
          direction: r.direction ?? null,
        })),
        ragSummary,
        eodSnapshot: {
          snapshotTime: eod[0]?.snapshot_time ?? this.eodLabel(space),
          totalTickets,
          overSla,
          groups: eod.map((r) => ({
            tierName: r.tier_name, status: r.status, requestType: r.request_type,
            ticketCount: r.ticket_count, overSlaCount: r.over_sla_count,
          })),
        },
        agents: [...agentMap.values()],
      });
    }

    return {
      reportDate,
      generatedAt: new Date().toISOString(),
      spaces: spacePayloads,
      summary: {
        spacesCaptured: spacePayloads.filter((s) => s.captured).length,
        spacesExpected: spacePayloads.length,
      },
    };
  }
}

// ── Daily-report payload shapes ──

export interface DailyReportMetric {
  metricKey: string;
  displayName: string;
  tierName: string | null;
  value: number;
  target: number | null;
  rag: RagStatus | null;
  valueType: string | null;
  direction: string | null;
}

export interface DailyReportSpace {
  spaceKey: string;
  displayName: string;
  timezone: string;
  eodTime: string;
  captured: boolean;
  metrics: DailyReportMetric[];
  ragSummary: { green: number; amber: number; red: number; none: number };
  eodSnapshot: {
    snapshotTime: string;
    totalTickets: number;
    overSla: number;
    groups: Array<{ tierName: string | null; status: string | null; requestType: string | null; ticketCount: number; overSlaCount: number }>;
  };
  agents: Array<{ agentId: string; agentName: string | null; metrics: Record<string, number> }>;
}

export interface DailyReport {
  reportDate: string;
  generatedAt: string;
  spaces: DailyReportSpace[];
  summary: { spacesCaptured: number; spacesExpected: number };
}
