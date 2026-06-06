// Live (un-frozen) snapshot of the Support/NT KPIs for the wallboard. The stored
// kpi_org_daily values freeze at 18:00; a TV wallboard wants current numbers, so
// this recomputes on demand and caches for 60s to avoid hammering Jira when
// several displays refresh on the 30s cycle. Manual KPIs fall back to their
// latest stored value (they can't be computed).

import type { JiraRestClient } from '../jira-client.js';
import { SUPPORT_NT_KPIS, computeRag } from './registry.js';
import { computeNtKpi } from './nt-compute.js';
import { getLatest } from './store.js';

export interface LiveKpiItem {
  key: string;
  label: string;
  colA: string;
  unit: string;
  value: number | null;
  target: number | null;
  rag: 'green' | 'amber' | 'red' | null;
  manual: boolean;
}

export interface LiveSnapshot {
  day: string;
  updatedAt: number;
  items: LiveKpiItem[];
}

const TTL_MS = 60_000;
let cache: LiveSnapshot | null = null;
let inflight: Promise<LiveSnapshot> | null = null;

function ukDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}
function addDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Live Support/NT snapshot, cached 60s. Concurrent callers share one compute. */
export async function getSupportLiveSnapshot(jira: JiraRestClient): Promise<LiveSnapshot> {
  if (cache && Date.now() - cache.updatedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = buildSnapshot(jira).finally(() => { inflight = null; });
  return inflight;
}

async function buildSnapshot(jira: JiraRestClient): Promise<LiveSnapshot> {
  const now = new Date();
  const day = ukDay(now);
  const ctx = { day, nextDay: addDay(day) };

  const stored = await getLatest('Support').catch(() => []);
  const manualVal = new Map<string, number | null>(stored.map(r => [r.kpi_key, r.value] as [string, number | null]));

  const items: LiveKpiItem[] = [];
  for (const kpi of SUPPORT_NT_KPIS) {
    let value: number | null;
    if (kpi.compute.kind === 'manual') {
      value = manualVal.get(kpi.key) ?? null;
    } else {
      try {
        const r = await computeNtKpi(kpi, jira, ctx, now);
        value = r.failed ? null : r.value;
      } catch {
        value = null;
      }
    }
    items.push({
      key: kpi.key, label: kpi.label, colA: kpi.colA, unit: kpi.unit,
      value, target: kpi.dailyTarget, rag: computeRag(kpi, value), manual: kpi.compute.kind === 'manual',
    });
  }

  cache = { day, updatedAt: Date.now(), items };
  return cache;
}
