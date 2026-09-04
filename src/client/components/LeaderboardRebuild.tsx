import { useEffect, useMemo, useState } from 'react';
import { isNovaAi } from '../utils/agentFilters.js';

// Layer-3 agent leaderboard (rebuild). Reads /api/kpi-agent/period — ranks agents by
// a composite 0–100 score (mean of available normalised metrics) or by a single
// category. Daily/weekly/monthly windows, team + tier filters. Replaces the legacy
// KpiLeaderboardView (which read the retiring kpi-data tables).

interface PeriodRow {
  accountId: string; agentName: string; tierCode: string; team: string; days: number;
  solved: number; open: number | null; overSla: number | null; noReply: number | null;
  qaOverall: number | null; csatAvg: number | null; slaCompliancePct: number | null; ticketsPerHour: number | null;
  hasActivity: boolean;
  productivityScore: number | null; slaScore: number | null; qualityScore: number | null;
  compositeScore: number; points: number;
  rag: Record<string, string | null>;
}

type Tab = 'combined' | 'productivity' | 'sla' | 'quality';
type Period = 'day' | 'week' | 'month';

const scoreColor = (v: number | null) => (v == null ? '#e2e8f0' : v >= 75 ? '#10b981' : v >= 50 ? '#eab308' : '#ef4444');
const num = (v: number | null, dp = 0) => (v == null ? '—' : v.toFixed(dp));

