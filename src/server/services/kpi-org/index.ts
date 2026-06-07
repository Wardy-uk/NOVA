// Org KPI capture orchestration (Layer 1). Computes every Jira-backed Support/NT
// KPI for the day and freezes it into kpi_org_daily. Manual KPIs are skipped so
// their entered values survive. Designed to run at ~18:00 UK (the agreed freeze).

import type { JiraRestClient } from '../jira-client.js';
import { SUPPORT_NT_KPIS, type DayCtx } from './registry.js';
import { computeNtKpi } from './nt-compute.js';
import { ensureOrgKpiTable, saveComputed } from './store.js';

export { ensureOrgKpiTable, getDay, getLatest, getRange, setManualValue } from './store.js';
export { ORG_KPIS, SUPPORT_NT_KPIS, getKpi } from './registry.js';
export { getOrgPeriod, type Period } from './period.js';
export { backfillOrg, startOrgBackfill, getLegacyEarliest, orgBackfillState } from './backfill.js';

/** UK-local calendar date (YYYY-MM-DD). */
function ukDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/** The day after a YYYY-MM-DD string. */
function addDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface CaptureSummary {
  day: string;
  computed: number;
  failed: number;
  skipped: number;
  failures: string[];
}

/**
 * Capture all Support/NT KPIs for the given instant's UK day. Never throws —
 * per-KPI failures are collected and reported. A failed compute does NOT
 * overwrite a previously stored value (we skip the save).
 */
export async function captureSupportNt(jira: JiraRestClient, now: Date = new Date()): Promise<CaptureSummary> {
  await ensureOrgKpiTable();
  const day = ukDay(now);
  const ctx: DayCtx = { day, nextDay: addDay(day) };
  const summary: CaptureSummary = { day, computed: 0, failed: 0, skipped: 0, failures: [] };

  for (const kpi of SUPPORT_NT_KPIS) {
    if (kpi.compute.kind === 'manual') { summary.skipped++; continue; }
    try {
      const result = await computeNtKpi(kpi, jira, ctx, now);
      if (result.failed) {
        summary.failed++;
        summary.failures.push(kpi.key);
        continue; // don't clobber a prior value with null
      }
      const source = kpi.compute.kind === 'escalation_log' ? 'escalation_log' : 'jira';
      await saveComputed(kpi, day, result.value, source);
      summary.computed++;
    } catch (err) {
      summary.failed++;
      summary.failures.push(kpi.key);
      console.warn(`[kpi-org] compute failed for ${kpi.key}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[kpi-org] Support/NT capture ${day}: ${summary.computed} computed, ${summary.failed} failed, ${summary.skipped} manual`);
  return summary;
}
