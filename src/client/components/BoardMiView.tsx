import { useState, useEffect, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface TierCompliance {
  tier: string;
  current: number | null;
  previous: number | null;
  series?: Array<{ date: string; value: number }>;
}

interface BoardMiData {
  month: string;
  label: string;
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  dataError: string | null;
  availableKpis: string[];
  service: {
    frtCompliance: TierCompliance[];
    resolutionCompliance: TierCompliance[];
    ticketsOpened: number | null;
    fcrRate: number | null;
    firstLineResolution: number | null;
    csat: number | null;
    prevFcrRate: number | null;
    prevFirstLineResolution: number | null;
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
  production: {
    ticketsInCC_SR: number | null;
    ticketsInCC_Inc: number | null;
  };
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

function monthList(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

// ── Visual primitives ─────────────────────────────────────────────────────

function RagDot({ rag }: { rag: Rag }) {
  const colour =
    rag === 'green' ? '#10b981' :
    rag === 'amber' ? '#f59e0b' :
    rag === 'red' ? '#ef4444' : '#64748b';
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: colour, boxShadow: `0 0 12px ${colour}` }}
    />
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

function DeltaChip({ delta, inverse = false }: { delta: number | null; inverse?: boolean }) {
  if (delta === null || Number.isNaN(delta)) {
    return <span className="text-[10px] text-neutral-500">—</span>;
  }
  const good = inverse ? delta < 0 : delta > 0;
  const neutral = Math.abs(delta) < 0.05;
  const colour = neutral ? '#94a3b8' : good ? '#10b981' : '#ef4444';
  const arrow = neutral ? '→' : delta > 0 ? '↑' : '↓';
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ color: colour, background: `${colour}18` }}
    >
      {arrow} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

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
            animation: 'boardShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

function OutcomeCard({
  number, title, rag, headline, subtitle, target,
}: {
  number: number; title: string; rag: Rag; headline: string; subtitle: string; target: string;
}) {
  const ragColour =
    rag === 'green' ? '#10b981' :
    rag === 'amber' ? '#f59e0b' :
    rag === 'red' ? '#ef4444' : '#64748b';
  return (
    <GlassCard accent className="p-5 group hover:scale-[1.015] transition-transform duration-300">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold"
            style={{
              background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)',
              boxShadow: '0 4px 16px rgba(94,193,202,0.35)',
              color: '#0f172a',
            }}
          >
            {number}
          </div>
          <RagDot rag={rag} />
        </div>
        <span
          className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full"
          style={{ color: ragColour, background: `${ragColour}18`, border: `1px solid ${ragColour}40` }}
        >
          {rag === 'grey' ? 'pending' : rag.toUpperCase()}
        </span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold">{title}</div>
      <div className="text-2xl font-bold text-neutral-50 mb-1 tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {headline}
      </div>
      <div className="text-[11px] text-neutral-400 mb-2">{subtitle}</div>
      <div className="text-[10px] text-neutral-500 pt-2 border-t border-white/5">
        <span className="text-neutral-600">Day-90 target:</span> <span className="text-neutral-300">{target}</span>
      </div>
    </GlassCard>
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
          <h2 className="text-lg font-bold text-neutral-100 tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
            {title}
          </h2>
        </div>
        <div className="text-[11px] text-neutral-500 ml-8">{subtitle}</div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function BoardMiView() {
  const months = useMemo(() => monthList(), []);
  const [month, setMonth] = useState<string>(months[0].value);
  const [data, setData] = useState<BoardMiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/board-mi/monthly?month=${month}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` },
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setData(j.data);
        else setError(j.error || 'Load failed');
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [month]);

  // ── Outcome roll-ups ─────────────────────────────────────────────────────
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

  const outcomes: Array<{ n: number; title: string; rag: Rag; headline: string; subtitle: string; target: string }> = [
    {
      n: 1, title: 'Visibility & BI',
      rag: data?.availableKpis && data.availableKpis.length > 60 ? 'green' : data ? 'amber' : 'grey',
      headline: `${data?.availableKpis.length ?? '—'} KPIs`,
      subtitle: 'Baseline dashboard operational',
      target: 'Day 15 — live baseline',
    },
    {
      n: 2, title: 'Tiered Model & Escalation',
      rag: ragForPct(avgFrt, 95, 85),
      headline: fmtPct(avgFrt),
      subtitle: 'Avg FRT compliance (all tiers)',
      target: '≥95% compliance',
    },
    {
      n: 3, title: 'Customer Satisfaction',
      rag: ragForPct(data?.service.csat ?? null, 85, 70),
      headline: fmtPct(data?.service.csat ?? null),
      subtitle: 'CSAT score (month avg)',
      target: '+10–15% vs baseline',
    },
    {
      n: 4, title: 'Team & Development',
      rag: 'amber',
      headline: '1:1 tracking',
      subtitle: 'Performance framework ramping',
      target: '100% reviewed by Day 30',
    },
    {
      n: 5, title: 'Engineering Alignment',
      rag: data && data.escalation.frtBreachedDev !== null ? 'amber' : 'grey',
      headline: fmtNum(data?.escalation.frtBreachedDev ?? null),
      subtitle: 'Dev FRT breaches this month',
      target: '−30% bug ack time',
    },
    {
      n: 6, title: 'Production Quality',
      rag: 'amber',
      headline: fmtNum((data?.production.ticketsInCC_SR ?? 0) + (data?.production.ticketsInCC_Inc ?? 0) || null),
      subtitle: 'Production-routed tickets',
      target: '−50% template errors',
    },
  ];

  const downloadSnapshot = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `board-mi-${month}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative min-h-screen -mx-6 -my-4 px-8 py-8 overflow-hidden">
      {/* Animated gradient mesh background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-80"
        style={{
          background: `
            radial-gradient(ellipse at 15% 20%, rgba(94,193,202,0.12) 0%, transparent 45%),
            radial-gradient(ellipse at 85% 15%, rgba(155,106,237,0.10) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 90%, rgba(16,185,129,0.06) 0%, transparent 55%)
          `,
          animation: 'boardMesh 25s ease-in-out infinite alternate',
          zIndex: 0,
        }}
      />
      <style>{`
        @keyframes boardMesh {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-2%, 1%) scale(1.04); }
          100% { transform: translate(1%, -2%) scale(0.98); }
        }
        @keyframes boardShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes boardFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .board-fade { animation: boardFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
      `}</style>

      <div className="relative z-10 max-w-[1600px] mx-auto space-y-8">
        {/* ── Hero header ─────────────────────────────────────────────── */}
        <div className="board-fade flex items-start justify-between gap-6 pb-6 border-b border-white/5">
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
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-semibold">Technical Support</div>
                <h1
                  className="text-3xl font-black tracking-tight"
                  style={{
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Board MI Pack
                </h1>
              </div>
            </div>
            <div className="text-[12px] text-neutral-400 ml-[52px]">
              {data?.label ?? 'Loading…'} &middot; Mapped to HoTS 90-day framework &middot; {data?.availableKpis.length ?? 0} live KPIs
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-white/10 text-neutral-200 font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)' }}
            >
              {months.map((m) => <option key={m.value} value={m.value} className="bg-[#272C33]">{m.label}</option>)}
            </select>
            <button
              onClick={downloadSnapshot}
              disabled={!data}
              className="px-3 py-2 text-xs rounded-lg font-semibold text-[#0f172a] disabled:opacity-40 transition-all hover:scale-[1.03]"
              style={{
                background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)',
                boxShadow: '0 4px 20px rgba(94,193,202,0.35)',
              }}
            >
              ↓ Export Snapshot
            </button>
            <button
              onClick={() => window.print()}
              disabled={!data}
              className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-200 border border-white/10 hover:bg-white/5 transition-all"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              🖨 Print
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">
            {error}
          </div>
        )}
        {data?.dataError && (
          <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300">
            Warning: KPI data source reported "{data.dataError}". Showing partial results.
          </div>
        )}

        {/* ── 6 Outcome cards (hero row) ────────────────────────────── */}
        <div className="board-fade grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4" style={{ animationDelay: '0.1s' }}>
          {outcomes.map((o) => (
            <OutcomeCard key={o.n} number={o.n} title={o.title} rag={o.rag} headline={o.headline} subtitle={o.subtitle} target={o.target} />
          ))}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-neutral-500 text-sm">Loading board pack…</div>
          </div>
        ) : data ? (
          <>
            {/* ── Section 1: Service Performance ──────────────────── */}
            <section className="board-fade" style={{ animationDelay: '0.2s' }}>
              <SectionHeader num="01" title="Service Performance" subtitle="Outcome 1 & 3 · SLA compliance, volume, satisfaction" />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Big KPI tiles */}
                <GlassCard accent className="p-6 lg:col-span-2">
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <KpiTile label="Avg FRT compliance" value={fmtPct(avgFrt)} rag={ragForPct(avgFrt)} delta={null} />
                    <KpiTile
                      label="FCR Rate"
                      value={fmtPct(data.service.fcrRate)}
                      rag={ragForPct(data.service.fcrRate, 70, 50)}
                      delta={deltaPct(data.service.fcrRate, data.service.prevFcrRate)}
                    />
                    <KpiTile
                      label="CSAT"
                      value={fmtPct(data.service.csat)}
                      rag={ragForPct(data.service.csat, 85, 70)}
                      delta={deltaPct(data.service.csat, data.service.prevCsat)}
                    />
                  </div>
                  {/* Tier breakdown */}
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-3">FRT Compliance by Tier</div>
                  <div className="space-y-2">
                    {data.service.frtCompliance.map((t) => (
                      <TierRow key={t.tier} tier={t} />
                    ))}
                  </div>
                </GlassCard>

                <GlassCard accent className="p-6">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-3">Month at a Glance</div>
                  <div className="space-y-4">
                    <BigStat label="Tickets opened" value={fmtNum(data.service.ticketsOpened)} />
                    <BigStat
                      label="1st Line Resolution"
                      value={fmtPct(data.service.firstLineResolution)}
                      delta={deltaPct(data.service.firstLineResolution, data.service.prevFirstLineResolution)}
                    />
                    <BigStat label="Avg Resolution Compliance" value={fmtPct(avgRes)} />
                    <BigStat
                      label="FRT Breaches"
                      value={fmtNum(data.escalation.frtBreachedAll)}
                      delta={deltaPct(data.escalation.frtBreachedAll, data.escalation.prevFrtBreachedAll)}
                      inverseDelta
                    />
                  </div>
                </GlassCard>
              </div>
            </section>

            {/* ── Section 2: Escalation Health ────────────────────── */}
            <section className="board-fade" style={{ animationDelay: '0.3s' }}>
              <SectionHeader num="02" title="Tiered Model & Escalation Health" subtitle="Outcome 2 · Routing accuracy, breach distribution, engineering handoff" />
              <GlassCard accent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <BreachTile label="Customer Care" value={data.escalation.frtBreachedCC} colour="#5ec1ca" />
                  <BreachTile label="Tier 2" value={data.escalation.frtBreachedT2} colour="#9b6aed" />
                  <BreachTile label="Tier 3" value={data.escalation.frtBreachedT3} colour="#f59e0b" />
                  <BreachTile label="Development" value={data.escalation.frtBreachedDev} colour="#ef4444" />
                  <BreachTile label="All Tiers" value={data.escalation.frtBreachedAll} colour="#f8fafc" big />
                </div>
                <div className="mt-5 pt-5 border-t border-white/5 text-[11px] text-neutral-400 leading-relaxed">
                  <span className="text-neutral-300 font-semibold">Commentary:</span> Escalation reasons,
                  rejection rates and first-route accuracy (from Escalation Event Logger) wire in here
                  once the April backfill is clean.
                </div>
              </GlassCard>
            </section>

            {/* ── Section 3: QA, Engineering, Production ───────────── */}
            <section className="board-fade grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ animationDelay: '0.4s' }}>
              <PlaceholderCard
                num="03"
                title="Quality Assurance"
                outcome="Outcome 3"
                items={[
                  { label: 'Monthly audit score', value: 'awaiting QA_API_Summary wire-up' },
                  { label: 'Sample size', value: '—' },
                  { label: 'Top failure theme', value: '—' },
                ]}
              />
              <PlaceholderCard
                num="05"
                title="Engineering Loop"
                outcome="Outcome 5"
                items={[
                  { label: 'Bugs raised', value: '—' },
                  { label: 'Avg bug ack time', value: '—' },
                  { label: 'Product feedback accepted', value: '—' },
                ]}
              />
              <PlaceholderCard
                num="06"
                title="Production Team"
                outcome="Outcome 6"
                items={[
                  { label: 'Service requests in CC', value: fmtNum(data.production.ticketsInCC_SR) },
                  { label: 'Incidents in CC', value: fmtNum(data.production.ticketsInCC_Inc) },
                  { label: 'Template error rate', value: '—' },
                ]}
              />
            </section>

            {/* ── Section 4: People & Commercial ───────────────────── */}
            <section className="board-fade grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ animationDelay: '0.5s' }}>
              <PlaceholderCard
                num="07"
                title="People & Capacity"
                outcome="Outcome 4"
                items={[
                  { label: 'Headcount', value: '—' },
                  { label: '1:1 coverage', value: '—' },
                  { label: 'Flight risk flags', value: '—' },
                  { label: 'Training progression moves', value: '—' },
                ]}
              />
              <PlaceholderCard
                num="09"
                title="Commercial Impact"
                outcome="Board-critical framing"
                items={[
                  { label: 'Support-attributed cancellations', value: '—' },
                  { label: 'ARR at risk', value: '—' },
                  { label: 'KAM sentiment', value: '—' },
                  { label: 'Revenue protected', value: '—' },
                ]}
              />
            </section>

            {/* ── Forward look ─────────────────────────────────────── */}
            <section className="board-fade" style={{ animationDelay: '0.6s' }}>
              <GlassCard accent className="p-6">
                <SectionHeader num="10" title="Forward Look" subtitle="Next month's priorities, risks, and asks of the Board" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12px]">
                  <div>
                    <div className="text-[10px] uppercase text-[#5ec1ca] font-bold mb-2">Priorities</div>
                    <ul className="space-y-1 text-neutral-300">
                      <li>• Clean April KPI backfill gaps</li>
                      <li>• Wire QA_API_Summary into pack</li>
                      <li>• Complete tiered-model doc</li>
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#f59e0b] font-bold mb-2">Risks</div>
                    <ul className="space-y-1 text-neutral-300">
                      <li>• CSAT baseline not yet captured</li>
                      <li>• Production SLAs undefined</li>
                      <li>• Flight-risk visibility limited</li>
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#9b6aed] font-bold mb-2">Asks</div>
                    <ul className="space-y-1 text-neutral-300">
                      <li>• Endorse tiered model rollout</li>
                      <li>• Greenlight QA tooling spend</li>
                      <li>• Sponsor SDM bug-triage cadence</li>
                    </ul>
                  </div>
                </div>
              </GlassCard>
            </section>

            <div className="text-center text-[10px] text-neutral-600 pt-4 pb-8">
              Board MI Pack &middot; Generated {new Date().toLocaleDateString('en-GB')} &middot; Source: jira_kpi_daily, Escalation Log, QA_API_Summary &middot; v1
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function KpiTile({ label, value, rag, delta }: { label: string; value: string; rag: Rag; delta: number | null }) {
  const ragColour =
    rag === 'green' ? '#10b981' :
    rag === 'amber' ? '#f59e0b' :
    rag === 'red' ? '#ef4444' : '#64748b';
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 mb-1">
        <RagDot rag={rag} />
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">{label}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className="text-3xl font-black tracking-tight"
          style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: ragColour }}
        >
          {value}
        </div>
        <DeltaChip delta={delta} />
      </div>
    </div>
  );
}

