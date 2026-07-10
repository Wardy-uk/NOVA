import React, { useEffect, useState } from 'react';

interface AgentRow {
  agent: string;
  resolved: number;
  linksSent: number;
  adoptionPct: number | null;
  ratingsReceived: number;
  responsePct: number | null;
  avgRating: number | null;
}
interface Metrics {
  from: string;
  to: string;
  team: {
    resolved: number;
    linksSent: number;
    adoptionPct: number | null;
    ratingsReceived: number;
    responsePct: number | null;
    avgRating: number | null;
  };
  agents: AgentRow[];
}

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const ragColor = (v: number | null, good: number, ok: number) =>
  v == null ? '#94a3b8' : v >= good ? '#16a34a' : v >= ok ? '#d97706' : '#dc2626';

export function CsatAdoptionView() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    const qs = `?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
    fetch(`/api/csat-metrics${qs}`)
      .then(r => r.json())
      .then(res => (res.ok ? setData(res.data) : setError(res.error)))
      .catch(() => setError('Failed to load metrics'));
  }, [days]);

  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading CSAT adoption…</div>;

  const Tile = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1 min-w-[150px]">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: color || '#0f172a' }}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  const t = data.team;
  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-slate-800">CSAT Adoption &amp; Response</h2>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="text-sm border border-slate-300 rounded-lg px-2 py-1"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        The experiment is whether agents run the macro. Adoption = resolved tickets with a public{' '}
        <code>/portal/csat/</code> link. Response = ratings received ÷ links sent. Window {data.from} → {data.to}.
      </p>

      <div className="flex gap-3 flex-wrap mb-6">
        <Tile label="Resolved" value={String(t.resolved)} sub="tickets in window" />
        <Tile label="Links sent" value={String(t.linksSent)} sub="public CSAT link posted" />
        <Tile label="Adoption" value={pct(t.adoptionPct)} sub="links ÷ resolved" color={ragColor(t.adoptionPct, 30, 10)} />
        <Tile label="Ratings" value={String(t.ratingsReceived)} sub="responses received" />
        <Tile label="Response" value={pct(t.responsePct)} sub="ratings ÷ links" color={ragColor(t.responsePct, 15, 5)} />
        <Tile label="Avg rating" value={t.avgRating != null ? `${t.avgRating}/5` : '—'} color={ragColor(t.avgRating, 4, 3)} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2">Agent</th>
              <th className="text-right px-3 py-2">Resolved</th>
              <th className="text-right px-3 py-2">Links</th>
              <th className="text-right px-3 py-2">Adoption</th>
              <th className="text-right px-3 py-2">Ratings</th>
              <th className="text-right px-3 py-2">Response</th>
              <th className="text-right px-4 py-2">Avg</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map(a => (
              <tr key={a.agent} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-700">{a.agent}</td>
                <td className="px-3 py-2 text-right">{a.resolved}</td>
                <td className="px-3 py-2 text-right">{a.linksSent}</td>
                <td className="px-3 py-2 text-right font-semibold" style={{ color: ragColor(a.adoptionPct, 30, 10) }}>{pct(a.adoptionPct)}</td>
                <td className="px-3 py-2 text-right">{a.ratingsReceived}</td>
                <td className="px-3 py-2 text-right" style={{ color: ragColor(a.responsePct, 15, 5) }}>{pct(a.responsePct)}</td>
                <td className="px-4 py-2 text-right" style={{ color: ragColor(a.avgRating, 4, 3) }}>{a.avgRating != null ? a.avgRating : '—'}</td>
              </tr>
            ))}
            {data.agents.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No resolved tickets in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
