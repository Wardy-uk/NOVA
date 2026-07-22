// Org KPI backfill — FULL Jira reconstruction. Every non-manual sum/latest KPI is
// recomputed per historic day directly from Jira/escalation_log (source='reconstruct'):
//   • Flows (New / Solved / Escalated): date-bounded (created / resolutiondate) — exact.
//   • Open-stock counts (tier volumes, oldest): reconstructed AS OF each day via
//     NT_OPEN_ASOF (status WAS NOT Closed/Resolved ON day) — validated vs live wallboard.
// It no longer copies the legacy dbo.jira_kpi_daily values (those were inflated 2–3×).
// Not reconstructed here (left blank): over-SLA/FRT-breach stocks (need per-ticket SLA
// cycle parsing) and no-reply (its fields aren't versioned in Jira's changelog).

import type { JiraRestClient } from '../jira-client.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import { getKpiPool } from '../kpi-pipeline.js';
import { SUPPORT_NT_KPIS } from './registry.js';
import { computeNtKpi } from './nt-compute.js';
import { saveComputed } from './store.js';

function* dateRange(from: string, to: string): Generator<string> {
  const end = new Date(`${to}T00:00:00Z`);
  for (const d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}
function addDay(day: string): string { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// Progress state for the (potentially long-running) org backfill.
export interface OrgBackfillState {
  running: boolean; from: string | null; to: string | null;
  totalDays: number; doneDays: number; flowKpis: number; stockRows: number;
  error: string | null; finishedAt: string | null;
}
export const orgBackfillState: OrgBackfillState = {
  running: false, from: null, to: null, totalDays: 0, doneDays: 0, flowKpis: 0, stockRows: 0, error: null, finishedAt: null,
};

/** Earliest available historic date in each legacy source table. */
export async function getLegacyEarliest(settings: SettingsQueries): Promise<{ org: string | null; agent: string | null }> {
  const pool = await getKpiPool(settings);
  const org = await pool.request().query(`SELECT CONVERT(varchar(10), MIN(CreatedAt), 23) AS d FROM dbo.jira_kpi_daily`);
  const agent = await pool.request().query(`SELECT CONVERT(varchar(10), MIN(ReportDate), 23) AS d FROM dbo.jira_agent_kpi_daily`);
  return { org: (org.recordset[0] as { d: string | null })?.d ?? null, agent: (agent.recordset[0] as { d: string | null })?.d ?? null };
}

/** Kick off a full org backfill in the background (returns immediately). Poll orgBackfillState. */
export function startOrgBackfill(settings: SettingsQueries, jira: JiraRestClient, fromDay: string, toDay: string): { started: boolean; totalDays: number } {
  if (orgBackfillState.running) return { started: false, totalDays: orgBackfillState.totalDays };
  let total = 0; for (const _d of dateRange(fromDay, toDay)) total++;
  Object.assign(orgBackfillState, { running: true, from: fromDay, to: toDay, totalDays: total, doneDays: 0, flowKpis: 0, stockRows: 0, error: null, finishedAt: null });
  backfillOrg(settings, jira, fromDay, toDay)
    .then(r => { orgBackfillState.stockRows = r.stockRows; })
    .catch(e => { orgBackfillState.error = e instanceof Error ? e.message : String(e); })
    .finally(() => { orgBackfillState.running = false; orgBackfillState.finishedAt = new Date().toISOString(); });
  return { started: true, totalDays: total };
}

export async function backfillOrg(settings: SettingsQueries, jira: JiraRestClient, fromDay: string, toDay: string): Promise<{ flowDays: number; flowKpis: number; stockRows: number; failures: string[] }> {
  const failures: string[] = [];
  // Reconstruct every non-manual flow (sum) + stock (latest) KPI from Jira. Stocks use
  // asOf (NT_OPEN_ASOF); flows are date-bounded so asOf is irrelevant. Skip the expensive
  // resolved-today outcome family (rollup 'average') — not on the tracker and slow to
  // reconstruct 200+ days. no_reply is EXCLUDED so its existing stored values are left
  // untouched (its fields aren't versioned in Jira, so it can't be reconstructed and
  // must not be blanked).
  const defs = SUPPORT_NT_KPIS.filter(k =>
    k.compute.kind !== 'manual' && k.compute.kind !== 'no_reply' && (k.rollup === 'sum' || k.rollup === 'latest'));

  let days = 0, written = 0;
  for (const day of dateRange(fromDay, toDay)) {
    const ctx = { day, nextDay: addDay(day) };
    const now = new Date(`${day}T18:00:00Z`);
    for (const kpi of defs) {
      const asOf = kpi.rollup === 'latest';
      try {
        const r = await computeNtKpi(kpi, jira, { ...ctx, asOf }, now);
        if (!r.failed) { await saveComputed(kpi, day, r.value, 'reconstruct'); written++; }
        else failures.push(`${day}:${kpi.key}`);
      } catch { failures.push(`${day}:${kpi.key}`); }
    }
    days++;
    orgBackfillState.doneDays = days;
    orgBackfillState.flowKpis = written;
  }

  console.log(`[kpi-org] backfill(reconstruct) ${fromDay}→${toDay}: ${written} values (${days} days), ${failures.length} failures`);
  return { flowDays: days, flowKpis: written, stockRows: 0, failures: failures.slice(0, 20) };
}
