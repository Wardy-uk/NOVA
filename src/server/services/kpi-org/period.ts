// Weekly / monthly rollups for the org (dept) KPIs. Aggregates the stored daily
// rows (kpi_org_daily) per each KPI's rollup rule: flows = sum, stocks =
// latest / average. Period targets + RAG bands are scaled by the number of days
// for sum metrics so a weekly total is judged against a weekly target.

import { getTeamRange, type OrgKpiDailyRow } from './store.js';
import { ORG_KPIS, computeRag, type OrgKpi } from './registry.js';

export type Period = 'week' | 'month';

export interface PeriodKpi {
  key: string;
  label: string;
  colA: string;
  unit: string;
  rollup: string;
  value: number | null;
  target: number | null;
  rag: 'green' | 'amber' | 'red' | null;
  days: number;          // days with data in the window
}

function startOf(period: Period, anchor: string): string {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (period === 'month') { d.setUTCDate(1); return d.toISOString().slice(0, 10); }
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Aggregate a KPI's daily values per its rollup rule. */
function aggregate(rollup: string, values: number[]): number | null {
  if (!values.length) return null;
  switch (rollup) {
    case 'sum': return values.reduce((s, v) => s + v, 0);
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
    case 'average': return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
    case 'latest':
    default: return values[values.length - 1]; // rows are date-ordered
  }
}

/** RAG against a period target; for sum metrics the daily bands scale by #days. */
function periodRag(kpi: OrgKpi, value: number | null, days: number): 'green' | 'amber' | 'red' | null {
  if (value == null) return null;
  const scale = kpi.rollup === 'sum' ? Math.max(1, days) : 1;
  const scaled: OrgKpi = {
    ...kpi,
    rag: {
      greenMax: kpi.rag.greenMax != null ? kpi.rag.greenMax * scale : undefined,
      amberMax: kpi.rag.amberMax != null ? kpi.rag.amberMax * scale : undefined,
      greenMin: kpi.rag.greenMin != null ? kpi.rag.greenMin * scale : undefined,
      amberMin: kpi.rag.amberMin != null ? kpi.rag.amberMin * scale : undefined,
    },
  };
  return computeRag(scaled, value);
}

/** Period rollup for a team (e.g. 'Support'). `anchor` defaults to today (UK). */
export async function getOrgPeriod(teamKey: string, period: Period, anchor: string): Promise<{ period: Period; from: string; to: string; kpis: PeriodKpi[] }> {
  const from = startOf(period, anchor);
  const rows = await getTeamRange(teamKey, from, anchor);

  const byKey = new Map<string, OrgKpiDailyRow[]>();
  for (const r of rows) {
    if (!byKey.has(r.kpi_key)) byKey.set(r.kpi_key, []);
    if (r.value != null) byKey.get(r.kpi_key)!.push(r);
  }

  const kpis: PeriodKpi[] = ORG_KPIS.filter(k => k.team === teamKey).map(kpi => {
    const daily = byKey.get(kpi.key) ?? [];
    const values = daily.map(d => d.value as number);
    const value = aggregate(kpi.rollup, values);
    const days = daily.length;
    const target = kpi.dailyTarget == null ? null : (kpi.rollup === 'sum' ? kpi.dailyTarget * Math.max(1, days) : kpi.dailyTarget);
    return {
      key: kpi.key, label: kpi.label, colA: kpi.colA, unit: kpi.unit, rollup: kpi.rollup,
      value, target, rag: periodRag(kpi, value, days), days,
    };
  });

  return { period, from, to: anchor, kpis };
}
