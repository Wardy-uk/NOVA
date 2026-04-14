import { useState, useEffect, useMemo, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface TierCompliance {
  tier: string;
  current: number | null;
  previous: number | null;
  series?: Array<{ date: string; value: number }>;
}

interface Aging { under4h: number; h4to24: number; d1to3: number; d3to7: number; over7d: number }
interface BacklogSplit { cc: number; incidents: number; serviceReq: number; tpj: number; t2: number; t3: number; production: number; dev: number }
interface AgedDev { total: number; over30d: number; over90d: number; over180d: number; oldestDays: number | null }
interface OpenedResolved { opened: number; resolved: number; prevOpened: number; prevResolved: number }
interface DevReviewMonth {
  accepted: number; returned: number; avgTimeToDecisionMinutes: number | null;
  inQueueNow: number; avgAgeHours: number | null;
}

interface MiData {
  month: string;
  label: string;
  isMtd: boolean;
  daysElapsed: number;
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  dataError: string | null;
  availableKpis: string[];
  service: {
    frtCompliance: TierCompliance[];
    resolutionCompliance: TierCompliance[];
    ticketsOpened: number | null;
    fcrRate: number | null;
    prevFcrRate: number | null;
    firstLineResolution: number | null;
    prevFirstLineResolution: number | null;
    csat: number | null;
    prevCsat: number | null;
  };
  escalation: {
    frtBreachedAll: number | null;
    frtBreachedCC: number | null;
    frtBreachedT2: number | null;
    frtBreachedT3: number | null;
    frtBreachedDev: number | null;
    prevFrtBreachedAll: number | null;
  };
  aging: Aging | null;
  backlogSplit: BacklogSplit | null;
  topProducts: Array<{ product: string; count: number }>;
  agedDev: AgedDev | null;
  openedResolved: OpenedResolved | null;
  devReview: DevReviewMonth | null;
  commentary: { content: string; updated_at: string | null };
}

type Rag = 'green' | 'amber' | 'red' | 'grey';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(dp)}%`;
}
function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString();
}
function fmtMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
function ragForPct(v: number | null, greenAt = 95, amberAt = 85): Rag {
  if (v === null) return 'grey';
  if (v >= greenAt) return 'green';
  if (v >= amberAt) return 'amber';
  return 'red';
}

// Month list: Jan 2026 as earliest, up to current month
function monthList(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const start = new Date(Date.UTC(2026, 0, 1));
  const now = new Date();
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let d = new Date(start); d <= cur; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      value: ym,
      label: d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out.reverse(); // newest first
}

// ── Visual primitives ─────────────────────────────────────────────────────

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
            background: 'linear-gradient(90deg, transparent, #5ec1ca 30%, #9b6aed 70%, transparent)',
            backgroundSize: '200% 100%',
            animation: 'miShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

function RagDot({ rag }: { rag: Rag }) {
  const colour = rag === 'green' ? '#10b981' : rag === 'amber' ? '#f59e0b' : rag === 'red' ? '#ef4444' : '#64748b';
  return <span className="inline-block w-2 h-2 rounded-full" style={{ background: colour, boxShadow: `0 0 12px ${colour}` }} />;
}

function SentimentArrow({ delta, inverse = false }: { delta: number | null; inverse?: boolean }) {
  if (delta === null || Number.isNaN(delta)) return <span className="text-[10px] text-neutral-500">—</span>;
  const good = inverse ? delta < 0 : delta > 0;
  const neutral = Math.abs(delta) < 0.5;
  const colour = neutral ? '#94a3b8' : good ? '#10b981' : '#ef4444';
  const arrow = neutral ? '→' : delta > 0 ? '↑' : '↓';
  const word = neutral ? 'Consistent' : good ? 'Improving' : 'Declining';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: colour, background: `${colour}18`, border: `1px solid ${colour}40` }}
      title={`${delta > 0 ? '+' : ''}${delta.toFixed(1)}% vs last month`}
    >
      <span>{arrow}</span>
      <span>{word}</span>
    </span>
  );
}

function Sparkline({ data, colour = '#5ec1ca' }: { data: Array<{ date: string; value: number }>; colour?: string }) {
  if (!data || data.length < 2) {
    return <div className="h-10 flex items-center text-[10px] text-neutral-600 italic">no trend yet</div>;
  }
  const w = 160;
  const h = 40;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.value - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M ${pts.join(' L ')}`;
  const areaD = `${pathD} L ${w},${h} L 0,${h} Z`;
  const gradId = `spark-${colour.replace('#', '')}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.35" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={colour} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHeader({ num, title, subtitle }: { num: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{
              background: 'linear-gradient(135deg, rgba(94,193,202,0.15), rgba(155,106,237,0.15))',
              color: '#5ec1ca',
              border: '1px solid rgba(94,193,202,0.2)',
            }}
          >
            {num}
          </span>
          <h2 className="text-lg font-bold text-neutral-50 tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
            {title}
          </h2>
        </div>
        <div className="text-[11px] text-neutral-400 ml-8">{subtitle}</div>
      </div>
    </div>
  );
}

function KpiTile({
  label, value, rag, delta, inverseDelta, target, tooltip,
}: {
  label: string; value: string; rag: Rag; delta: number | null; inverseDelta?: boolean; target?: string; tooltip?: string;
}) {
  const ragColour = rag === 'green' ? '#10b981' : rag === 'amber' ? '#f59e0b' : rag === 'red' ? '#ef4444' : '#64748b';
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <RagDot rag={rag} />
        <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold flex items-center gap-1.5">
          <span>{label}</span>
          {tooltip && <InfoTip text={tooltip} />}
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <div
          className="text-3xl font-black tracking-tight"
          style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: ragColour }}
        >
          {value}
        </div>
        <SentimentArrow delta={delta} inverse={inverseDelta} />
      </div>
      {target && <div className="text-[10px] text-neutral-500">Target: {target}</div>}
    </div>
  );
}

function TierRow({ tier }: { tier: TierCompliance }) {
  const rag = ragForPct(tier.current);
  const delta = deltaPct(tier.current, tier.previous);
  const pct = tier.current ?? 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-[11px] text-neutral-200 font-medium">{tier.tier}</div>
      <div className="flex-1 h-6 rounded bg-white/5 overflow-hidden relative border border-white/5">
        <div
          className="h-full transition-all duration-700"
          style={{
            width: `${Math.min(100, pct)}%`,
            background:
              rag === 'green' ? 'linear-gradient(90deg, #059669, #10b981)' :
              rag === 'amber' ? 'linear-gradient(90deg, #d97706, #f59e0b)' :
              rag === 'red' ? 'linear-gradient(90deg, #dc2626, #ef4444)' :
              'rgba(100,116,139,0.4)',
            boxShadow: rag !== 'grey' ? `0 0 16px ${rag === 'green' ? '#10b98166' : rag === 'amber' ? '#f59e0b66' : '#ef444466'}` : undefined,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-white/95">
          {fmtPct(tier.current)}
        </div>
      </div>
      <div className="w-24 text-right"><SentimentArrow delta={delta} /></div>
      <div className="w-28 h-6"><Sparkline data={tier.series || []} /></div>
    </div>
  );
}

function BreachTile({ label, value, colour, big }: { label: string; value: number | null; colour: string; big?: boolean }) {
  return (
    <div
      className="p-4 rounded-xl border border-white/5"
      style={{ background: `linear-gradient(135deg, ${colour}0A, transparent)` }}
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-2">{label}</div>
      <div
        className={`${big ? 'text-4xl' : 'text-2xl'} font-black tracking-tight`}
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: colour }}
      >
        {fmtNum(value)}
      </div>
      <div className="text-[10px] text-neutral-500 mt-1">FRT breaches</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function BoardMiView() {
  const months = useMemo(() => monthList(), []);
  const [month, setMonth] = useState<string>(months[0]?.value || new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<MiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentaryDraft, setCommentaryDraft] = useState('');
  const [commentarySaving, setCommentarySaving] = useState(false);
  const [commentaryDirty, setCommentaryDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/board-mi/monthly?month=${month}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` },
      });
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
        setCommentaryDraft(json.data.commentary?.content || '');
        setCommentaryDirty(false);
      } else setError(json.error || 'Load failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const saveCommentary = useCallback(async () => {
    setCommentarySaving(true);
    try {
      const res = await fetch('/api/board-mi/commentary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
        },
        body: JSON.stringify({ month, content: commentaryDraft }),
      });
      const json = await res.json();
      if (json.ok) setCommentaryDirty(false);
    } catch { /* ignore */ }
    finally { setCommentarySaving(false); }
  }, [month, commentaryDraft]);

  // ── Derived ──────────────────────────────────────────────────────────
  const avgFrt = useMemo(() => {
    if (!data) return null;
    const vals = data.service.frtCompliance.map((t) => t.current).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [data]);

  const avgRes = useMemo(() => {
    if (!data) return null;
    const vals = data.service.resolutionCompliance.map((t) => t.current).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [data]);

  const netBacklog = data?.openedResolved
    ? data.openedResolved.opened - data.openedResolved.resolved
    : null;
  const prevNetBacklog = data?.openedResolved
    ? data.openedResolved.prevOpened - data.openedResolved.prevResolved
    : null;

  const downloadSnapshot = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sd-mi-${month}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative min-h-screen -mx-6 -my-4 px-8 py-8 overflow-hidden">
      <div
        className="fixed inset-0 pointer-events-none opacity-80"
        style={{
          background: `
            radial-gradient(ellipse at 15% 20%, rgba(94,193,202,0.12) 0%, transparent 45%),
            radial-gradient(ellipse at 85% 15%, rgba(155,106,237,0.10) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 90%, rgba(16,185,129,0.06) 0%, transparent 55%)
          `,
          animation: 'miMesh 25s ease-in-out infinite alternate',
          zIndex: 0,
        }}
      />
      <style>{`
        @keyframes miMesh { 0%{transform:translate(0,0) scale(1);} 50%{transform:translate(-2%,1%) scale(1.04);} 100%{transform:translate(1%,-2%) scale(0.98);} }
        @keyframes miShift { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }
        @keyframes miFadeIn { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:translateY(0);} }
        .mi-fade { animation: miFadeIn 0.6s cubic-bezier(0.16,1,0.3,1) both; }
      `}</style>

      <div className="relative z-10 max-w-[1600px] mx-auto space-y-7">
        {/* ── Hero header ─────────────────────────────────────────────── */}
        <div className="mi-fade flex items-start justify-between gap-6 pb-6 border-b border-white/5">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black"
                style={{
                  background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)',
                  boxShadow: '0 8px 32px rgba(94,193,202,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
                  color: '#0f172a',
                }}
              >
                MI
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-semibold">Nurtur.Tech</div>
                <h1
                  className="text-3xl font-black tracking-tight"
                  style={{
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Service Desk MI
                </h1>
              </div>
            </div>
            <div className="text-[12px] text-neutral-400 ml-[52px]">
              {data?.label ?? 'Loading…'}
              {data?.isMtd && (
                <span
                  className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold cursor-help"
                  style={{ background: 'rgba(94,193,202,0.15)', color: '#5ec1ca', border: '1px solid rgba(94,193,202,0.3)' }}
                  title="Month-to-date — the current month through today. Prior-month deltas compare the same day-count window for fairness."
                >
                  MTD · {data.daysElapsed} days
                </span>
              )}
              {data && ` · ${data.availableKpis.length} live KPIs`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-white/10 text-neutral-100 font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)' }}
            >
              {months.map((m) => (
                <option key={m.value} value={m.value} className="bg-[#272C33]">
                  {m.label}{m.value === months[0]?.value ? ' (MTD)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={load}
              className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-200 border border-white/10 hover:bg-white/5 transition-all"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              ↻
            </button>
            <button
              onClick={downloadSnapshot}
              disabled={!data}
              className="px-3 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40 transition-all hover:scale-[1.03]"
              style={{
                background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)',
                boxShadow: '0 4px 20px rgba(94,193,202,0.35)',
              }}
            >
              ↓ Export
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">{error}</div>
        )}
        {data?.dataError && (
          <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300">
            KPI data source warning: {data.dataError}. Showing partial results.
          </div>
        )}

        {loading && !data ? (
          <div className="text-center py-20 text-neutral-500 text-sm">Loading MI…</div>
        ) : data ? (
          <>
            {/* ── Section 01: Service Performance ──────────────────── */}
            <section className="mi-fade">
              <SectionHeader num="01" title="Service Performance" subtitle="SLA compliance, resolution, customer satisfaction" />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <GlassCard accent className="p-6 lg:col-span-2">
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <KpiTile
                      label="Avg FRT compliance"
                      tooltip="First Response Time — % of tickets where the first agent reply was sent within SLA. Averaged across all tiers."
                      value={fmtPct(avgFrt)}
                      rag={ragForPct(avgFrt)}
                      delta={null}
                      target="≥95%"
                    />
                    <KpiTile
                      label="FCR Rate"
                      tooltip="First Contact Resolution — % of tickets resolved on the first interaction with no further back-and-forth."
                      value={fmtPct(data.service.fcrRate)}
                      rag={ragForPct(data.service.fcrRate, 70, 50)}
                      delta={deltaPct(data.service.fcrRate, data.service.prevFcrRate)}
                      target="+10–20% vs baseline"
                    />
                    <KpiTile
                      label="CSAT"
                      tooltip="Customer Satisfaction — % of customers rating their support experience positively on the post-ticket survey."
                      value={fmtPct(data.service.csat)}
                      rag={ragForPct(data.service.csat, 85, 70)}
                      delta={deltaPct(data.service.csat, data.service.prevCsat)}
                      target="≥90%"
                    />
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-3 flex items-center gap-1.5">
                    <span>FRT Compliance by Tier</span>
                    <InfoTip text="First Response Time SLA compliance broken down by support tier (CC, Tier 2, Tier 3, Production, Development)." />
                  </div>
                  <div className="space-y-2">
                    {data.service.frtCompliance.map((t) => <TierRow key={t.tier} tier={t} />)}
                  </div>
                </GlassCard>

                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-3">Month at a Glance</div>
                  <div className="space-y-3.5">
                    <BigStat
                      label="Tickets opened"
                      tooltip="Total NT tickets created in this period (live JQL count)"
                      value={fmtNum(data.openedResolved?.opened ?? data.service.ticketsOpened)}
                      delta={deltaPct(data.openedResolved?.opened ?? null, data.openedResolved?.prevOpened ?? null)}
                      inverseDelta
                    />
                    <BigStat
                      label="1st Line Resolution"
                      tooltip="Percentage of tickets resolved by Customer Care without escalation"
                      value={fmtPct(data.service.firstLineResolution)}
                      delta={deltaPct(data.service.firstLineResolution, data.service.prevFirstLineResolution)}
                    />
                    <BigStat
                      label="Avg Resolution Compliance"
                      tooltip="Average of resolution-time SLA compliance % across all tiers"
                      value={fmtPct(avgRes)}
                    />
                    <BigStat
                      label="FRT Breaches"
                      tooltip="First Response Time breaches — total count across all tiers"
                      value={fmtNum(data.escalation.frtBreachedAll)}
                      delta={deltaPct(data.escalation.frtBreachedAll, data.escalation.prevFrtBreachedAll)}
                      inverseDelta
                    />
                  </div>
                </GlassCard>
              </div>
            </section>

            {/* ── Section 02: Escalation Health ─────────────────────── */}
            <section className="mi-fade">
              <SectionHeader num="02" title="Escalation Health" subtitle="Breach distribution by tier" />
              <GlassCard accent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <BreachTile label="Customer Care" value={data.escalation.frtBreachedCC} colour="#5ec1ca" />
                  <BreachTile label="Tier 2" value={data.escalation.frtBreachedT2} colour="#9b6aed" />
                  <BreachTile label="Tier 3" value={data.escalation.frtBreachedT3} colour="#f59e0b" />
                  <BreachTile label="Development" value={data.escalation.frtBreachedDev} colour="#ef4444" />
                  <BreachTile label="All Tiers" value={data.escalation.frtBreachedAll} colour="#f8fafc" big />
                </div>
              </GlassCard>
            </section>

            {/* ── Section 03: Backlog Health — Opened vs Resolved + Net Change ── */}
            <section className="mi-fade">
              <SectionHeader num="03" title="Backlog Health" subtitle="Opened vs resolved, net change, and split by tier" />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-4">In &middot; Out &middot; Net</div>
                  <div className="space-y-4">
                    <BigStat
                      label="Opened"
                      value={fmtNum(data.openedResolved?.opened ?? null)}
                      delta={deltaPct(data.openedResolved?.opened ?? null, data.openedResolved?.prevOpened ?? null)}
                      inverseDelta
                    />
                    <BigStat
                      label="Resolved"
                      value={fmtNum(data.openedResolved?.resolved ?? null)}
                      delta={deltaPct(data.openedResolved?.resolved ?? null, data.openedResolved?.prevResolved ?? null)}
                    />
                    <div className="pt-3 border-t border-white/5">
                      <BigStat
                        label="Net backlog change"
                        value={netBacklog !== null ? (netBacklog >= 0 ? `+${netBacklog}` : `${netBacklog}`) : '—'}
                        valueColour={netBacklog === null ? undefined : netBacklog > 0 ? '#ef4444' : '#10b981'}
                        delta={deltaPct(netBacklog, prevNetBacklog)}
                        inverseDelta
                        tooltip="Opened minus Resolved. Positive = backlog growing (bad). Zero or negative = keeping up or catching up (good)."
                      />
                    </div>
                  </div>
                </GlassCard>

                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-4">Backlog by Tier</div>
                  {data.backlogSplit ? (
                    <div className="space-y-3">
                      <SplitRow label="Customer Care" value={data.backlogSplit.cc} colour="#5ec1ca" />
                      <SplitRow label="— Incidents" value={data.backlogSplit.incidents} colour="#ef4444" muted />
                      <SplitRow label="— Service Req" value={data.backlogSplit.serviceReq} colour="#f59e0b" muted />
                      <SplitRow label="— TPJ" value={data.backlogSplit.tpj} colour="#9b6aed" muted />
                      <div className="pt-2 border-t border-white/5">
                        <SplitRow label="Tier 2" value={data.backlogSplit.t2} colour="#9b6aed" />
                        <SplitRow label="Tier 3" value={data.backlogSplit.t3} colour="#f59e0b" />
                        <SplitRow label="Production" value={data.backlogSplit.production} colour="#10b981" />
                        <SplitRow label="Development" value={data.backlogSplit.dev} colour="#ef4444" />
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-neutral-500 italic">Live JQL unavailable</div>
                  )}
                </GlassCard>

                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-4">Aging Buckets</div>
                  {data.aging ? (
                    <div className="space-y-3">
                      <AgingRow label="Under 4h" value={data.aging.under4h} colour="#10b981" />
                      <AgingRow label="4–24h" value={data.aging.h4to24} colour="#5ec1ca" />
                      <AgingRow label="1–3 days" value={data.aging.d1to3} colour="#9b6aed" />
                      <AgingRow label="3–7 days" value={data.aging.d3to7} colour="#f59e0b" />
                      <AgingRow label="Over 7 days" value={data.aging.over7d} colour="#ef4444" />
                    </div>
                  ) : (
                    <div className="text-[11px] text-neutral-500 italic">Live JQL unavailable</div>
                  )}
                </GlassCard>
              </div>
            </section>

            {/* ── Section 04: Development Flow ─────────────────────── */}
            <section className="mi-fade">
              <SectionHeader num="04" title="Development Flow" subtitle="Dev Review queue throughput and aged dev backlog" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-[#c4b5fd] font-bold mb-4">Dev Review · this month</div>
                  {data.devReview ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-1">Accepted to dev</div>
                        <div className="text-3xl font-black text-emerald-400" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
                          {data.devReview.accepted}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-1">Returned to CC</div>
                        <div className="text-3xl font-black text-purple-400" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
                          {data.devReview.returned}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-1">In queue now</div>
                        <div className="text-2xl font-bold text-[#5ec1ca]">{data.devReview.inQueueNow}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-1">Avg time to decision</div>
                        <div className="text-2xl font-bold text-neutral-100">{fmtMinutes(data.devReview.avgTimeToDecisionMinutes)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-neutral-500 italic">No Dev Review data yet</div>
                  )}
                </GlassCard>

                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-red-400 font-bold mb-4">Aged Dev Backlog</div>
                  {data.agedDev ? (
                    <div>
                      <div className="flex items-baseline gap-3 mb-4">
                        <div className="text-4xl font-black text-neutral-100" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
                          {fmtNum(data.agedDev.total)}
                        </div>
                        <div className="text-[11px] text-neutral-400">tickets in Development</div>
                      </div>
                      <div className="space-y-2">
                        <AgingRow label="Over 30 days" value={data.agedDev.over30d} colour="#f59e0b" />
                        <AgingRow label="Over 90 days" value={data.agedDev.over90d} colour="#f97316" />
                        <AgingRow label="Over 180 days" value={data.agedDev.over180d} colour="#ef4444" />
                      </div>
                      {data.agedDev.oldestDays !== null && (
                        <div className="mt-3 pt-3 border-t border-white/5 text-[11px] text-neutral-400">
                          Oldest: <span className="text-red-400 font-bold">{data.agedDev.oldestDays} days</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-neutral-500 italic">Live JQL unavailable</div>
                  )}
                </GlassCard>
              </div>
            </section>

            {/* ── Section 05: Top Products ──────────────────────────── */}
            <section className="mi-fade">
              <SectionHeader num="05" title="Top Products driving tickets" subtitle="Unresolved NT tickets grouped by Nurtur Product" />
              <GlassCard accent className="p-6">
                {data.topProducts.length > 0 ? (
                  <div className="space-y-3">
                    {data.topProducts.map((p, i) => {
                      const max = data.topProducts[0].count;
                      const width = (p.count / max) * 100;
                      return (
                        <div key={p.product} className="flex items-center gap-4">
                          <div className="w-6 text-[10px] text-neutral-500 font-bold">#{i + 1}</div>
                          <div className="w-48 text-[12px] text-neutral-200 font-semibold truncate">{p.product}</div>
                          <div className="flex-1 h-6 rounded bg-white/5 overflow-hidden relative border border-white/5">
                            <div
                              className="h-full transition-all duration-700"
                              style={{
                                width: `${width}%`,
                                background: 'linear-gradient(90deg, #5ec1ca, #9b6aed)',
                                boxShadow: '0 0 16px rgba(94,193,202,0.4)',
                              }}
                            />
                          </div>
                          <div className="w-12 text-right text-[13px] font-bold text-neutral-100">{p.count}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-neutral-500 italic">No data yet</div>
                )}
              </GlassCard>
            </section>

            {/* ── Section 06: Narrative commentary ────────────────── */}
            <section className="mi-fade">
              <SectionHeader num="06" title="Commentary" subtitle="HoTS narrative for this period" />
              <GlassCard accent className="p-6">
                <textarea
                  value={commentaryDraft}
                  onChange={(e) => {
                    setCommentaryDraft(e.target.value);
                    setCommentaryDirty(true);
                  }}
                  onBlur={() => { if (commentaryDirty) saveCommentary(); }}
                  placeholder="What happened this month? Wins, risks, actions taken, asks for support…"
                  rows={8}
                  className="w-full px-4 py-3 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 leading-relaxed"
                  style={{ background: 'rgba(255,255,255,0.04)', resize: 'vertical' }}
                />
                <div className="flex items-center justify-between mt-3 text-[10px] text-neutral-500">
                  <div>
                    {data.commentary.updated_at
                      ? `Last saved: ${new Date(data.commentary.updated_at).toLocaleString('en-GB')}`
                      : 'Not yet saved'}
                  </div>
                  <div className="flex items-center gap-2">
                    {commentarySaving && <span className="text-amber-400">Saving…</span>}
                    {commentaryDirty && !commentarySaving && <span className="text-amber-400">Unsaved changes</span>}
                    {!commentaryDirty && !commentarySaving && data.commentary.content && (
                      <span className="text-emerald-400">✓ Saved</span>
                    )}
                    <button
                      onClick={saveCommentary}
                      disabled={!commentaryDirty || commentarySaving}
                      className="px-3 py-1 text-[10px] rounded font-bold text-[#0f172a] disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)' }}
                    >
                      Save now
                    </button>
                  </div>
                </div>
              </GlassCard>
            </section>

            <div className="text-center text-[10px] text-neutral-500 pt-4 pb-8">
              Service Desk MI &middot; {data.label}{data.isMtd ? ' (month-to-date)' : ''} &middot; Generated {new Date().toLocaleDateString('en-GB')}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BigStat({ label, value, delta, inverseDelta, tooltip, valueColour }: { label: string; value: string; delta?: number | null; inverseDelta?: boolean; tooltip?: string; valueColour?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
        <span>{label}</span>
        {tooltip && <InfoTip text={tooltip} />}
      </div>
      <div className="flex items-center gap-2">
        <div
          className="text-lg font-bold"
          style={{
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            color: valueColour || '#f8fafc',
          }}
        >
          {value}
        </div>
        {delta !== undefined && <SentimentArrow delta={delta ?? null} inverse={inverseDelta} />}
      </div>
    </div>
  );
}

/** Small ⓘ icon that shows a glass-styled tooltip on hover. Uses native
 *  `title` as an accessibility fallback + a custom styled popover for the
 *  hover presentation. Pure CSS — no JS state. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group" tabIndex={0}>
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold cursor-help"
        style={{
          background: 'rgba(148,163,184,0.15)',
          color: '#94a3b8',
          border: '1px solid rgba(148,163,184,0.3)',
        }}
        title={text}
      >
        i
      </span>
      <span
        className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg text-[10px] font-medium text-neutral-100 whitespace-nowrap transition-opacity duration-150 z-50"
        style={{
          background: 'rgba(15,23,42,0.97)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}
      >
        {text}
      </span>
    </span>
  );
}

function SplitRow({ label, value, colour, muted }: { label: string; value: number; colour: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${muted ? 'pl-3' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: colour }} />
        <span className={`text-[12px] ${muted ? 'text-neutral-400' : 'text-neutral-100 font-semibold'}`}>{label}</span>
      </div>
      <div className={`text-[14px] font-bold ${muted ? 'text-neutral-300' : 'text-neutral-50'}`} style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function AgingRow({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: colour, boxShadow: `0 0 8px ${colour}` }} />
        <span className="text-[11px] text-neutral-200">{label}</span>
      </div>
      <span className="text-[14px] font-bold" style={{ color: colour, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
