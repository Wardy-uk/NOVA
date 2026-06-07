import { useEffect, useState } from 'react';

// Layer-3 per-agent scorecard (rebuild). Reads /api/kpi-agent/live — the new
// agent engine: tier-1 operational (computed fresh), tier-2 quality (read from
// the QA/GR/CSAT pipelines), tier-3 derived + configurable RAG.

interface AgentRow {
  accountId: string; agentName: string; tierCode: string; team: string;
  open: number; overSla: number; noReply: number; oldestDays: number; oldestKey: string | null;
  solvedToday: number; solvedWeek: number;
  qaOverall: number | null; qaScored: number; grOverall: number | null;
  csatAvg: number | null; csatCount: number;
  slaCompliancePct: number | null; ticketsPerHour: number | null;
  rag: Record<string, string | null>;
}

const RAG: Record<string, string> = { green: '#10b981', amber: '#eab308', red: '#ef4444' };
const col = (rag?: string | null) => (rag ? RAG[rag] : '#e2e8f0');
const num = (v: number | null) => (v == null ? '—' : String(v));

type ViewPeriod = 'live' | 'week' | 'month';

export function AgentScorecardRebuild() {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<ViewPeriod>('live');

  async function load() {
    setLoading(true);
    try {
      if (period === 'live') {
        const r = await fetch('/api/kpi-agent/live');
        const j = await r.json();
        if (j.ok) { setRows(j.data.agents ?? []); setLive(j.data.live ?? false); setError(null); }
        else setError(j.error ?? 'Failed to load');
      } else {
        const r = await fetch(`/api/kpi-agent/period?period=${period}`);
        const j = await r.json();
        if (j.ok) {
          setLive(false);
          setRows((j.data.agents as Array<Record<string, unknown>>).map(a => ({
            accountId: a.accountId as string, agentName: a.agentName as string, tierCode: a.tierCode as string, team: a.team as string,
            open: a.open as number, overSla: a.overSla as number, noReply: a.noReply as number,
            oldestDays: a.oldestDays as number, oldestKey: null,
            solvedToday: a.solved as number, solvedWeek: a.days as number,
            qaOverall: a.qaOverall as number | null, qaScored: 0, grOverall: null,
            csatAvg: a.csatAvg as number | null, csatCount: 0,
            slaCompliancePct: a.slaCompliancePct as number | null, ticketsPerHour: a.ticketsPerHour as number | null,
            rag: a.rag as Record<string, string | null>,
          })));
          setError(null);
        } else setError(j.error ?? 'Failed to load');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runCapture() {
    setBusy(true);
    try { const r = await fetch('/api/kpi-agent/capture', { method: 'POST' }); const j = await r.json(); if (!j.ok) setError(j.error ?? j.data?.error ?? 'Capture failed'); await load(); }
    finally { setBusy(false); }
  }

  async function runBackfill() {
    const to = new Date(); to.setDate(to.getDate() - 1);
    const from = new Date(); from.setDate(from.getDate() - 90);
    const f = from.toLocaleDateString('en-CA'); const t = to.toLocaleDateString('en-CA');
    if (!confirm(`Backfill agent history ${f} → ${t} from the legacy daily snapshot?`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/kpi-agent/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: f, to: t }) });
      const j = await r.json();
      if (j.ok) alert(`Backfill done: ${j.data.rows} agent-rows over ${j.data.days} days.`);
      else setError(j.error ?? 'Backfill failed');
    } catch (e) { setError(e instanceof Error ? e.message : 'Backfill failed'); }
    finally { setBusy(false); }
  }

  const sorted = [...rows].sort((a, b) => b.overSla - a.overSla || b.noReply - a.noReply);
  const th = (l: string) => <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-center">{l}</th>;
  const td = (v: string | number, rag?: string | null) => (
    <td className="px-3 py-2 text-center text-base font-bold" style={{ color: col(rag) }}>{v}</td>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Agent KPIs <span className="text-sm font-normal text-slate-400">(Layer 3 — rebuild)</span></h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-white/10 text-sm">
            {(['live', 'week', 'month'] as ViewPeriod[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 ${period === p ? 'bg-blue-600 text-white' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'}`}>
                {p === 'live' ? 'Today' : p === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          {period === 'live' && (
            <>
              <button onClick={runCapture} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
                {busy ? 'Working…' : 'Run capture now'}
              </button>
              <button onClick={runBackfill} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50">
                Backfill 90d
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        {period === 'live' ? (live ? 'Live (60s-cached)' : 'Latest stored snapshot') : `${period === 'week' ? 'Week-to-date' : 'Month-to-date'} — Solved summed, stocks/scores averaged`} · Roster: dbo.Agent
      </p>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse">
            <thead className="bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-left">Agent</th>
                {th('Open')}{th('Over SLA')}{th('No Reply')}{th('Oldest')}{th(period === 'live' ? 'Solved Today' : 'Solved')}{th(period === 'live' ? 'Solved Wk' : 'Days')}{th('QA')}{th('CSAT')}{th('SLA %')}{th('Tkts/hr')}
              </tr>
            </thead>
            <tbody>
              {sorted.map(a => (
                <tr key={a.accountId} className="border-t border-white/5">
                  <td className="px-3 py-2 text-sm">{a.agentName}<span className="text-[10px] text-slate-500 ml-1.5">{a.tierCode}</span></td>
                  {td(a.open)}
                  {td(a.overSla, a.rag.over2h)}
                  {td(a.noReply, a.rag.stale)}
                  {td(`${a.oldestDays}d`, a.rag.oldest)}
                  {td(a.solvedToday)}
                  {td(a.solvedWeek)}
                  {td(num(a.qaOverall), a.rag.qa)}
                  {td(num(a.csatAvg), a.rag.csat)}
                  {td(a.slaCompliancePct == null ? '—' : `${a.slaCompliancePct}%`, a.rag.sla)}
                  {td(num(a.ticketsPerHour), a.rag.productivity)}
                </tr>
              ))}
              {!sorted.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">No agents</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