export function LeaderboardRebuild() {
  const [rows, setRows] = useState<PeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('combined');
  const [period, setPeriod] = useState<Period>('day');
  const [team, setTeam] = useState('');
  const [tier, setTier] = useState('');
  // NOVA AI is not a person and always tops a solve-based board, which makes the
  // human rankings hard to read. Off by default; when shown it appears greyed at the
  // bottom for comparison WITHOUT taking a rank or shifting anyone else down.
  const [showNovaAi, setShowNovaAi] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/kpi-agent/period?period=${period}`);
      const j = await r.json();
      if (j.ok) { setRows(j.data.agents ?? []); setError(null); }
      else setError(j.error ?? 'Failed to load');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const teams = useMemo(() => [...new Set(rows.map(r => r.team).filter(Boolean))].sort(), [rows]);
  const tiers = useMemo(() => [...new Set(rows.map(r => r.tierCode).filter(Boolean))].sort(), [rows]);

  const key = (r: PeriodRow): number => {
    switch (tab) {
      case 'productivity': return r.productivityScore ?? -1;
      case 'sla': return r.slaScore ?? -1;
      case 'quality': return r.qualityScore ?? -1;
      default: return r.compositeScore;
    }
  };
  const isNova = (r: PeriodRow) => isNovaAi(r.agentName);

  // Ranked = people who actually worked in this window. Everyone else is shown
  // below, greyed and unranked: an agent on leave has null productivity and null
  // SLA, and a mean over "available metrics" then scores them on stale QA alone —
  // which put people who were on holiday all week above people who worked it.
  const { ranked, reference } = useMemo(() => {
    const filtered = rows.filter(r => (!team || r.team === team) && (!tier || r.tierCode === tier));
    const sortFn = (a: PeriodRow, b: PeriodRow) => key(b) - key(a) || b.solved - a.solved;
    return {
      ranked: filtered.filter(r => r.hasActivity && !isNova(r)).sort(sortFn),
      reference: filtered.filter(r => !r.hasActivity || isNova(r))
        .filter(r => !isNova(r) || showNovaAi)
        .sort(sortFn),
    };
  }, [rows, tab, team, tier, showNovaAi]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = (l: string, left = false) => <th className={`px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 ${left ? 'text-left' : 'text-center'}`}>{l}</th>;
  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)} className={`px-3 py-1.5 text-sm rounded-lg ${tab === id ? 'bg-blue-600' : 'bg-white/[0.06] hover:bg-white/[0.1]'}`}>{label}</button>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Leaderboard <span className="text-sm font-normal text-slate-400">(Layer 3 — rebuild)</span></h1>
        <div className="flex items-center gap-2">
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 text-sm rounded-lg capitalize ${period === p ? 'bg-blue-600' : 'bg-white/[0.06] hover:bg-white/[0.1]'}`}>
              {p === 'day' ? 'Daily' : p === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Model A composite, 0–100: SLA 50 / throughput 30 / tickets-per-hour 20, redistributed over the dimensions present.
        QA and CSAT are context, not ranked on — QA sampling is not comparable between agents and CSAT coverage is a fraction of a percent.
        SLA % only counts once an agent has resolved 5+ in the period, so a perfect score off one ticket cannot outrank real throughput.
        Agents with no activity are listed below, unranked.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <TabBtn id="combined" label="Combined" />
        <TabBtn id="productivity" label="Productivity" />
        <TabBtn id="sla" label="SLA" />
        <TabBtn id="quality" label="Quality" />
        <div className="flex-1" />
        <select value={team} onChange={e => setTeam(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg bg-white/[0.06] border border-white/10">
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={tier} onChange={e => setTier(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg bg-white/[0.06] border border-white/10">
          <option value="">All tiers</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => setShowNovaAi(v => !v)}
          title="Show NOVA AI for comparison. It is listed unranked, so the human positions do not move."
          className={`px-3 py-1.5 text-sm rounded-lg border ${showNovaAi ? 'bg-white/[0.12] border-white/20' : 'bg-white/[0.06] border-white/10 hover:bg-white/[0.1]'}`}
        >{showNovaAi ? 'Hide NOVA AI' : 'Show NOVA AI'}</button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse">
            <thead className="bg-white/[0.03]">
              <tr>
                {th('#')}{th('Agent', true)}{th('Score')}{th('Solved')}{th('Tkts/hr')}{th('SLA %')}{th('QA')}{th('CSAT')}{th('Over SLA')}{th('Points')}
              </tr>
            </thead>
            <tbody>
              {ranked.map((a, i) => (
                <tr key={a.accountId} className="border-t border-white/5">
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 text-sm">{a.agentName}<span className="text-[10px] text-slate-500 ml-1.5">{a.tierCode}{a.team ? ` · ${a.team}` : ''}</span></td>
                  <td className="px-3 py-2 text-center text-base font-bold" style={{ color: scoreColor(a.compositeScore) }}>{Math.round(a.compositeScore)}</td>
                  <td className="px-3 py-2 text-center text-sm">{a.solved}</td>
                  <td className="px-3 py-2 text-center text-sm" style={{ color: scoreColor(a.productivityScore) }}>{num(a.ticketsPerHour, 1)}</td>
                  <td className="px-3 py-2 text-center text-sm" style={{ color: scoreColor(a.slaScore) }}>{a.slaCompliancePct == null ? '—' : `${Math.round(a.slaCompliancePct)}%`}</td>
                  <td className="px-3 py-2 text-center text-sm" style={{ color: scoreColor(a.qualityScore) }}>{num(a.qaOverall, 1)}</td>
                  <td className="px-3 py-2 text-center text-sm" style={{ color: a.rag.csat ? scoreColor(a.rag.csat === 'green' ? 100 : a.rag.csat === 'amber' ? 60 : 0) : undefined }}>{num(a.csatAvg, 1)}</td>
                  <td className="px-3 py-2 text-center text-sm" style={{ color: a.rag.over2h ? scoreColor(a.rag.over2h === 'green' ? 100 : a.rag.over2h === 'amber' ? 60 : 0) : undefined }}>{num(a.overSla)}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{a.points}</td>
                </tr>
              ))}
              {!ranked.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">No agents</td></tr>}

              {reference.length > 0 && (
                <tr className="border-t border-white/10 bg-white/[0.02]">
                  <td colSpan={10} className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                    Not ranked — no activity in this period
                  </td>
                </tr>
              )}
              {reference.map(a => (
                <tr key={a.accountId} className="border-t border-white/5 opacity-45">
                  <td className="px-3 py-2 text-center text-sm text-slate-600">—</td>
                  <td className="px-3 py-2 text-sm text-slate-400">
                    {a.agentName}
                    <span className="text-[10px] text-slate-500 ml-1.5">{a.tierCode}{a.team ? ` · ${a.team}` : ''}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-base font-bold text-slate-500">{Math.round(a.compositeScore)}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{a.solved}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{num(a.ticketsPerHour, 1)}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{a.slaCompliancePct == null ? '—' : `${Math.round(a.slaCompliancePct)}%`}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{num(a.qaOverall, 1)}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{num(a.csatAvg, 1)}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">{num(a.overSla)}</td>
                  <td className="px-3 py-2 text-center text-sm text-slate-500">{a.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
