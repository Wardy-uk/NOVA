/**
 * KPI Recovery — Config / Admin Service (P5-WP1)
 *
 * Phase 5 of the clean-sheet KPI system. Everything here is NEW and runs in
 * parallel with the untouched legacy KPI system. It provides the WRITE/config
 * surface behind the admin UI (design §10) plus a data-coverage health view:
 *
 *   1. Spaces    — edit business hours, timezone, pause statuses, active flag.
 *   2. Metrics   — enable/disable per space, set target / amber band / display
 *                  order / wallboard + SLT flags (design §9 PUT /spaces/:key/metrics).
 *   3. Tiers     — add/edit/remove NT tier definitions + per-space SLA targets.
 *   4. Holidays  — add/remove bank holidays per space (feeds the business-hours engine).
 *   5. Health    — last computation time, row counts, and gaps in daily coverage.
 *   6. Import    — handled by the existing KpiManualService (admin UI reuses it).
 *
 * All writes go through the NOVA main pool (services/database.ts). No legacy table,
 * no techservicesjsm, no forbidden table is touched. Seeding (kpi-seed.ts) is
 * insert-if-missing, so these runtime edits are preserved across restarts.
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §2, §3, §9, §10.
 */
import { query, execute, queryOne } from '../database.js';
import type { KpiEngine } from './kpi-engine.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;        // HH:MM 24h
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SpacePatch {
  displayName?: string;
  ownerName?: string | null;
  timezone?: string;
  bizHoursStart?: string;     // HH:MM
  bizHoursEnd?: string;       // HH:MM
  weekendDays?: string;       // CSV 0..6
  pauseStatuses?: string[];   // JSON array
  hasTiers?: boolean;
  isActive?: boolean;
}

export interface MetricBindingPatch {
  isEnabled?: boolean;
  targetValue?: number | null;
  amberBand?: number | null;
  displayOrder?: number;
  showOnWallboard?: boolean;
  showOnSlt?: boolean;
}

export interface TierPatch {
  tierOrder: number;
  jiraFieldValue: string | null;
  frtTargetMinutes: number | null;
  resolutionTargetMinutes: number | null;
}

/** Per-space data-coverage health row. */
export interface SpaceHealth {
  spaceKey: string;
  displayName: string;
  isJiraSpace: boolean;
  lastDailyDate: string | null;
  dailyDaysLast14: number;
  missingBusinessDaysLast14: string[];
  lastSnapshotAt: string | null;
  snapshotRowsToday: number;
  lastDigestDate: string | null;
}

export class KpiAdminService {
  constructor(private readonly engine: KpiEngine) {}

  // ── Spaces ──

  /** Patch a space's editable config. Only provided fields are written. */
  async updateSpace(spaceKey: string, patch: SpacePatch): Promise<{ updated: boolean; fields: string[] }> {
    const exists = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [spaceKey]);
    if (!exists) throw new Error('Unknown space');

