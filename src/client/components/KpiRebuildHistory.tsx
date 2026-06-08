import { Fragment, useEffect, useState } from 'react';

// Daily-history table for the rebuilt KPIs — laid out like the legacy Daily
// History view: KPI/agent rows × date columns, with target + RAG dots, grouped.
// Departmental tab → /api/kpi-org/support/history-grid; Agent tab → /api/kpi-agent/history-grid.

const RAG: Record<string, string> = { green: '#10b981', amber: '#eab308', red: '#ef4444' };
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const ddmm = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
const mondayOf = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; };

interface Cell { value: number | null; rag: string | null }
interface DeptRow { key: string; label: string; unit: string; target: number | null; cells: Record<string, Cell> }
interface DeptGroup { name: string; rows: DeptRow[] }
interface AgentRow { accountId: string; agentName: string; tierCode: string; cells: Record<string, Cell> }

const AGENT_METRICS = [
  ['solvedToday', 'Solved'], ['open', 'Open'], ['overSla', 'Over SLA'], ['noReply', 'No Reply'],
  ['oldestDays', 'Oldest (d)'], ['qaOverall', 'QA'], ['csatAvg', 'CSAT'], ['slaCompliancePct', 'SLA %'], ['ticketsPerHour', 'Tkts/hr'],
] as const;

function Dot({ rag }: { rag: string | null }) {
  if (!rag) return null;
  return <span className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle" style={{ background: RAG[rag] }} />;
}

export function KpiRebuildHistory() {
  const today = new Date();
  const [tab, setTab] = useState<'dept' | 'agent'>('dept');
  const [from, setFrom] = useState(iso(mondayOf(today)));
  const [to, setTo] = useState(iso(today));
  const [metric, setMetric] = useState('solvedToday');
  const [dates, setDates] = useState<string[]>([]);
  const [groups, setGroups] = useState<DeptGroup[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      if (tab === 'dept') {
        const r = await fetch(`/api/kpi-org/support/history-grid?from=${from}&to=${to}`);
        const j = await r.json();
        if (j.ok) { setDates(j.data.dates); setGroups(j.data.groups); } else setError(j.error);
      } else {
        const r = await fetch(`/api/kpi-agent/history-grid?from=${from}&to=${to}&metric=${metric}`);
        const j = await r.json();
        if (j.ok) { setDates(j.data.dates); setAgents(j.data.rows); } else setError(j.error);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [tab, from, to, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  function quick(kind: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'last30') {
    const t = new Date();
    if (kind === 'thisWeek') { setFrom(iso(mondayOf(t))); setTo(iso(t)); }
    else if (kind === 'lastWeek') { const m = mondayOf(t); const lwEnd = new Date(m); lwEnd.setDate(m.getDate() - 1); const lwStart = new Date(m); lwStart.setDate(m.getDate() - 7); setFrom(iso(lwStart)); setTo(iso(lwEnd)); }
    else if (kind === 'thisMonth') { const s = new Date(t.getFullYear(), t.getMonth(), 1); setFrom(iso(s)); setTo(iso(t)); }
    else { const s = new Date(t); s.setDate(t.getDate() - 29); setFrom(iso(s)); setTo(iso(t)); }
  }

  const fmt = (v: number | null, unit: string) => v == null ? '' : unit === 'percent' || unit === 'days' ? `${v}${unit === 'percent' ? '%' : 'd'}` : String(v);
  const qbtn = 'px-2.5 py-1 text-xs rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-slate-300';
  const th = 'px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-center font-medium';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Daily History <span className="text-sm font-normal text-slate-400">(rebuild)</span></h1>
        <div className="flex rounded-lg overflow-hidden border border-white/10 text-sm">
          {(['dept', 'agent'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? 'bg-blue-600 text-white' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'}`}>
              {t === 'dept' ? 'Departmental' : 'Agent'}
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
        {tab === 'agent' && (
          <select value={metric} onChange={e => setMetric(e.target.value)} className="ml-2 px-2 py-1 text-sm rounded bg-black/30 border border-white/10">
            {AGENT_METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-left sticky left-0 bg-[#1c2128]">{tab === 'dept' ? 'KPI' : 'Agent'}</th>
                {tab === 'dept' && <th className={th}>Target</th>}
                {dates.map(d => <th key={d} className={th}>{ddmm(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {tab === 'dept' && groups.map(g => (
                <Fragment key={g.name}>
                  <tr className="bg-white/[0.04]"><td colSpan={dates.length + 2} className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-cyan-400 font-semibold">{g.name}</td></tr>
                  {g.rows.map(row => (
                    <tr key={row.key} className="border-t border-white/5">
                      <td className="px-3 py-2 sticky left-0 bg-[#1a1f26]">{row.label}</td>
                      <td className="px-3 py-2 text-center text-slate-500">{row.target ?? ''}</td>
                      {dates.map(d => {
                        const c = row.cells[d];
                        return <td key={d} className="px-3 py-2 text-center whitespace-nowrap">{c && c.value != null ? <>{fmt(c.value, row.unit)}<Dot rag={c.rag} /></> : <span className="text-slate-700">·</span>}</td>;
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {tab === 'agent' && agents.map(a => (
                <tr key={a.accountId} className="border-t border-white/5">
                  <td className="px-3 py-2 sticky left-0 bg-[#1a1f26]">{a.agentName}<span className="text-[10px] text-slate-500 ml-1.5">{a.tierCode}</span></td>
                  {dates.map(d => {
                    const c = a.cells[d];
                    return <td key={d} className="px-3 py-2 text-center whitespace-nowrap">{c && c.value != null ? <>{c.value}<Dot rag={c.rag} /></> : <span className="text-slate-700">·</span>}</td>;
                  })}
                </tr>
              ))}
              {((tab === 'dept' && !groups.length) || (tab === 'agent' && !agents.length)) && (
                <tr><td colSpan={dates.length + 2} className="px-3 py-8 text-center text-slate-500">No history in range — run a capture or backfill first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
