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
  }

  // ── Stocks: pull from legacy dbo.jira_kpi_daily, mapped onto new keys ──
  let stockRows = 0;
  try {
    const pool = await getKpiPool(settings);
    const req = pool.request();
    req.input('from', sql.Date, fromDay);
    req.input('to', sql.Date, toDay);
    const legacyNames = Object.values(STOCK_MAP);
    const inList = legacyNames.map((_, i) => `@k${i}`).join(', ');
    legacyNames.forEach((nm, i) => req.input(`k${i}`, sql.NVarChar(300), nm));
    const result = await req.query(`
      SELECT kpi, count, CONVERT(varchar(10), CreatedAt, 23) AS d
      FROM dbo.jira_kpi_daily
      WHERE CAST(CreatedAt AS DATE) >= @from AND CAST(CreatedAt AS DATE) <= @to AND kpi IN (${inList})
    `);
    const nameToKey = new Map(Object.entries(STOCK_MAP).map(([k, v]) => [v, k]));
    for (const row of result.recordset as Array<{ kpi: string; count: number; d: string }>) {
      const key = nameToKey.get(row.kpi);
      const def = key ? getKpi(key) : undefined;
      if (!key || !def) continue;
      const value = row.count == null ? null : Number(row.count);
      await upsertDaily(row.d, 'Support', key, value, def.dailyTarget, computeRag(def, value), 'backfill-legacy');
      stockRows++;
    }
  } catch (err) {
    failures.push(`stocks: ${err instanceof Error ? err.message : 'failed'}`);
  }

  console.log(`[kpi-org] backfill ${fromDay}→${toDay}: flows ${flowKpis} (${flowDays} days), stockRows ${stockRows}, ${failures.length} failures`);
  return { flowDays, flowKpis, stockRows, failures: failures.slice(0, 20) };
}
