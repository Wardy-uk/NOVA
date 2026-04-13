import { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface Dashboard {
  queue: { total: number; pending: number; in_review: number; fast_track: number; unclaimed: number };
  today: { new: number; accepted: number; returned: number; processed: number };
  week: { new: number; accepted: number; returned: number };
  allTime: { accepted: number; returned: number };
  averages: {
    acceptanceRatePct: number | null;
    avgTimeToClaimMinutes: number | null;
    avgTimeToDecisionMinutes: number | null;
    oldestPendingHours: number | null;
  };
  perDeveloper: Array<{
    user_id: number;
    display: string;
    claimed_now: number;
    accepted_today: number;
    returned_today: number;
    accepted_week: number;
    returned_week: number;
    accepted_all: number;
    returned_all: number;
  }>;
  arrivals14d: Array<{ date: string; count: number }>;
  decisions14d: Array<{ date: string; accepted: number; returned: number }>;
  perTeam: Array<{
    team: string;
    in_queue: number;
    waiting: number;
    accepted_week: number;
    returned_week: number;
    accepted_all: number;
    returned_all: number;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

function fmtHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `${d}d ${rem}h` : `${d}d`;
}

function ragForAge(hours: number | null): string {
  if (hours === null) return '#64748b';
  if (hours < 4) return '#10b981';
  if (hours < 24) return '#f59e0b';
  return '#ef4444';
}

// ── Visual primitives (matching DevReviewView) ────────────────────────────

function GlassCard({ children, className = '', accent }: { children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {accent && (
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: 'linear-gradient(90deg, transparent, #9b6aed 30%, #5ec1ca 70%, transparent)',
            backgroundSize: '200% 100%',
            animation: 'drShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

function HeroTile({
  label, value, sublabel, accent = '#5ec1ca', icon, big,
}: {
  label: string; value: string | number; sublabel?: string; accent?: string; icon?: string; big?: boolean;
}) {
  return (
    <GlassCard accent className="p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">{label}</div>
        {icon && <span className="text-base opacity-60">{icon}</span>}
      </div>
      <div
        className={`${big ? 'text-5xl' : 'text-4xl'} font-black tracking-tight mb-1`}
        style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          color: accent,
          textShadow: `0 0 24px ${accent}33`,
        }}
      >
        {value}
      </div>
      {sublabel && <div className="text-[11px] text-neutral-500">{sublabel}</div>}
    </GlassCard>
  );
}

function Sparkline({
  data, colour = '#5ec1ca', height = 50,
}: { data: Array<{ date: string; value: number }>; colour?: string; height?: number }) {
  if (!data || data.length === 0) {
    return <div className="text-[10px] text-neutral-600 italic text-center py-4">no data</div>;
  }
  const w = 280;
  const h = height;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = w / data.length;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id={`bar-${colour.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.95" />
          <stop offset="100%" stopColor={colour} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const barH = max > 0 ? (d.value / max) * (h - 4) : 0;
        const x = i * barW + barW * 0.15;
        const y = h - barH;
        return (
          <g key={d.date}>
            <rect
              x={x} y={y}
              width={barW * 0.7} height={barH}
              rx={2}
              fill={`url(#bar-${colour.replace('#', '')})`}
            />
          </g>
        );
      })}
    </svg>
  );
}

function StackedBarChart({ data }: { data: Array<{ date: string; accepted: number; returned: number }> }) {
  if (!data || data.length === 0) {
    return <div className="text-[10px] text-neutral-600 italic text-center py-4">no decisions yet</div>;
  }
  const w = 560;
  const h = 80;
  const max = Math.max(...data.map((d) => d.accepted + d.returned), 1);
  const barW = w / data.length;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      {data.map((d, i) => {
        const totalH = ((d.accepted + d.returned) / max) * (h - 6);
        const accH = ((d.accepted) / max) * (h - 6);
        const retH = ((d.returned) / max) * (h - 6);
        const x = i * barW + barW * 0.18;
        const yAcc = h - accH;
        const yRet = yAcc - retH;
        return (
          <g key={d.date}>
            <rect x={x} y={yAcc} width={barW * 0.65} height={accH} rx={2} fill="#10b981" opacity={0.9} />
            <rect x={x} y={yRet} width={barW * 0.65} height={retH} rx={2} fill="#9b6aed" opacity={0.9} />
            {totalH > 8 && (
              <text x={x + barW * 0.32} y={yRet - 2} fontSize="9" fill="#94a3b8" textAnchor="middle">{d.accepted + d.returned}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function DevReviewDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dev-review/dashboard', {
        headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` },
      });
      const json = await res.json();
      if (json.ok) setData(json.data);
      else setError(json.error || 'Failed to load');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [load]);

  // Pad arrival/decision arrays to 14 days (fill missing dates with zero)
  const arrivals = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.arrivals14d.map((d) => [d.date, d.count]));
    const out: Array<{ date: string; value: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, value: map.get(key) || 0 });
    }
    return out;
  }, [data]);

  const decisions = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.decisions14d.map((d) => [d.date, d]));
    const out: Array<{ date: string; accepted: number; returned: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const e = map.get(key);
      out.push({ date: key, accepted: e?.accepted || 0, returned: e?.returned || 0 });
    }
    return out;
  }, [data]);

  return (
    <div className="relative min-h-screen -mx-6 -my-4 px-8 py-6 overflow-hidden">
      <div
        className="fixed inset-0 pointer-events-none opacity-70"
        style={{
          background: `
            radial-gradient(ellipse at 12% 18%, rgba(155,106,237,0.13) 0%, transparent 50%),
            radial-gradient(ellipse at 88% 25%, rgba(94,193,202,0.10) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 95%, rgba(16,185,129,0.06) 0%, transparent 55%)
          `,
          animation: 'drMesh 25s ease-in-out infinite alternate',
          zIndex: 0,
        }}
      />
      <style>{`
        @keyframes drMesh {
          0% { transform: translate(0,0) scale(1); }
          50% { transform: translate(-1%,1%) scale(1.03); }
          100% { transform: translate(1%,-1%) scale(0.99); }
        }
        @keyframes drShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes drFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .dr-fade { animation: drFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) both; }
      `}</style>

      <div className="relative z-10 max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="dr-fade flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black"
              style={{
                background: 'linear-gradient(135deg, #9b6aed, #5ec1ca)',
                boxShadow: '0 8px 32px rgba(155,106,237,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
                color: '#0f172a',
              }}
            >
              ▤
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-semibold">Technical Support</div>
              <h1
                className="text-2xl font-black tracking-tight"
                style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Dev Review Dashboard
              </h1>
            </div>
          </div>
          <button
            onClick={load}
            className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-200 border border-white/10 hover:bg-white/5 transition-all"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            ↻ Refresh
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="text-center py-20 text-neutral-500 text-sm">Loading dashboard…</div>
        ) : data ? (
          <>
            {/* Hero row — primary metrics */}
            <div className="dr-fade grid grid-cols-2 md:grid-cols-4 gap-4">
              <HeroTile label="New today" value={data.today.new} accent="#5ec1ca" icon="✨" big />
              <HeroTile label="Processed today" value={data.today.processed} accent="#10b981" icon="✓" big
                sublabel={`${data.today.accepted} accepted · ${data.today.returned} returned`} />
              <HeroTile label="In queue now" value={data.queue.total} accent="#9b6aed" icon="◎" big
                sublabel={`${data.queue.unclaimed} unclaimed · ${data.queue.fast_track} 🔥`} />
              <HeroTile
                label="Oldest pending"
                value={fmtHours(data.averages.oldestPendingHours)}
                accent={ragForAge(data.averages.oldestPendingHours)}
                icon="⏱"
                big
              />
            </div>

            {/* Secondary stats row */}
            <div className="dr-fade grid grid-cols-2 md:grid-cols-4 gap-4" style={{ animationDelay: '0.05s' }}>
              <HeroTile label="Acceptance rate" value={data.averages.acceptanceRatePct === null ? '—' : `${data.averages.acceptanceRatePct}%`} accent="#5ec1ca" />
              <HeroTile label="Avg time to claim" value={fmtMinutes(data.averages.avgTimeToClaimMinutes)} accent="#94a3b8" />
              <HeroTile label="Avg time to decision" value={fmtMinutes(data.averages.avgTimeToDecisionMinutes)} accent="#94a3b8" />
              <HeroTile label="This week" value={data.week.new} accent="#9b6aed" sublabel={`${data.week.accepted} accepted · ${data.week.returned} returned`} />
            </div>

            {/* Charts row */}
            <div className="dr-fade grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ animationDelay: '0.1s' }}>
              <GlassCard accent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[10px] uppercase tracking-wider text-[#5ec1ca] font-bold">Arrivals · last 14 days</div>
                  <div className="text-[10px] text-neutral-500">peak: {Math.max(...arrivals.map((a) => a.value), 0)}</div>
                </div>
                <Sparkline data={arrivals} colour="#5ec1ca" height={70} />
                <div className="flex justify-between mt-2 text-[9px] text-neutral-600">
                  <span>{arrivals[0]?.date.slice(5)}</span>
                  <span>{arrivals[arrivals.length - 1]?.date.slice(5)}</span>
                </div>
              </GlassCard>

              <GlassCard accent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[10px] uppercase tracking-wider text-[#9b6aed] font-bold">Decisions · last 14 days</div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: '#10b981' }} /><span className="text-neutral-400">accepted</span></span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: '#9b6aed' }} /><span className="text-neutral-400">returned</span></span>
                  </div>
                </div>
                <StackedBarChart data={decisions} />
                <div className="flex justify-between mt-2 text-[9px] text-neutral-600">
                  <span>{decisions[0]?.date.slice(5)}</span>
                  <span>{decisions[decisions.length - 1]?.date.slice(5)}</span>
                </div>
              </GlassCard>
            </div>

            {/* Per-team breakdown */}
            <GlassCard accent className="dr-fade p-5" >
              <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] uppercase tracking-wider text-[#5ec1ca] font-bold">By Team (from Nurtur Product)</div>
                <div className="text-[10px] text-neutral-500">{data.perTeam.length} teams</div>
              </div>
              {data.perTeam.length === 0 ? (
                <div className="text-[12px] text-neutral-500 italic text-center py-6">No team data yet — teams populate as tickets flow through the queue.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[9px] uppercase tracking-wider text-neutral-500 font-bold">
                        <th className="text-left py-2 pr-4">Team</th>
                        <th className="text-right py-2 px-3" style={{ color: '#5ec1ca' }}>In queue</th>
                        <th className="text-right py-2 px-3" style={{ color: '#ec4899' }}>Waiting on agent</th>
                        <th className="text-right py-2 px-3" style={{ color: '#10b981' }}>Accepted (7d)</th>
                        <th className="text-right py-2 px-3" style={{ color: '#9b6aed' }}>Returned (7d)</th>
                        <th className="text-right py-2 px-3">Accepted (all)</th>
                        <th className="text-right py-2 pl-3">Returned (all)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perTeam.map((t) => (
                        <tr key={t.team} className="text-[12px] border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 pr-4">
                            <span
                              className="px-2 py-1 rounded font-bold text-[11px]"
                              style={{
                                background: 'linear-gradient(135deg, rgba(94,193,202,0.15), rgba(155,106,237,0.15))',
                                color: '#c4b5fd',
                                border: '1px solid rgba(155,106,237,0.25)',
                              }}
                            >
                              {t.team}
                            </span>
                          </td>
                          <td className="text-right px-3 font-bold text-[#5ec1ca]">{t.in_queue || '—'}</td>
                          <td className="text-right px-3 font-bold text-pink-400">{t.waiting || '—'}</td>
                          <td className="text-right px-3 text-emerald-400 font-semibold">{t.accepted_week || '—'}</td>
                          <td className="text-right px-3 text-purple-400 font-semibold">{t.returned_week || '—'}</td>
                          <td className="text-right px-3 text-neutral-400">{t.accepted_all || '—'}</td>
                          <td className="text-right pl-3 text-neutral-400">{t.returned_all || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>

            {/* Per-developer table */}
            <GlassCard accent className="dr-fade p-5" >
              <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] uppercase tracking-wider text-[#9b6aed] font-bold">By Developer</div>
                <div className="text-[10px] text-neutral-500">{data.perDeveloper.length} active</div>
              </div>
              {data.perDeveloper.length === 0 ? (
                <div className="text-[12px] text-neutral-500 italic text-center py-8">
                  No developer activity yet — no claims, accepts, or returns recorded.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[9px] uppercase tracking-wider text-neutral-500 font-bold">
                        <th className="text-left py-2 pr-4">Developer</th>
                        <th className="text-right py-2 px-3">Claimed now</th>
                        <th className="text-right py-2 px-3" style={{ color: '#10b981' }}>Accepted today</th>
                        <th className="text-right py-2 px-3" style={{ color: '#9b6aed' }}>Returned today</th>
                        <th className="text-right py-2 px-3">Accepted (7d)</th>
                        <th className="text-right py-2 px-3">Returned (7d)</th>
                        <th className="text-right py-2 px-3">Accepted (all)</th>
                        <th className="text-right py-2 pl-3">Returned (all)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perDeveloper.map((d) => {
                        const total = d.accepted_all + d.returned_all;
                        const pct = total > 0 ? Math.round((d.accepted_all / total) * 100) : null;
                        return (
                          <tr
                            key={d.user_id}
                            className="text-[12px] border-t border-white/5 hover:bg-white/[0.02] transition-colors"
                          >
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                                  style={{
                                    background: 'linear-gradient(135deg, rgba(94,193,202,0.25), rgba(155,106,237,0.25))',
                                    color: '#c4b5fd',
                                  }}
                                >
                                  {d.display.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                                </div>
                                <div>
                                  <div className="text-neutral-200 font-semibold">{d.display}</div>
                                  {pct !== null && <div className="text-[9px] text-neutral-600">{pct}% accept rate</div>}
                                </div>
                              </div>
                            </td>
                            <td className="text-right px-3 font-bold text-[#5ec1ca]">{d.claimed_now || '—'}</td>
                            <td className="text-right px-3 text-emerald-400 font-semibold">{d.accepted_today || '—'}</td>
                            <td className="text-right px-3 text-purple-400 font-semibold">{d.returned_today || '—'}</td>
                            <td className="text-right px-3 text-neutral-300">{d.accepted_week || '—'}</td>
                            <td className="text-right px-3 text-neutral-300">{d.returned_week || '—'}</td>
                            <td className="text-right px-3 text-neutral-400">{d.accepted_all || '—'}</td>
                            <td className="text-right pl-3 text-neutral-400">{d.returned_all || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>

            {/* All-time summary footer */}
            <div className="dr-fade flex items-center justify-center gap-8 text-[11px] text-neutral-500 pt-2 pb-6">
              <div>
                <span className="text-neutral-600">All-time accepted: </span>
                <span className="text-neutral-300 font-bold">{data.allTime.accepted}</span>
              </div>
              <div className="text-neutral-700">·</div>
              <div>
                <span className="text-neutral-600">All-time returned: </span>
                <span className="text-neutral-300 font-bold">{data.allTime.returned}</span>
              </div>
              <div className="text-neutral-700">·</div>
              <div>
                <span className="text-neutral-600">Total processed: </span>
                <span className="text-neutral-300 font-bold">{data.allTime.accepted + data.allTime.returned}</span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
