import { Fragment, useEffect, useState } from 'react';

// Operational Indicators — operational metrics for the KPI Rebuild area, sourced
// ENTIRELY from the NOVA-only kpi-org engine via /api/kpi-org/support/legacy-history
// (kpi_org_daily, team 'Support'). This tab used to read the legacy jira_kpi_daily
// table, which is written by BOTH n8n and NOVA's old kpi-pipeline (they race) — so
// the numbers were non-deterministic. The rebuild area must be NOVA-only; this tab
// now reads the same engine as every other Rebuild tab. KPI names match the labels
// in kpi-org/registry.ts (the 'Legacy' colA slice) exactly.
//
// Scope is deliberately counts + age only. The %-based metrics (SLA compliance %,
// FRT/Resolution compliance %, CSAT %, FCR, Escalation Accuracy %) are Performance/
// Quality indicators and belong to later stages, not this tab.

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

// Per-tier queues, in board order (matches kpi-pipeline ALL_TIERS).
const TIERS = ['CC (Incidents)', 'CC (Service Requests)', 'CC (TPJ)', 'Production', 'Tier 2', 'Tier 3', 'Development'] as const;
// "Not actionable" SLA breaches are not tracked for Development (matches the pipeline).
const NOT_ACTIONABLE_TIERS = TIERS.filter(t => t !== 'Development');

// Mirror of services/kpi-pipeline.ts n8nKpiName(): bare form strips parens for
// sentence-style names, except CC (TPJ) which keeps them.
const bare = (tier: string) => tier === 'CC (TPJ)' ? 'CC (TPJ)' : tier.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

// Operational KPI groups → ordered list of stored KPI names.
const GROUPS: { name: string; kpis: string[] }[] = [
  {
    name: 'Throughput & Queue Health',
    kpis: ['New Tickets Today', 'Tickets Solved Today', 'Open Tickets', 'Unassigned', 'Waiting on Requestor', 'SLA Breached'],
  },
  { name: 'Backlog by Queue', kpis: TIERS.map(t => `Number of Tickets in ${t}`) },
  { name: 'Hygiene — No Reply by Queue', kpis: TIERS.map(t => `Number of Tickets With No Reply in ${t}`) },
  { name: 'Age — Oldest Actionable (days)', kpis: TIERS.map(t => `Oldest actionable ticket (days) in ${bare(t)}`) },
  { name: 'Resolution SLA Breaches (actionable)', kpis: TIERS.map(t => `${bare(t)} over SLA (actionable)`) },
  { name: 'Resolution SLA Breaches (not actionable)', kpis: NOT_ACTIONABLE_TIERS.map(t => `${bare(t)} over SLA (not actionable)`) },
  { name: 'FRT Breaches (actionable)', kpis: TIERS.map(t => `${bare(t)} FRT breached (actionable)`) },
  { name: 'FRT Breaches (not actionable)', kpis: NOT_ACTIONABLE_TIERS.map(t => `${bare(t)} FRT breached (not actionable)`) },
  {
    name: 'Escalations & Rejections',
    kpis: [
      'Tickets escalated to Tier 2', 'Tickets escalated to Tier 3', 'Tickets escalated to Development',
      'Tickets rejected by Tier 2', 'Tickets rejected by Tier 3', 'Tickets rejected by Development',
    ],
  },
];

function Dot({ rag }: { rag: number | null }) {
  if (rag == null || !RAG[rag]) return null;
  return <span className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle" style={{ background: RAG[rag] }} />;
}

export function OperationalIndicators() {
  const today = new Date();
  const [from, setFrom] = useState(iso(mondayOf(today)));
  const [to, setTo] = useState(iso(today));
  const [rows, setRows] = useState<DailyKpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/kpi-org/support/legacy-history?from=${from}&to=${to}&liveToday=1`);
      const j = await r.json();
      if (j.ok) setRows(j.data as DailyKpi[]);
      else setError(j.error || 'Failed to load');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const present = new Set(rows.map(d => d.kpi));
  // Only show defined operational KPIs that are actually captured in the range,
  // preserving group + tier order. Uncaptured rows are simply omitted.
  const groups = GROUPS
    .map(g => ({ name: g.name, kpis: g.kpis.filter(k => present.has(k)) }))
    .filter(g => g.kpis.length > 0);
  const targetOf = (kpi: string) => { for (const d of dates) { const c = cellMap.get(`${kpi}|${d}`); if (c?.target != null) return c.target; } return null; };
  const totalRows = groups.reduce((n, g) => n + g.kpis.length, 0);

  const qbtn = 'px-2.5 py-1 text-xs rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-slate-300';
  const th = 'px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-center font-medium';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Operational Indicators <span className="text-sm font-normal text-slate-400">(today live · prior days frozen · NOVA engine)</span></h1>
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
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-left sticky left-0 bg-[#1c2128]">Indicator</th>
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
              {!totalRows && (
                <tr><td colSpan={dates.length + 2} className="px-3 py-8 text-center text-slate-500">No operational indicators captured in range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
