import { Fragment, useEffect, useState } from 'react';

// Legacy KPIs daily-history grid, rendered in the rebuild look (Tailwind, RAG dots).
// Now sourced from the NEW kpi-org engine (kpi_org_daily) via
// /api/kpi-org/support/legacy-history, returned in the legacy daily-history shape.
// KPI order + grouping + the "Reportable" subset mirror the legacy view names.

interface DailyKpi {
  kpi: string;
  kpiGroup: string;
  count: number;
  target: number | null;
  direction: string | null;
  rag: number | null; // 1 = green, 2 = amber, 3 = red
  CreatedAt: string;
}

const RAG: Record<number, string> = { 1: '#10b981', 2: '#eab308', 3: '#ef4444' };
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const ddmm = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
const mondayOf = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; };

// Fixed KPI display order (matches the legacy Daily History view).
const KPI_ORDER: string[] = [
  'New Tickets Today',
  'Tickets Solved Today',
  'Solved by NOVA',
  'CSAT %',
  'Number of Tickets in Customer Care',
  'Number of Tickets in CC (Incidents)',
  'Number of Tickets in CC (Service Requests)',
  'Number of Tickets in CC (TPJ)',
  'Number of Tickets in Production',
  'Number of Tickets in Tier 2',
  'Number of Tickets in Tier 3',
  'Number of Tickets in Development',
  'Number of Tickets With No Reply in CC (Incidents)',
  'Number of Tickets With No Reply in CC (Service Requests)',
  'Number of Tickets With No Reply in CC (TPJ)',
  'Number of Tickets With No Reply in Production',
  'Number of Tickets With No Reply in Development',
  'Number of Tickets With No Reply in Tier 2',
  'Number of Tickets With No Reply in Tier 3',
  'CC Incidents over SLA (actionable)',
  'CC Service Requests over SLA (actionable)',
  'CC (TPJ) over SLA (actionable)',
  'CC TPJ over SLA (actionable)',
  'Production over SLA (actionable)',
  'Tier 2 over SLA (actionable)',
  'Tier 3 over SLA (actionable)',
  'Development over SLA (actionable)',
  'CC Incidents over SLA (not actionable)',
  'CC Service Requests over SLA (not actionable)',
  'CC (TPJ) over SLA (not actionable)',
  'CC TPJ over SLA (not actionable)',
  'Production over SLA (not actionable)',
  'Tier 2 over SLA (not actionable)',
  'Tier 3 over SLA (not actionable)',
  'Development over SLA (not actionable)',
  'Tickets escalated to Tier 2',
  'Tickets escalated to Tier 3',
  'Tickets escalated to Development',
  'Tickets rejected by Tier 2',
  'Tickets rejected by Tier 3',
  'Tickets rejected by Development',
  'Oldest actionable ticket (days) in CC Incidents',
  'Oldest actionable ticket (days) in CC Service Requests',
  'Oldest actionable ticket (days) in CC (TPJ)',
  'Oldest actionable ticket (days) in CC TPJ',
  'Oldest actionable ticket (days) in Production',
  'Oldest actionable ticket (days) in Development',
  'Oldest actionable ticket (days) in Tier 2',
  'Oldest actionable ticket (days) in Tier 3',
  "WTD percentage KPI's Green",
  "WTD percentage KPI's Red",
];

const REPORTABLE_KPIS = new Set([
  'Number of Tickets in CC (Incidents)',
  'Number of Tickets in CC (Service Requests)',
  'Number of Tickets in CC (TPJ)',
  'Number of Tickets in Production',
  'Number of Tickets in Tier 2',
  'Number of Tickets in Tier 3',
  'Number of Tickets in Development',
  'Number of Tickets With No Reply in CC (Incidents)',
  'Number of Tickets With No Reply in CC (Production)',
  'Number of Tickets With No Reply in CC (TPJ)',
  'Number of Tickets With No Reply in Tier 2',
  'Number of Tickets With No Reply in Tier 3',
  'Number of CC tickets over SLA (actionable) (Incidents)',
  'Number of CC tickets over SLA (actionable) (Production)',
  'Number of CC tickets over SLA (actionable) (TPJ)',
  'Number of Tier 2 tickets over SLA (actionable)',
  'Number of Tier 3 tickets over SLA (actionable)',
  'Number of CC tickets over SLA (Not actionable) (Incidents)',
  'Number of CC tickets over SLA (Not actionable) (Production)',
  'Number of CC tickets over SLA (Not actionable) (TPJ)',
  'Number of Tier 2 tickets over SLA (not actionable)',
  'Number of Tier 3 tickets over SLA (not actionable)',
  'Tickets escalated to Tier 2',
  'Tickets escalated to Tier 3',
  'Tickets escalated to Development',
  'Tickets rejected by Tier 2',
  'Tickets rejected by Tier 3',
  'Tickets rejected by Development',
  'Oldest actionable ticket (days) in CC (Incident)',
  'Oldest actionable ticket (days) in CC (Production)',
  'Oldest actionable ticket (days) in CC (TPJ)',
  'Oldest actionable ticket (days) in Production',
  'Oldest actionable ticket (days) in Tier 2',
  'Oldest actionable ticket (days) in Tier 3',
].map(k => k.toLowerCase()));

// Rows are grouped by the KPI's registry category, so these two would otherwise be
// filed under Support / Quality further down the page. They belong at the top with
// the daily volume numbers, so pull them into the Legacy block.
const GROUP_OVERRIDE: Record<string, string> = {
  'Solved by NOVA': 'Legacy',
  'CSAT %': 'Legacy',
};

