/**
 * KPI Recovery — Computation Engine + Snapshot Scheduler (P1-WP1)
 *
 * The NOVA-side KPI engine. Reads the local jira_issue_cache (refreshed every
 * 5 min by the existing Jira sync), runs the business-hours engine and the
 * pluggable metric computers, and writes point-in-time values to kpi_snapshots
 * on the 3-minute cycle (design §5.2). Everything here is NEW; it never touches
 * the legacy KPI pipeline pool or any forbidden table.
 *
 * Tickets are sourced ONLY from jira_issue_cache / jira_comment_cache (NOVA main
 * pool). CS/KAM ticket classification follows design §13.2 (Key_Account /
 * Enterprise_Account label ⇒ KAM, else CS).
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §5.
 */
import { query, execute } from '../database.js';
import { parseTimeToMinutes } from './business-hours.js';
import { metricComputers, hasComputer } from './metric-computers.js';
import type { SpaceConfig, EnabledMetric, TierDefinition, KpiTicket, MetricValue } from './types.js';

interface SpaceRow {
  space_key: string;
  jira_project: string | null;
  display_name: string;
  owner_name: string | null;
  timezone: string;
  biz_hours_start: string | Date | null;
  biz_hours_end: string | Date | null;
  weekend_days: string;
  pause_statuses: string | null;
  has_tiers: boolean | number;
  is_jira_space: boolean | number;
  is_active: boolean | number;
}

interface TierRow {
  tier_name: string;
  tier_order: number;
  jira_field_value: string | null;
  frt_target_minutes: number | null;
  resolution_target_minutes: number | null;
}

interface CacheTicketRow {
  issue_key: string;
  project_key: string;
  status_name: string | null;
  status_category: string | null;
  current_tier: string | null;
  request_type: string | null;
  assignee_account_id: string | null;
  assignee_display: string | null;
  jira_created: string | Date | null;
  jira_updated: string | Date | null;
  resolved_at: string | Date | null;
  resolution_name: string | null;
  sla_breached: boolean | number | null;
  sla_breach_time: string | Date | null;
  labels: string | null;
  fields_json: string | null;
  first_public: string | Date | null;
}

const KEY_ACCOUNT_LABELS = ['key_account', 'enterprise_account'];

