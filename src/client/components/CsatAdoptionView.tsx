import React, { useEffect, useState } from 'react';

// CSAT Adoption & Response — dark theme, matching the other KPI (Rebuild) tabs.
// Two halves: the aggregate (are agents running the macro?) and the individual
// ratings behind it (what did customers actually say?). The second half is the
// point — an average of one rating tells you nothing; the comment does.

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
interface ResponseRow {
  issueKey: string;
  summary: string;
  agent: string;
  score: number | null;
  firstScore: number | null;
  revisionCount: number;
  comment: string | null;
  respondedAt: string;
  ticketStatus: string | null;
  ratedUnresolved: boolean;
  ticketAgeHours: number | null;
}
interface Detail {
  mode: 'resolved' | 'rated';
  agent: string | null;
  limit: number;
  truncated: boolean;
  responses: ResponseRow[];
}

// Local date — never toISOString(), which shifts the day either side of midnight.
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
// RAG tuned for the dark shell (the light-theme greens/reds were unreadable on it).
const ragColor = (v: number | null, good: number, ok: number) =>
  v == null ? '#64748b' : v >= good ? '#10b981' : v >= ok ? '#eab308' : '#ef4444';
const scoreColor = (n: number | null) =>
  n == null ? '#64748b' : n >= 4 ? '#10b981' : n >= 3 ? '#eab308' : '#ef4444';

