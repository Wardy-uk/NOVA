// Org KPI capture orchestration (Layer 1). Computes every Jira-backed Support/NT
// KPI for the day and freezes it into kpi_org_daily. Manual KPIs are skipped so
// their entered values survive. Designed to run at ~18:00 UK (the agreed freeze).

import type { JiraRestClient } from '../jira-client.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import { SUPPORT_NT_KPIS, type DayCtx } from './registry.js';
import { computeNtKpi } from './nt-compute.js';
import { ensureOrgKpiTable, saveComputed } from './store.js';
import { startOrgBackfill, getLegacyEarliest } from './backfill.js';

export { ensureOrgKpiTable, getDay, getLatest, getRange, getTeamRange, setManualValue } from './store.js';
export { ORG_KPIS, SUPPORT_NT_KPIS, getKpi } from './registry.js';
export { getOrgPeriod, getOrgHistoryGrid, type Period } from './period.js';
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

/**
 * Re-capture the FLOW KPIs (rollup=sum, e.g. New Tickets / Solved) for a completed
 * UK day. The 18:00 freeze only sees tickets created/solved up to 18:00, so the
 * evening is lost; once the day is over its date-bounded JQL yields the true full-day
 * total. Only flows are touched — stocks (open counts) are point-in-time and must keep
 * their 18:00 snapshot. Never throws.
 */
export async function recaptureSupportFlows(jira: JiraRestClient, day: string): Promise<{ day: string; computed: number; failed: number }> {
  await ensureOrgKpiTable();
  const ctx: DayCtx = { day, nextDay: addDay(day) };
  const now = new Date(`${day}T18:00:00Z`); // freeze instant is irrelevant for flow JQLs
  const flows = SUPPORT_NT_KPIS.filter(k => k.rollup === 'sum' && k.compute.kind !== 'manual');
  let computed = 0, failed = 0;
  for (const kpi of flows) {
    try {
      const r = await computeNtKpi(kpi, jira, ctx, now);
      if (r.failed) { failed++; continue; }
      const source = kpi.compute.kind === 'escalation_log' ? 'escalation_log' : 'jira';
      await saveComputed(kpi, day, r.value, source);
      computed++;
    } catch (err) {
      failed++;
      console.warn(`[kpi-org] flow re-capture failed for ${kpi.key} on ${day}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[kpi-org] flow re-capture ${day}: ${computed} computed, ${failed} failed`);
  return { day, computed, failed };
}

/**
 * Recompute the late-data KPIs (currently CSAT) across a trailing window of days.
 * A customer can rate a ticket long after it was solved, so the 18:00 freeze always
 * undercounts and a single yesterday-re-capture isn't enough — a rating that lands
 * three days later would never be counted at all. Never throws.
 */
export async function recaptureSupportLateData(
  jira: JiraRestClient, endDay: string, days = 7,
): Promise<{ computed: number; failed: number }> {
  await ensureOrgKpiTable();
  const kpis = SUPPORT_NT_KPIS.filter(k => k.lateData && k.compute.kind !== 'manual');
  let computed = 0, failed = 0;
  for (let back = 0; back < days; back++) {
    const d = new Date(`${endDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const day = d.toISOString().slice(0, 10);
    const ctx: DayCtx = { day, nextDay: addDay(day) };
    for (const kpi of kpis) {
      try {
        const r = await computeNtKpi(kpi, jira, ctx, new Date(`${day}T18:00:00Z`));
        if (r.failed) { failed++; continue; }
        await saveComputed(kpi, day, r.value, 'jira');
        computed++;
      } catch (err) {
        failed++;
        console.warn(`[kpi-org] late-data re-capture failed for ${kpi.key} on ${day}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.log(`[kpi-org] late-data re-capture ending ${endDay} (${days}d): ${computed} computed, ${failed} failed`);
  return { computed, failed };
}

/**
 * Startup tasks for the org engine — run fire-and-forget from the server bootstrap
 * so the Legacy KPIs view populates after a deploy without anyone POSTing:
 *   1. Initial history backfill — once (settings flag), capped to the last 90 days.
 *   2. A fresh capture of today's column — at most once per UK day from startup
 *      (the 18:00 job still runs the daily freeze).
 * Never throws.
 */
export async function runKpiOrgStartupTasks(settings: SettingsQueries, jira: JiraRestClient): Promise<void> {
  const isoMinus = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

  // 1. One-time initial backfill (last 90 days of history).
  try {
    if (settings.get('kpi_org_initial_backfill_v1') !== 'done') {
      const earliest = await getLegacyEarliest(settings).catch(() => ({ org: null, agent: null }));
      const cap = isoMinus(90);
      const from = earliest.org && earliest.org > cap ? earliest.org : cap;
      startOrgBackfill(settings, jira, from, isoMinus(1));
      settings.set('kpi_org_initial_backfill_v1', 'done');
      console.log(`[kpi-org] startup: initial backfill kicked off ${from}→${isoMinus(1)}`);
    }
  } catch (err) {
    console.warn('[kpi-org] startup backfill failed:', err instanceof Error ? err.message : err);
  }

  // 2. Capture today's column (once per UK day from startup).
  try {
    const today = ukDay(new Date());
    if (settings.get('kpi_org_startup_capture_day') !== today) {
      await captureSupportNt(jira);
      settings.set('kpi_org_startup_capture_day', today);
      // Yesterday is now complete — re-capture its flows to correct the 18:00 partial-day
      // freeze (evening tickets). Once per UK day, so a mid-morning restart still fixes it.
      const y = new Date(); y.setUTCDate(y.getUTCDate() - 1);
      await recaptureSupportFlows(jira, ukDay(y));
    }
  } catch (err) {
    console.warn('[kpi-org] startup capture failed:', err instanceof Error ? err.message : err);
  }
}