function toBool(v: boolean | number | null): boolean {
  return v === true || v === 1;
}
function toDate(v: string | Date | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function timeStr(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return String(v);
}

function parseCsat(fieldsJson: string | null): number | null {
  if (!fieldsJson) return null;
  try {
    const f = JSON.parse(fieldsJson);
    const rating = f?.customfield_12802?.rating;
    return typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : null;
  } catch { return null; }
}
function parseStoryPoints(fieldsJson: string | null): number | null {
  if (!fieldsJson) return null;
  try {
    const f = JSON.parse(fieldsJson);
    const v = f?.customfield_11706;
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}
function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

export class KpiEngine {
  /** Active spaces (any). */
  async listSpaces(): Promise<SpaceConfig[]> {
    const rows = await query<SpaceRow>(`SELECT * FROM kpi_spaces WHERE is_active = 1 ORDER BY space_key`);
    const out: SpaceConfig[] = [];
    for (const r of rows) out.push(await this.hydrateSpace(r));
    return out;
  }

  async getSpaceConfig(spaceKey: string): Promise<SpaceConfig | null> {
    const rows = await query<SpaceRow>(`SELECT * FROM kpi_spaces WHERE space_key = ?`, [spaceKey]);
    if (rows.length === 0) return null;
    return this.hydrateSpace(rows[0]);
  }

  private async hydrateSpace(r: SpaceRow): Promise<SpaceConfig> {
    // Default SLA thresholds come from the configurable `Standard` tier row.
    const std = await query<TierRow>(
      `SELECT TOP 1 frt_target_minutes, resolution_target_minutes
       FROM kpi_tier_definitions WHERE space_key = ? ORDER BY tier_order ASC`,
      [r.space_key],
    );
    const holidayRows = await query<{ holiday_date: string | Date }>(
      `SELECT holiday_date FROM kpi_holidays WHERE space_key = ?`, [r.space_key],
    );
    const holidays = new Set<string>();
    for (const h of holidayRows) {
      const d = toDate(h.holiday_date);
      if (d) holidays.add(d.toISOString().slice(0, 10));
    }
    let pauseStatuses: string[] = [];
    try { pauseStatuses = JSON.parse(r.pause_statuses || '[]').map((s: string) => s.toLowerCase()); } catch { /* ignore */ }

    return {
      spaceKey: r.space_key,
      jiraProject: r.jira_project,
      displayName: r.display_name,
      ownerName: r.owner_name,
      timezone: r.timezone || 'Europe/London',
      bizStartMinutes: parseTimeToMinutes(timeStr(r.biz_hours_start), 8 * 60 + 30),
      bizEndMinutes: parseTimeToMinutes(timeStr(r.biz_hours_end), 17 * 60 + 30),
      weekendDays: (r.weekend_days || '0,6').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)),
      pauseStatuses,
      hasTiers: toBool(r.has_tiers),
      isJiraSpace: toBool(r.is_jira_space),
      isActive: toBool(r.is_active),
      holidays,
      defaultFrtTargetMin: std[0]?.frt_target_minutes ?? 60,
      defaultResTargetMin: std[0]?.resolution_target_minutes ?? 480,
    };
  }

  async getEnabledMetrics(spaceKey: string): Promise<EnabledMetric[]> {
    return query<EnabledMetric>(
      `SELECT d.metric_key AS metricKey, d.display_name AS displayName, d.category,
              d.value_type AS valueType, d.direction, d.aggregation, d.source,
              d.computation_key AS computationKey, d.requires_tiers AS requiresTiers,
              d.is_agent_level AS isAgentLevel, sm.target_value AS targetValue,
              sm.amber_band AS amberBand
       FROM kpi_space_metrics sm
       JOIN kpi_metric_definitions d ON d.metric_key = sm.metric_key
       WHERE sm.space_key = ? AND sm.is_enabled = 1 AND d.is_active = 1
       ORDER BY sm.display_order`,
      [spaceKey],
    ).then((rows) => rows.map((r) => ({
      ...r,
      requiresTiers: toBool(r.requiresTiers as unknown as number),
      isAgentLevel: toBool(r.isAgentLevel as unknown as number),
    })));
  }

  /** Breakdown tiers only (tier_order > 0); the Standard row is space-level. */
  async getTierDefinitions(spaceKey: string): Promise<TierDefinition[]> {
    const rows = await query<TierRow>(
      `SELECT tier_name, tier_order, jira_field_value, frt_target_minutes, resolution_target_minutes
       FROM kpi_tier_definitions WHERE space_key = ? AND tier_order > 0 ORDER BY tier_order`,
      [spaceKey],
    );
    return rows.map((r) => ({
      tierName: r.tier_name,
      tierOrder: r.tier_order,
      jiraFieldValue: r.jira_field_value,
      frtTargetMinutes: r.frt_target_minutes,
      resolutionTargetMinutes: r.resolution_target_minutes,
    }));
  }

  /** Fetch tickets for a Jira space from the NOVA cache (open + recently resolved). */
  async getTicketsForSpace(space: SpaceConfig): Promise<KpiTicket[]> {
    if (!space.jiraProject) return [];
    const rows = await query<CacheTicketRow>(
      `SELECT c.issue_key, c.project_key, c.status_name, c.status_category, c.current_tier,
              c.request_type, c.assignee_account_id, c.assignee_display, c.jira_created,
              c.jira_updated, c.resolved_at, c.resolution_name, c.sla_breached, c.sla_breach_time,
              c.labels, c.fields_json, fc.first_public
       FROM jira_issue_cache c
       LEFT JOIN (
         SELECT issue_key, MIN(jira_created) AS first_public
         FROM jira_comment_cache WHERE is_public = 1 GROUP BY issue_key
       ) fc ON fc.issue_key = c.issue_key
       WHERE c.project_key = ?
         AND (c.status_category != 'done'
              OR c.resolved_at >= DATEADD(day, -3, GETUTCDATE())
              OR c.jira_updated >= DATEADD(day, -3, GETUTCDATE()))`,
      [space.jiraProject],
    );
    return rows.map((r) => {
      const labels = parseLabels(r.labels);
      const lower = labels.map((l) => l.toLowerCase());
      const isKeyAccount = lower.some((l) => KEY_ACCOUNT_LABELS.includes(l));
      return {
        issueKey: r.issue_key,
        projectKey: r.project_key,
        statusName: r.status_name,
        statusCategory: r.status_category,
        currentTier: r.current_tier,
        requestType: r.request_type,
        assigneeAccountId: r.assignee_account_id,
        assigneeDisplay: r.assignee_display,
        created: toDate(r.jira_created),
        updated: toDate(r.jira_updated),
        resolvedAt: toDate(r.resolved_at),
        resolutionName: r.resolution_name,
        slaBreached: toBool(r.sla_breached),
        slaBreachTime: toDate(r.sla_breach_time),
        labels,
        firstPublicCommentAt: toDate(r.first_public),
        csatRating: parseCsat(r.fields_json),
        storyPoints: parseStoryPoints(r.fields_json),
        isKeyAccount,
        isCustomerSuccess: !isKeyAccount,
      };
    });
  }

  /**
   * Compute all enabled computed metrics for a space (design §5.3). Returns
   * space-level values, plus per-tier breakdowns for tier-aware metrics when the
   * space has tiers. Manual-source metrics and metrics without a computer are
   * skipped.
   */
  async computeSpaceMetrics(spaceKey: string): Promise<MetricValue[]> {
    const space = await this.getSpaceConfig(spaceKey);
    if (!space || !space.isJiraSpace) return [];
    const metrics = await this.getEnabledMetrics(spaceKey);
    const tickets = await this.getTicketsForSpace(space);
    const tiers = space.hasTiers ? await this.getTierDefinitions(spaceKey) : [];
    const results: MetricValue[] = [];

    for (const metric of metrics) {
      if (metric.source !== 'computed') continue;
      const computer = metric.computationKey ? metricComputers[metric.computationKey] : undefined;
      if (!computer) continue; // no Phase 1 computer for this metric — skip gracefully

      try {
        results.push({ spaceKey, metricKey: metric.metricKey, tierName: null, value: computer(tickets, space, metric) });
      } catch (err) {
        console.warn(`[kpi-engine] computer ${metric.computationKey} failed for ${spaceKey}:`, err instanceof Error ? err.message : err);
        continue;
      }

      if (metric.requiresTiers && space.hasTiers) {
        for (const tier of tiers) {
          const tierTickets = tier.jiraFieldValue
            ? tickets.filter((t) => (t.currentTier || '') === tier.jiraFieldValue)
            : tickets;
          try {
            results.push({ spaceKey, metricKey: metric.metricKey, tierName: tier.tierName, value: computer(tierTickets, space, metric, tier) });
          } catch { /* per-tier failure non-fatal */ }
        }
      }
    }
    return results;
  }

  /** Persist a batch of computed values as point-in-time snapshot rows. */
  async writeSnapshots(values: MetricValue[], snapshotAt: Date): Promise<number> {
    let written = 0;
    for (const v of values) {
      await execute(
        `INSERT INTO kpi_snapshots (space_key, metric_key, tier_name, snapshot_at, value)
         VALUES (?, ?, ?, ?, ?)`,
        [v.spaceKey, v.metricKey, v.tierName, snapshotAt, v.value],
      );
      written++;
    }
    return written;
  }

  /** Is the space currently inside its snapshot compute window (design §5.2)? */
  isWithinComputeWindow(space: SpaceConfig, now = new Date()): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: space.timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(now);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const weekdayIdx: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = weekdayIdx[map.weekday] ?? 0;
    if (space.weekendDays.includes(dow)) return false;
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const minutes = hour * 60 + parseInt(map.minute, 10);
    // 30-min pre-open / 60-min post-close buffer around the working window.
    return minutes >= (space.bizStartMinutes - 30) && minutes <= (space.bizEndMinutes + 60);
  }

  /**
   * One snapshot cycle: compute + persist for every active Jira space currently
   * inside its compute window. Called by the 3-minute scheduler.
   */
  async runSnapshotCycle(): Promise<{ spaces: number; rows: number; skipped: string[] }> {
    const snapshotAt = new Date();
    const spaces = await this.listSpaces();
    let totalRows = 0;
    let computedSpaces = 0;
    const skipped: string[] = [];

    for (const space of spaces) {
      if (!space.isJiraSpace) { skipped.push(`${space.spaceKey}:manual`); continue; }
      if (!this.isWithinComputeWindow(space, snapshotAt)) { skipped.push(`${space.spaceKey}:outside-window`); continue; }
      try {
        const values = await this.computeSpaceMetrics(space.spaceKey);
        if (values.length === 0) { skipped.push(`${space.spaceKey}:no-values`); continue; }
        totalRows += await this.writeSnapshots(values, snapshotAt);
        computedSpaces++;
      } catch (err) {
        console.warn(`[kpi-engine] snapshot cycle failed for ${space.spaceKey}:`, err instanceof Error ? err.message : err);
        skipped.push(`${space.spaceKey}:error`);
      }
    }

    if (computedSpaces > 0) {
      console.log(`[kpi-engine] snapshot cycle: ${totalRows} rows across ${computedSpaces} space(s)` +
        (skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''));
    }
    return { spaces: computedSpaces, rows: totalRows, skipped };
  }

  /** Latest snapshot value per metric/tier for a space (for read endpoints). */
  async getLatestSnapshot(spaceKey: string): Promise<Array<{ metricKey: string; tierName: string | null; value: number; snapshotAt: Date }>> {
    return query(
      `WITH ranked AS (
         SELECT metric_key, tier_name, value, snapshot_at,
                ROW_NUMBER() OVER (PARTITION BY metric_key, tier_name ORDER BY snapshot_at DESC) AS rn
         FROM kpi_snapshots WHERE space_key = ?
       )
       SELECT metric_key AS metricKey, tier_name AS tierName, value, snapshot_at AS snapshotAt
       FROM ranked WHERE rn = 1`,
      [spaceKey],
    );
  }

  /** Engine health: seed/snapshot counts + last run time (design §9 admin /health). */
  async getHealth(): Promise<{ lastSnapshotAt: string | null; snapshotRows: number; spaces: number; metrics: number; spaceMetrics: number; tiers: number }> {
    const last = await query<{ last: Date | null }>(`SELECT MAX(snapshot_at) AS last FROM kpi_snapshots`);
    const cnt = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM kpi_snapshots`);
    const sp = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM kpi_spaces WHERE is_active = 1`);
    const mt = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM kpi_metric_definitions WHERE is_active = 1`);
    const sm = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM kpi_space_metrics WHERE is_enabled = 1`);
    const tr = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM kpi_tier_definitions`);
    const lastVal = last[0]?.last ? new Date(last[0].last).toISOString() : null;
    return {
      lastSnapshotAt: lastVal,
      snapshotRows: cnt[0]?.n ?? 0,
      spaces: sp[0]?.n ?? 0,
      metrics: mt[0]?.n ?? 0,
      spaceMetrics: sm[0]?.n ?? 0,
      tiers: tr[0]?.n ?? 0,
    };
  }
}