const when = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function Stars({ n }: { n: number | null }) {
  if (n == null) return <span className="text-slate-600">—</span>;
  return (
    <span style={{ color: scoreColor(n) }} className="tracking-tight">
      {'★'.repeat(n)}<span className="text-slate-700">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export function CsatAdoptionView() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [reload, setReload] = useState(0);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [mode, setMode] = useState<'resolved' | 'rated'>('resolved');
  const [agent, setAgent] = useState<string | null>(null);

  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  const range = `from=${iso(from)}&to=${iso(to)}`;

  useEffect(() => {
    setError(null);
    fetch(`/api/csat-metrics?${range}`)
      .then(r => r.json())
      .then(res => (res.ok ? setData(res.data) : setError(res.error)))
      .catch(() => setError('Failed to load metrics'));
  }, [days, reload]);

  // Deliberately gated on `data`: the NOVA database is frequently at 100% data IO,
  // and firing both queries at once is how one of them misses the 30s timeout.
  useEffect(() => {
    if (!data) return;
    setDetailLoading(true);
    setDetailError(null);
    const qs = `${range}&mode=${mode}${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`;
    fetch(`/api/csat-metrics/responses?${qs}`)
      .then(r => r.json())
      .then(res => (res.ok ? setDetail(res.data) : setDetailError(res.error)))
      .catch(() => setDetailError('Failed to load individual ratings'))
      .finally(() => setDetailLoading(false));
  }, [data, mode, agent]);

  const qbtn = 'px-2.5 py-1 text-xs rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-slate-300';
  const qbtnOn = 'px-2.5 py-1 text-xs rounded-md bg-blue-600 text-white';
  const th = 'px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-right font-medium';

  if (error) {
    // A timeout here is almost always the database being saturated by the Jira
    // sync, not a broken screen — say which, and give a way to try again without
    // a page reload. A bare red driver message reads as "this view is broken".
    const timedOut = /timed out|timeout/i.test(error);
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-3">CSAT Adoption &amp; Response</h1>
        <div className="rounded-xl border border-amber-600/40 bg-amber-500/[0.07] p-4 max-w-2xl">
          <div className="text-amber-300 font-semibold text-sm mb-1">
            {timedOut ? 'Couldn’t load — the database is busy' : 'Couldn’t load CSAT metrics'}
          </div>
          <div className="text-slate-400 text-sm">{error}</div>
          <button
            onClick={() => { setError(null); setData(null); setReload(n => n + 1); }}
            className="mt-3 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-slate-400">Loading CSAT adoption…</div>;

  const Tile = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 flex-1 min-w-[140px]">
      <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: color || '#e2e8f0' }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );

  const t = data.team;
  const rows = detail?.responses ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">
          CSAT Adoption &amp; Response{' '}
          <span className="text-sm font-normal text-slate-400">({data.from} → {data.to})</span>
        </h1>
        <div className="flex gap-1.5">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} className={days === d ? qbtnOn : qbtn}>Last {d} days</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-4 max-w-3xl">
        The experiment is whether agents run the macro. Adoption = resolved tickets carrying a public{' '}
        <code className="text-slate-400">/portal/csat/</code> link ÷ resolved. Response = ratings received ÷ links sent.
      </p>

      <div className="flex gap-3 flex-wrap mb-6">
        <Tile label="Resolved" value={String(t.resolved)} sub="tickets in window" />
        <Tile label="Links sent" value={String(t.linksSent)} sub="public CSAT link posted" />
        <Tile label="Adoption" value={pct(t.adoptionPct)} sub="links ÷ resolved" color={ragColor(t.adoptionPct, 30, 10)} />
        <Tile label="Ratings" value={String(t.ratingsReceived)} sub="responses received" />
        <Tile label="Response" value={pct(t.responsePct)} sub="ratings ÷ links" color={ragColor(t.responsePct, 15, 5)} />
        <Tile label="Avg rating" value={t.avgRating != null ? `${t.avgRating}/5` : '—'} sub="weighted by ratings" color={ragColor(t.avgRating, 4, 3)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10 mb-8">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-white/[0.03]">
            <tr>
              <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-left font-medium">Agent</th>
              <th className={th}>Resolved</th>
              <th className={th}>Links</th>
              <th className={th}>Adoption</th>
              <th className={th}>Ratings</th>
              <th className={th}>Response</th>
              <th className={th}>Avg</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map(a => {
              const on = agent === a.agent;
              return (
                <tr
                  key={a.agent}
                  onClick={() => setAgent(on ? null : a.agent)}
                  title={on ? 'Click to clear the filter' : 'Click to see this agent’s individual ratings'}
                  className={`border-t border-white/5 cursor-pointer ${on ? 'bg-blue-500/10' : 'hover:bg-white/[0.04]'}`}
                >
                  <td className="px-3 py-2 text-slate-200">{a.agent}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{a.resolved}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{a.linksSent}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ color: ragColor(a.adoptionPct, 30, 10) }}>{pct(a.adoptionPct)}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{a.ratingsReceived}</td>
                  <td className="px-3 py-2 text-right" style={{ color: ragColor(a.responsePct, 15, 5) }}>{pct(a.responsePct)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: ragColor(a.avgRating, 4, 3) }}>{a.avgRating != null ? a.avgRating : '—'}</td>
                </tr>
              );
            })}
            {data.agents.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No resolved tickets in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Individual ratings ── */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">
          Individual ratings
          {agent && (
            <button onClick={() => setAgent(null)} className="ml-2 px-2 py-0.5 text-xs rounded-md bg-blue-600/20 border border-blue-500/40 text-blue-300">
              {agent} ✕
            </button>
          )}
        </h2>
        <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
          {([['resolved', 'Resolved in window'], ['rated', 'Rated in window']] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-3 max-w-3xl">
        {mode === 'resolved'
          ? 'Ratings on tickets resolved in this window — the same population as the Ratings tile above. A rating that arrives weeks after the ticket closed will not appear here; switch to “Rated in window” for those.'
          : 'Ratings received in this window, whenever the ticket was resolved. Will not match the Ratings tile.'}
      </p>

      {detailError && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{detailError}</div>}

      <div className="rounded-xl border border-white/10 overflow-hidden">
        {detailLoading && <div className="px-4 py-6 text-slate-400 text-sm">Loading ratings…</div>}
        {!detailLoading && rows.length === 0 && !detailError && (
          <div className="px-4 py-8 text-center text-slate-500 text-sm">
            No ratings {agent ? `for ${agent} ` : ''}in this window.
          </div>
        )}
        {!detailLoading && rows.map(r => (
          <div key={r.issueKey} className="border-t border-white/5 first:border-t-0 px-4 py-3 hover:bg-white/[0.02]">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-lg leading-none"><Stars n={r.score} /></span>
              <span className="text-sm font-semibold" style={{ color: scoreColor(r.score) }}>{r.score ?? '—'}/5</span>
              <a
                href={`https://nurturtech.atlassian.net/browse/${r.issueKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-blue-400 hover:text-blue-300"
              >
                {r.issueKey} →
              </a>
              <span className="text-sm text-slate-300 truncate max-w-xl">{r.summary}</span>
              <span className="ml-auto text-[11px] text-slate-500 whitespace-nowrap">{r.agent} · {when(r.respondedAt)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {r.revisionCount > 0 && r.firstScore != null && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  revised from {r.firstScore}/5
                </span>
              )}
              {r.ratedUnresolved && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/10">
                  rated while {r.ticketStatus || 'open'}
                </span>
              )}
              {r.ticketAgeHours != null && (
                <span className="text-[10px] text-slate-600">ticket {Math.round(r.ticketAgeHours / 24)}d old at rating</span>
              )}
            </div>
            <div className="mt-1.5 text-sm">
              {r.comment
                ? <span className="text-slate-200 italic">“{r.comment}”</span>
                : <span className="text-slate-600 text-xs">No comment left</span>}
            </div>
          </div>
        ))}
      </div>
      {detail?.truncated && (
        <div className="mt-2 text-xs text-amber-400">
          Showing the most recent {detail.limit} ratings — there are more in this window.
        </div>
      )}
    </div>
  );
}
