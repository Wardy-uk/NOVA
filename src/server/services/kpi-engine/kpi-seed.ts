/**
 * KPI Recovery — Foundation Seeding (P1-WP1)
 *
 * Idempotent INSERT-if-missing seeding of spaces, metric definitions, per-space
 * metric bindings, and NT tier definitions. Uses INSERT-if-not-exists (not
 * blanket upsert) so runtime edits to targets / business hours / pause statuses
 * are preserved across restarts — targets stay configurable per design §13.3.
 *
 * Source data: kpi-catalogue.ts. Source of truth: KPI-Clean-Sheet-Design.md.
 */
import { execute, queryOne } from '../database.js';
import { SPACES, METRICS, SPACE_METRICS, TIER_DEFS } from './kpi-catalogue.js';

async function exists(sqlText: string, params: unknown[]): Promise<boolean> {
  const row = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n ${sqlText}`, params);
  return !!row;
}

async function seedSpaces(): Promise<number> {
  let inserted = 0;
  for (const s of SPACES) {
    if (await exists('FROM kpi_spaces WHERE space_key = ?', [s.spaceKey])) continue;
    await execute(
      `INSERT INTO kpi_spaces
         (space_key, jira_project, display_name, owner_name, timezone,
          biz_hours_start, biz_hours_end, weekend_days, pause_statuses,
          has_tiers, is_jira_space, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        s.spaceKey, s.jiraProject, s.displayName, s.ownerName, s.timezone,
        s.bizStart, s.bizEnd, s.weekendDays, JSON.stringify(s.pauseStatuses),
        s.hasTiers, s.isJiraSpace,
      ],
    );
    inserted++;
  }
  return inserted;
}

async function seedMetrics(): Promise<number> {
  let inserted = 0;
  for (const m of METRICS) {
    if (await exists('FROM kpi_metric_definitions WHERE metric_key = ?', [m.metricKey])) continue;
    await execute(
      `INSERT INTO kpi_metric_definitions
         (metric_key, display_name, description, category, value_type, direction,
          aggregation, source, computation_key, requires_tiers, is_agent_level, is_active)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        m.metricKey, m.displayName, m.category, m.valueType, m.direction,
        m.aggregation ?? 'snapshot', m.source ?? 'computed',
        m.computationKey ?? null, m.requiresTiers ? 1 : 0, m.isAgentLevel ? 1 : 0,
      ],
    );
    inserted++;
  }
  return inserted;
}

async function seedSpaceMetrics(): Promise<number> {
  let inserted = 0;
  for (const sm of SPACE_METRICS) {
    if (await exists('FROM kpi_space_metrics WHERE space_key = ? AND metric_key = ?', [sm.spaceKey, sm.metricKey])) continue;
    await execute(
      `INSERT INTO kpi_space_metrics
         (space_key, metric_key, is_enabled, target_value, amber_band,
          display_order, show_on_wallboard, show_on_slt_view)
       VALUES (?, ?, 1, ?, 10.0, ?, ?, ?)`,
      [
        sm.spaceKey, sm.metricKey, sm.target ?? null,
        sm.order ?? 0, sm.showOnWallboard ? 1 : 0, sm.showOnSlt ? 1 : 0,
      ],
    );
    inserted++;
  }
  return inserted;
}

async function seedTiers(): Promise<number> {
  let inserted = 0;
  for (const t of TIER_DEFS) {
    if (await exists('FROM kpi_tier_definitions WHERE space_key = ? AND tier_name = ?', [t.spaceKey, t.tierName])) continue;
    await execute(
      `INSERT INTO kpi_tier_definitions
         (space_key, tier_name, tier_order, jira_field_value, frt_target_minutes, resolution_target_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [t.spaceKey, t.tierName, t.tierOrder, t.jiraFieldValue, t.frtTargetMinutes, t.resolutionTargetMinutes],
    );
    inserted++;
  }
  return inserted;
}

export interface SeedCounts { spaces: number; metrics: number; bindings: number; tiers: number; }

let seeded = false;
let lastCounts: SeedCounts = { spaces: 0, metrics: 0, bindings: 0, tiers: 0 };

/** Seed the foundation idempotently. Inserts only missing rows. Returns insert counts. */
export async function seedKpiFoundation(force = false): Promise<SeedCounts> {
  if (seeded && !force) return lastCounts;
  const spaces = await seedSpaces();
  const metrics = await seedMetrics();
  const bindings = await seedSpaceMetrics();
  const tiers = await seedTiers();
  seeded = true;
  lastCounts = { spaces, metrics, bindings, tiers };
  console.log(
    `[kpi-engine] foundation seeded — spaces +${spaces}, metrics +${metrics}, ` +
    `bindings +${bindings}, tiers +${tiers} (existing rows preserved).`,
  );
  return lastCounts;
}