function Dot({ rag }: { rag: number | null }) {
  if (rag == null || !RAG[rag]) return null;
  return <span className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle" style={{ background: RAG[rag] }} />;
}

export function KpiRebuildLegacy() {
  const today = new Date();
  const [env, setEnv] = useState<'live' | 'uat'>('live');
  const [from, setFrom] = useState(iso(mondayOf(today)));
  const [to, setTo] = useState(iso(today));
  const [reportableOnly, setReportableOnly] = useState(false);
  const [rows, setRows] = useState<DailyKpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/kpi-org/support/legacy-history?from=${from}&to=${to}`);
      const j = await r.json();
      if (j.ok) setRows(j.data as DailyKpi[]);
      else setError(j.error || 'Failed to load');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [env, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  function quick(kind: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'last30') {
    const t = new Date();
    if (kind === 'thisWeek') { setFrom(iso(mondayOf(t))); setTo(iso(t)); }
    else if (kind === 'lastWeek') { const m = mondayOf(t); const lwEnd = new Date(m); lwEnd.setDate(m.getDate() - 1); const lwStart = new Date(m); lwStart.setDate(m.getDate() - 7); setFrom(iso(lwStart)); setTo(iso(lwEnd)); }
    else if (kind === 'thisMonth') { const s = new Date(t.getFullYear(), t.getMonth(), 1); setFrom(iso(s)); setTo(iso(t)); }
    else { const s = new Date(t); s.setDate(t.getDate() - 29); setFrom(iso(s)); setTo(iso(t)); }
  }

  // Pivot: unique sorted dates + lookup by "kpi|date".
  const dates = [...new Set(rows.map(d => d.CreatedAt.slice(0, 10)))].sort();
  const cellMap = new Map<string, DailyKpi>();
  rows.forEach(d => cellMap.set(`${d.kpi}|${d.CreatedAt.slice(0, 10)}`, d));
  const groupMap = new Map<string, string>();
  rows.forEach(d => groupMap.set(d.kpi, GROUP_OVERRIDE[d.kpi] ?? d.kpiGroup));
  const allKpiNames = [...new Set(rows.map(d => d.kpi))];
  const allOrdered = [
    ...KPI_ORDER.filter(k => allKpiNames.includes(k)),
    ...allKpiNames.filter(k => !KPI_ORDER.includes(k)),
  ];
  const orderedKpis = reportableOnly ? allOrdered.filter(k => REPORTABLE_KPIS.has(k.toLowerCase())) : allOrdered;
  const seenGroups: string[] = [];
  for (const kpi of orderedKpis) {
    const g = groupMap.get(kpi) || 'Other';
    if (!seenGroups.includes(g)) seenGroups.push(g);
  }
  const groups = seenGroups.map(g => ({ name: g, kpis: orderedKpis.filter(k => (groupMap.get(k) || 'Other') === g) }));
  const targetOf = (kpi: string) => { for (const d of dates) { const c = cellMap.get(`${kpi}|${d}`); if (c?.target != null) return c.target; } return null; };

  const qbtn = 'px-2.5 py-1 text-xs rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-slate-300';
  const th = 'px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-center font-medium';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Legacy KPIs <span className="text-sm font-normal text-slate-400">(daily history)</span></h1>
        <div className="flex rounded-lg overflow-hidden border border-white/10 text-sm">
          {(['live', 'uat'] as const).map(e => (
            <button key={e} onClick={() => setEnv(e)} className={`px-3 py-1.5 ${env === e ? 'bg-blue-600 text-white' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'}`}>
              {e === 'live' ? 'Live' : 'UAT'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="text-xs text-slate-400">From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1 text-sm rounded bg-black/30 border border-white/10" />
        <label className="text-xs text-slate-400">To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1 text-sm rounded bg-black/30 border border-white/10" />
        <button onClick={() => quick('thisWeek')} className={qbtn}>This Week</button>
        <button onClick={() => quick('lastWeek')} className={qbtn}>Last Week</button>
        <button onClick={() => quick('thisMonth')} className={qbtn}>This Month</button>
        <button onClick={() => quick('last30')} className={qbtn}>Last 30 Days</button>
        <button
          onClick={() => setReportableOnly(v => !v)}
          className={`ml-2 px-2.5 py-1 text-xs rounded-md border ${reportableOnly ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300' : 'bg-white/[0.05] border-white/10 text-slate-300 hover:bg-white/[0.1]'}`}
        >Reportable only</button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-left sticky left-0 bg-[#1c2128]">KPI</th>
                <th className={th}>Target</th>
                {dates.map(d => <th key={d} className={th}>{ddmm(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <Fragment key={g.name}>
                  <tr className="bg-white/[0.04]"><td colSpan={dates.length + 2} className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-cyan-400 font-semibold">{g.name}</td></tr>
                  {g.kpis.map(kpi => (
                    <tr key={kpi} className="border-t border-white/5">
                      <td className="px-3 py-2 sticky left-0 bg-[#1a1f26]">{kpi}</td>
                      <td className="px-3 py-2 text-center text-slate-500">{targetOf(kpi) ?? ''}</td>
                      {dates.map(d => {
                        const c = cellMap.get(`${kpi}|${d}`);
                        return <td key={d} className="px-3 py-2 text-center whitespace-nowrap">{c && c.count != null ? <>{c.count}<Dot rag={c.rag} /></> : <span className="text-slate-700">·</span>}</td>;
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {!groups.length && (
                <tr><td colSpan={dates.length + 2} className="px-3 py-8 text-center text-slate-500">No legacy KPI data in range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
