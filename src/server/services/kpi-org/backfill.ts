// Org KPI backfill — HYBRID. Flows (New / Solved Team+NOVA / Escalated / Rejected)
// are recomputed per historic day from Jira + escalation_log (consistent with the
// new definitions, source='backfill-jira'). Stocks (open/over-SLA/oldest etc.) are
// pulled best-effort from the legacy dbo.jira_kpi_daily by mapping the old tier-KPI
// names onto the new Support keys (source='backfill-legacy', APPROXIMATE — the old
// tier bucketing differs from the new Incident/Production/Development buckets).

import sql from 'mssql';
import type { JiraRestClient } from '../jira-client.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import { getKpiPool } from '../kpi-pipeline.js';
import { SUPPORT_NT_KPIS } from './registry.js';
import { computeNtKpi } from './nt-compute.js';
import { saveComputed, upsertDaily } from './store.js';
import { computeRag, getKpi } from './registry.js';

// new stock key → nearest legacy dbo.jira_kpi_daily KPI name (n8nKpiName format).
// APPROXIMATE: old slices (CC Incidents / Production tiers) ≠ new request-type buckets.
const STOCK_MAP: Record<string, string> = {
  nt_incidents: 'Number of Tickets in CC (Incidents)',
  nt_production: 'Number of Tickets in Production',
  nt_development: 'Number of Tickets in Development',
  nt_incidents_no_reply: 'Number of Tickets With No Reply in CC (Incidents)',
  nt_production_no_reply: 'Number of Tickets With No Reply in Production',
  nt_incidents_sla_actionable: 'CC Incidents over SLA (actionable)',
  nt_production_sla_actionable: 'Production over SLA (actionable)',
  nt_incidents_sla_not_actionable: 'CC Incidents over SLA (not actionable)',
  nt_production_sla_not_actionable: 'Production over SLA (not actionable)',
  nt_oldest_incident: 'Oldest actionable ticket (days) in CC Incidents',
  nt_oldest_production: 'Oldest actionable ticket (days) in Production',
  nt_oldest_development: 'Oldest actionable ticket (days) in Development',
  nt_tpj_tickets: 'Number of Tickets in CC (TPJ)',
};

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
  const flowKpiDefs = SUPPORT_NT_KPIS.filter(k => k.rollup === 'sum' && k.compute.kind !== 'manual');

  // ── Flows: recompute per day from Jira / escalation_log ──
  let flowDays = 0, flowKpis = 0;
  for (const day of dateRange(fromDay, toDay)) {
    const ctx = { day, nextDay: addDay(day) };
    for (const kpi of flowKpiDefs) {
      try {
        const r = await computeNtKpi(kpi, jira, ctx, new Date(`${day}T18:00:00Z`));
        if (!r.failed) { await saveComputed(kpi, day, r.value, 'backfill-jira'); flowKpis++; }
        else failures.push(`${day}:${kpi.key}`);
      } catch { failures.push(`${day}:${kpi.key}`); }
    }
    flowDays++;
    orgBackfillState.doneDays = flowDays;
    orgBackfillState.flowKpis = flowKpis;
  }

  // ── Stocks: pull from legacy dbo.jira_kpi_daily, mapped onto new keys ──
  // STOCK_MAP (3-bucket approx) + every colA='Legacy' stock KPI, whose label IS the
  // legacy KPI name → exact back-history for the repointed Legacy KPIs view. One
  // legacy name can map to several new keys (e.g. nt_incidents + nt_legacy_cc_incidents).
  const stockMap: Record<string, string> = {
    ...STOCK_MAP,
    ...Object.fromEntries(SUPPORT_NT_KPIS.filter(k => k.colA === 'Legacy' && k.rollup === 'latest').map(k => [k.key, k.label])),
  };
  let stockRows = 0;
  try {
    const pool = await getKpiPool(settings);
    const req = pool.request();
    req.input('from', sql.Date, fromDay);
    req.input('to', sql.Date, toDay);
    const legacyNames = [...new Set(Object.values(stockMap))];
    const inList = legacyNames.map((_, i) => `@k${i}`).join(', ');
    legacyNames.forEach((nm, i) => req.input(`k${i}`, sql.NVarChar(300), nm));
    const result = await req.query(`
      SELECT kpi, count, CONVERT(varchar(10), CreatedAt, 23) AS d
      FROM dbo.jira_kpi_daily
      WHERE CAST(CreatedAt AS DATE) >= @from AND CAST(CreatedAt AS DATE) <= @to AND kpi IN (${inList})
    `);
    const nameToKeys = new Map<string, string[]>();
    for (const [key, name] of Object.entries(stockMap)) {
      const arr = nameToKeys.get(name) ?? []; arr.push(key); nameToKeys.set(name, arr);
    }
    for (const row of result.recordset as Array<{ kpi: string; count: number; d: string }>) {
      const value = row.count == null ? null : Number(row.count);
      for (const key of nameToKeys.get(row.kpi) ?? []) {
        const def = getKpi(key);
        if (!def) continue;
        await upsertDaily(row.d, 'Support', key, value, def.dailyTarget, computeRag(def, value), 'backfill-legacy');
        stockRows++;
      }
    }
  } catch (err) {
    failures.push(`stocks: ${err instanceof Error ? err.message : 'failed'}`);
  }

  console.log(`[kpi-org] backfill ${fromDay}→${toDay}: flows ${flowKpis} (${flowDays} days), stockRows ${stockRows}, ${failures.length} failures`);
  return { flowDays, flowKpis, stockRows, failures: failures.slice(0, 20) };
}