    const sets: string[] = [];
    const params: unknown[] = [];
    const pushSet = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val); };

    if (patch.displayName !== undefined) pushSet('display_name', patch.displayName);
    if (patch.ownerName !== undefined) pushSet('owner_name', patch.ownerName);
    if (patch.timezone !== undefined) pushSet('timezone', patch.timezone);
    if (patch.bizHoursStart !== undefined) {
      if (!TIME_RE.test(patch.bizHoursStart)) throw new Error('bizHoursStart must be HH:MM');
      pushSet('biz_hours_start', patch.bizHoursStart);
    }
    if (patch.bizHoursEnd !== undefined) {
      if (!TIME_RE.test(patch.bizHoursEnd)) throw new Error('bizHoursEnd must be HH:MM');
      pushSet('biz_hours_end', patch.bizHoursEnd);
    }
    if (patch.weekendDays !== undefined) {
      if (!/^(\s*[0-6]\s*)(,\s*[0-6]\s*)*$/.test(patch.weekendDays)) throw new Error('weekendDays must be CSV of 0..6');
      pushSet('weekend_days', patch.weekendDays);
    }
    if (patch.pauseStatuses !== undefined) {
      if (!Array.isArray(patch.pauseStatuses)) throw new Error('pauseStatuses must be an array');
      pushSet('pause_statuses', JSON.stringify(patch.pauseStatuses));
    }
    if (patch.hasTiers !== undefined) pushSet('has_tiers', patch.hasTiers ? 1 : 0);
    if (patch.isActive !== undefined) pushSet('is_active', patch.isActive ? 1 : 0);

    if (sets.length === 0) return { updated: false, fields: [] };
    params.push(spaceKey);
    await execute(`UPDATE kpi_spaces SET ${sets.join(', ')} WHERE space_key = ?`, params);
    return { updated: true, fields: sets.map((s) => s.split(' = ')[0]) };
  }

  // ── Metric catalogue + per-space bindings ──

  /** Full metric catalogue (for the admin metric picker). */
  async listCatalogue(): Promise<Array<{ metricKey: string; displayName: string; category: string; valueType: string; direction: string; source: string; isAgentLevel: boolean; requiresTiers: boolean }>> {
    const rows = await query<{ metric_key: string; display_name: string; category: string; value_type: string; direction: string; source: string; is_agent_level: number | boolean; requires_tiers: number | boolean }>(
      `SELECT metric_key, display_name, category, value_type, direction, source, is_agent_level, requires_tiers
       FROM kpi_metric_definitions WHERE is_active = 1 ORDER BY category, display_name`,
    );
    return rows.map((r) => ({
      metricKey: r.metric_key, displayName: r.display_name, category: r.category, valueType: r.value_type,
      direction: r.direction, source: r.source,
      isAgentLevel: r.is_agent_level === true || r.is_agent_level === 1,
      requiresTiers: r.requires_tiers === true || r.requires_tiers === 1,
    }));
  }

  /** All per-space metric bindings (INCLUDING disabled) joined with the definition. */
  async listSpaceBindings(spaceKey: string): Promise<Array<{
    metricKey: string; displayName: string; category: string; valueType: string; direction: string; source: string;
    isEnabled: boolean; targetValue: number | null; amberBand: number | null; displayOrder: number;
    showOnWallboard: boolean; showOnSlt: boolean; isAgentLevel: boolean;
  }>> {
    const rows = await query<{
      metric_key: string; display_name: string; category: string; value_type: string; direction: string; source: string;
      is_enabled: number | boolean; target_value: number | null; amber_band: number | null; display_order: number | null;
      show_on_wallboard: number | boolean; show_on_slt_view: number | boolean; is_agent_level: number | boolean;
    }>(
      `SELECT d.metric_key, d.display_name, d.category, d.value_type, d.direction, d.source, d.is_agent_level,
              sm.is_enabled, sm.target_value, sm.amber_band, sm.display_order, sm.show_on_wallboard, sm.show_on_slt_view
       FROM kpi_space_metrics sm
       JOIN kpi_metric_definitions d ON d.metric_key = sm.metric_key
       WHERE sm.space_key = ?
       ORDER BY sm.display_order, d.metric_key`,
      [spaceKey],
    );
    return rows.map((r) => ({
      metricKey: r.metric_key, displayName: r.display_name, category: r.category, valueType: r.value_type,
      direction: r.direction, source: r.source,
      isEnabled: r.is_enabled === true || r.is_enabled === 1,
      targetValue: r.target_value, amberBand: r.amber_band, displayOrder: r.display_order ?? 0,
      showOnWallboard: r.show_on_wallboard === true || r.show_on_wallboard === 1,
      showOnSlt: r.show_on_slt_view === true || r.show_on_slt_view === 1,
      isAgentLevel: r.is_agent_level === true || r.is_agent_level === 1,
    }));
  }

  /**
   * Update (or create) a per-space metric binding. Creating a binding for a metric
   * not yet bound to the space inserts it enabled; targets/flags default sensibly.
   */
  async updateSpaceMetric(spaceKey: string, metricKey: string, patch: MetricBindingPatch): Promise<{ created: boolean }> {
    const space = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [spaceKey]);
    if (!space) throw new Error('Unknown space');
    const metric = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n FROM kpi_metric_definitions WHERE metric_key = ?`, [metricKey]);
    if (!metric) throw new Error('Unknown metric');

    const existing = await queryOne<{ n: number }>(
      `SELECT TOP 1 1 AS n FROM kpi_space_metrics WHERE space_key = ? AND metric_key = ?`,
      [spaceKey, metricKey],
    );

    if (!existing) {
      await execute(
        `INSERT INTO kpi_space_metrics (space_key, metric_key, is_enabled, target_value, amber_band, display_order, show_on_wallboard, show_on_slt_view)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          spaceKey, metricKey,
          patch.isEnabled === false ? 0 : 1,
          patch.targetValue ?? null,
          patch.amberBand ?? 10.0,
          patch.displayOrder ?? 0,
          patch.showOnWallboard ? 1 : 0,
          patch.showOnSlt ? 1 : 0,
        ],
      );
      return { created: true };
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const pushSet = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val); };
    if (patch.isEnabled !== undefined) pushSet('is_enabled', patch.isEnabled ? 1 : 0);
    if (patch.targetValue !== undefined) pushSet('target_value', patch.targetValue);
    if (patch.amberBand !== undefined) pushSet('amber_band', patch.amberBand);
    if (patch.displayOrder !== undefined) pushSet('display_order', patch.displayOrder);
    if (patch.showOnWallboard !== undefined) pushSet('show_on_wallboard', patch.showOnWallboard ? 1 : 0);
    if (patch.showOnSlt !== undefined) pushSet('show_on_slt_view', patch.showOnSlt ? 1 : 0);
    if (sets.length === 0) return { created: false };
    params.push(spaceKey, metricKey);
    await execute(`UPDATE kpi_space_metrics SET ${sets.join(', ')} WHERE space_key = ? AND metric_key = ?`, params);
    return { created: false };
  }

  /** Apply a batch of metric-binding patches for one space. */
  async updateSpaceMetrics(spaceKey: string, items: Array<{ metricKey: string } & MetricBindingPatch>): Promise<{ applied: number; created: number }> {
    let applied = 0; let created = 0;
    for (const it of items) {
      const { metricKey, ...patch } = it;
      const r = await this.updateSpaceMetric(spaceKey, metricKey, patch);
      applied++;
      if (r.created) created++;
    }
    return { applied, created };
  }

  // ── Tiers ──

  /** All tier rows for a space (incl. the Standard space-level SLA row). */
  async listTiers(spaceKey: string): Promise<Array<{ tierName: string; tierOrder: number; jiraFieldValue: string | null; frtTargetMinutes: number | null; resolutionTargetMinutes: number | null }>> {
    const rows = await query<{ tier_name: string; tier_order: number; jira_field_value: string | null; frt_target_minutes: number | null; resolution_target_minutes: number | null }>(
      `SELECT tier_name, tier_order, jira_field_value, frt_target_minutes, resolution_target_minutes
       FROM kpi_tier_definitions WHERE space_key = ? ORDER BY tier_order`,
      [spaceKey],
    );
    return rows.map((r) => ({
      tierName: r.tier_name, tierOrder: r.tier_order, jiraFieldValue: r.jira_field_value,
      frtTargetMinutes: r.frt_target_minutes, resolutionTargetMinutes: r.resolution_target_minutes,
    }));
  }

  /** Upsert a tier definition (idempotent per space + tier name). */
  async upsertTier(spaceKey: string, tierName: string, patch: TierPatch): Promise<void> {
    const space = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [spaceKey]);
    if (!space) throw new Error('Unknown space');
    await execute(`DELETE FROM kpi_tier_definitions WHERE space_key = ? AND tier_name = ?`, [spaceKey, tierName]);
    await execute(
      `INSERT INTO kpi_tier_definitions (space_key, tier_name, tier_order, jira_field_value, frt_target_minutes, resolution_target_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [spaceKey, tierName, patch.tierOrder, patch.jiraFieldValue, patch.frtTargetMinutes, patch.resolutionTargetMinutes],
    );
  }

  /** Remove a tier definition. */
  async deleteTier(spaceKey: string, tierName: string): Promise<{ deleted: boolean }> {
    await execute(`DELETE FROM kpi_tier_definitions WHERE space_key = ? AND tier_name = ?`, [spaceKey, tierName]);
    return { deleted: true };
  }

  // ── Holidays ──

  async listHolidays(spaceKey?: string): Promise<Array<{ id: number; spaceKey: string; holidayDate: string; description: string | null }>> {
    const rows = spaceKey
      ? await query<{ id: number; space_key: string; holiday_date: string | Date; description: string | null }>(
          `SELECT id, space_key, holiday_date, description FROM kpi_holidays WHERE space_key = ? ORDER BY holiday_date`, [spaceKey])
      : await query<{ id: number; space_key: string; holiday_date: string | Date; description: string | null }>(
          `SELECT id, space_key, holiday_date, description FROM kpi_holidays ORDER BY space_key, holiday_date`);
    return rows.map((r) => ({
      id: r.id, spaceKey: r.space_key,
      holidayDate: typeof r.holiday_date === 'string' ? r.holiday_date.slice(0, 10) : new Date(r.holiday_date).toISOString().slice(0, 10),
      description: r.description,
    }));
  }

  /** Add a holiday (idempotent per space + date). */
  async addHoliday(spaceKey: string, holidayDate: string, description: string | null): Promise<{ added: boolean }> {
    if (!DATE_RE.test(holidayDate)) throw new Error('holidayDate must be YYYY-MM-DD');
    const space = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [spaceKey]);
    if (!space) throw new Error('Unknown space');
    await execute(`DELETE FROM kpi_holidays WHERE space_key = ? AND holiday_date = ?`, [spaceKey, holidayDate]);
    await execute(`INSERT INTO kpi_holidays (space_key, holiday_date, description) VALUES (?, ?, ?)`, [spaceKey, holidayDate, description]);
    return { added: true };
  }

  async deleteHoliday(id: number): Promise<{ deleted: boolean }> {
    await execute(`DELETE FROM kpi_holidays WHERE id = ?`, [id]);
    return { deleted: true };
  }

  // ── Health / coverage ──

  /**
   * Data-coverage health for the clean-sheet platform. Surfaces gaps honestly
   * (snapshot sparsity, missing daily captures, manual-team staleness) rather
   * than hiding them — per the Phase 5 brief.
   */
  async getHealth(): Promise<{
    generatedAt: string;
    engine: Awaited<ReturnType<KpiEngine['getHealth']>>;
    spaces: SpaceHealth[];
  }> {
    const engineHealth = await this.engine.getHealth();
    const spaces = await this.engine.listSpaces();

    // Build the set of business days in the last 14 calendar days (UK Mon–Fri,
    // honouring each space's weekend days + holidays below).
    const today = new Date();
    const last14: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      last14.push(d.toISOString().slice(0, 10));
    }

    const out: SpaceHealth[] = [];
    for (const space of spaces) {
      const dailyRows = await query<{ d: string | Date }>(
        `SELECT DISTINCT report_date AS d FROM kpi_daily
         WHERE space_key = ? AND report_date >= DATEADD(day, -14, CAST(GETUTCDATE() AS DATE))`,
        [space.spaceKey],
      );
      const dailySet = new Set(dailyRows.map((r) => (typeof r.d === 'string' ? r.d.slice(0, 10) : new Date(r.d).toISOString().slice(0, 10))));
      const lastDailyRow = await queryOne<{ d: string | Date }>(
        `SELECT TOP 1 report_date AS d FROM kpi_daily WHERE space_key = ? ORDER BY report_date DESC`, [space.spaceKey]);

      // Expected business days for this space (skip its weekend + holidays).
      const expected = last14.filter((iso) => {
        const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
        if (space.weekendDays.includes(dow)) return false;
        if (space.holidays.has(iso)) return false;
        return true;
      });
      const missing = space.isJiraSpace ? expected.filter((iso) => !dailySet.has(iso)) : [];

      const lastSnap = await queryOne<{ d: string | Date | null }>(
        `SELECT MAX(snapshot_at) AS d FROM kpi_snapshots WHERE space_key = ?`, [space.spaceKey]);
      const snapToday = await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM kpi_snapshots WHERE space_key = ? AND CAST(snapshot_at AS DATE) = CAST(GETUTCDATE() AS DATE)`,
        [space.spaceKey]);
      const lastDigest = await queryOne<{ d: string | Date | null }>(
        `SELECT MAX(report_date) AS d FROM kpi_digests WHERE space_key = ?`, [space.spaceKey]);

      out.push({
        spaceKey: space.spaceKey,
        displayName: space.displayName,
        isJiraSpace: space.isJiraSpace,
        lastDailyDate: lastDailyRow ? (typeof lastDailyRow.d === 'string' ? lastDailyRow.d.slice(0, 10) : new Date(lastDailyRow.d).toISOString().slice(0, 10)) : null,
        dailyDaysLast14: dailySet.size,
        missingBusinessDaysLast14: missing,
        lastSnapshotAt: lastSnap?.d ? new Date(lastSnap.d).toISOString() : null,
        snapshotRowsToday: snapToday?.n ?? 0,
        lastDigestDate: lastDigest?.d ? (typeof lastDigest.d === 'string' ? lastDigest.d.slice(0, 10) : new Date(lastDigest.d).toISOString().slice(0, 10)) : null,
      });
    }

    return { generatedAt: new Date().toISOString(), engine: engineHealth, spaces: out };
  }
}