function BigStat({ label, value, delta, inverseDelta }: { label: string; value: string; delta?: number | null; inverseDelta?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="flex items-center gap-2">
        <div
          className="text-lg font-bold text-neutral-100"
          style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
          {value}
        </div>
        {delta !== undefined && <DeltaChip delta={delta ?? null} inverse={inverseDelta} />}
      </div>
    </div>
  );
}

function TierRow({ tier }: { tier: TierCompliance }) {
  const rag = ragForPct(tier.current);
  const delta = deltaPct(tier.current, tier.previous);
  const pct = tier.current ?? 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-[11px] text-neutral-300 font-medium">{tier.tier}</div>
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
        <div className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-white/90">
          {fmtPct(tier.current)}
        </div>
      </div>
      <div className="w-16 text-right"><DeltaChip delta={delta} /></div>
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
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2">{label}</div>
      <div
        className={`${big ? 'text-4xl' : 'text-2xl'} font-black tracking-tight`}
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: colour }}
      >
        {fmtNum(value)}
      </div>
      <div className="text-[10px] text-neutral-600 mt-1">FRT breaches</div>
    </div>
  );
}

function PlaceholderCard({ num, title, outcome, items }: { num: string; title: string; outcome: string; items: Array<{ label: string; value: string }> }) {
  return (
    <GlassCard accent className="p-6">
      <SectionHeader num={num} title={title} subtitle={outcome} />
      <div className="space-y-2.5">
        {items.map((i) => (
          <div key={i.label} className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-500">{i.label}</span>
            <span className="text-neutral-200 font-semibold">{i.value}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
