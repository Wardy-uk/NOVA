import { useEffect, useState, type ReactNode } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

// TPJ Maintenance dashboard (NTPJ project) — Lucy's team. Two sub-tabs:
// Dashboard (ops snapshot + charts) and KPI metrics (PSP velocity, SLO, per-agent).
// Data: /api/tpj-maintenance/* — live Jira for time-series, EOD snapshot for backlog.

// House dark palette + spec chart colours (used verbatim per spec).
const C = {
  bg2: '#2f353d', bg3: '#343a42',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.08)', glass: 'rgba(255,255,255,0.03)',
  purple: '#7c8cf8', green: '#4ade80', coral: '#f87171', amber: '#fbbf24',
};

const iso = (d: Date) => d.toLocaleDateString('en-CA');
const mondayOf = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; };
const ddmm = (s: string) => { const p = s.split('-'); return `${p[2]}/${p[1]}`; };

type SubTab = 'dashboard' | 'metrics' | 'daily';

export function TpjMaintenanceView() {
  const today = new Date();
  const [subTab, setSubTab] = useState<SubTab>('dashboard');
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));

  function quick(kind: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'last30') {
    const t = new Date();
    if (kind === 'thisWeek') { setFrom(iso(mondayOf(t))); setTo(iso(t)); }
    else if (kind === 'lastWeek') { const m = mondayOf(t); const e = new Date(m); e.setDate(m.getDate() - 1); const s = new Date(m); s.setDate(m.getDate() - 7); setFrom(iso(s)); setTo(iso(e)); }
    else if (kind === 'thisMonth') { setFrom(iso(new Date(t.getFullYear(), t.getMonth(), 1))); setTo(iso(t)); }
    else { const s = new Date(t); s.setDate(t.getDate() - 29); setFrom(iso(s)); setTo(iso(t)); }
  }
  const qbtn = 'px-2.5 py-1 text-xs rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-slate-300';
  const tab = (k: SubTab, label: string) => (
    <button key={k} onClick={() => setSubTab(k)}
      className={`px-4 py-1.5 text-xs rounded-lg transition-colors border ${subTab === k
        ? 'bg-[#7c8cf8]/15 text-[#7c8cf8] font-semibold border-[#7c8cf8]/30'
        : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200 border-transparent'}`}>
      {label}
    </button>
  );

  return (
    <div className="p-6" style={{ color: C.text1 }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">TPJ Maintenance</h1>
          <p className="text-xs" style={{ color: C.text3 }}>NTPJ · Lucy's team</p>
        </div>
        <div className="flex items-center gap-2">{tab('dashboard', 'Dashboard')}{tab('metrics', 'KPI metrics')}{tab('daily', 'Daily KPIs')}</div>
      </div>

      <div className={`flex-wrap items-center gap-2 mb-5 ${subTab === 'daily' ? 'hidden' : 'flex'}`}>
        <label className="text-xs" style={{ color: C.text2 }}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1 text-sm rounded bg-black/30 border border-white/10" />
        <label className="text-xs" style={{ color: C.text2 }}>To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1 text-sm rounded bg-black/30 border border-white/10" />
        <button onClick={() => quick('thisWeek')} className={qbtn}>This Week</button>
        <button onClick={() => quick('lastWeek')} className={qbtn}>Last Week</button>
        <button onClick={() => quick('thisMonth')} className={qbtn}>This Month</button>
        <button onClick={() => quick('last30')} className={qbtn}>Last 30 Days</button>
      </div>

      {subTab === 'dashboard' && <DashboardPage from={from} to={to} />}
      {subTab === 'metrics' && <MetricsPage from={from} to={to} />}
      {subTab === 'daily' && <DailyKpisPage />}
    </div>
  );
}

// ── Page 3: Daily KPIs (TPJ / Yomdel scorecard) ──

interface DailyMetric { label: string; value: string | number | null; available: boolean; note?: string }

function DailyKpisPage() {
  const { data, loading, error } = useJson<{ tpj: DailyMetric[]; yomdel: DailyMetric[] }>('/api/tpj-maintenance/daily-kpis');
  return (
    <div className="space-y-5">
      {error && <ErrBox msg={error} />}
      <p className="text-xs" style={{ color: C.text3 }}>Live snapshot of today's figures. Metrics sourced outside Jira show “—”.</p>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <ScoreCard title="TPJ — SUPPORT WEB - UK" accent={C.purple} rows={data?.tpj} loading={loading} />
        <ScoreCard title="Yomdel — SUPPORT Chat" accent={C.green} rows={data?.yomdel} loading={loading} />
      </div>
    </div>
  );
}

function ScoreCard({ title, accent, rows, loading }: { title: string; accent: string; rows?: DailyMetric[]; loading: boolean }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: C.glass, border: `1px solid ${C.border}` }}>
      <div className="px-4 py-2.5 text-sm font-semibold" style={{ color: C.text1, borderLeft: `3px solid ${accent}`, background: 'rgba(255,255,255,0.02)' }}>{title}</div>
      {loading && !rows && <div className="px-4 py-4 text-xs" style={{ color: C.text3 }}>Loading…</div>}
      <table className="w-full text-sm">
        <tbody>
          {(rows ?? []).map((m, i) => (
            <tr key={m.label} style={{ borderTop: i ? `1px solid ${C.border}` : undefined }}>
              <td className="px-4 py-2.5" style={{ color: m.available ? C.text2 : C.text3, borderTop: `1px solid ${C.border}` }}>
                {m.label}
                {!m.available && m.note && <span className="ml-2 text-[10px]" style={{ color: C.text3 }}>· {m.note}</span>}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums" style={{ color: m.available ? C.text1 : C.text3, borderTop: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                {m.available ? (m.value ?? '0') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared UI ──

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.border}` }}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: C.text1 }}>{title}</h3>
        {note && <span className="text-[10px]" style={{ color: C.text3 }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, delta, accent }: {
  label: string; value: string; sub?: string; delta?: number | null; accent?: string;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.border}`, borderLeft: `3px solid ${accent ?? C.purple}` }}>
      <div className="text-[11px] font-semibold mb-1" style={{ color: C.text2 }}>{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold" style={{ color: C.text1 }}>{value}</span>
        {delta != null && (
          <span className="text-xs font-semibold" style={{ color: delta >= 0 ? C.green : C.coral }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] mt-1" style={{ color: C.text3 }}>{sub}</div>}
    </div>
  );
}

const ragBacklog = (n: number) => (n < 5 ? C.green : n <= 15 ? C.amber : C.coral);
const ragPct = (p: number) => (p >= 85 ? C.green : p >= 70 ? C.amber : C.coral);
const ragPsp = (n: number) => (n >= 180 ? C.green : n >= 140 ? C.amber : C.coral);

// Common Chart.js options for the dark theme.
function axes(stacked = false) {
  return {
    x: { stacked, ticks: { color: C.text3, font: { size: 10 }, maxRotation: 45 }, grid: { color: C.border } },
    y: { stacked, beginAtZero: true, ticks: { color: C.text3, font: { size: 10 } }, grid: { color: C.border } },
  } as const;
}
const legendOpt = { labels: { color: C.text2, font: { size: 11 }, boxWidth: 12 } } as const;

function useJson<T>(url: string): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    fetch(url).then(r => r.json()).then(j => {
      if (!live) return;
      if (j.ok) setData(j.data); else setError(j.error ?? 'Failed to load');
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url]);
  return { data, loading, error };
}

// ── Page 1: Dashboard ──

interface Snapshot { created: number; createdDelta: number | null; resolved: number; solveRate: number; slaMetPct: number; slaMetDelta: number | null; backlogOver30: number; }
interface DayCR { date: string; created: number; resolved: number; }
interface DayME { date: string; met: number; exceeded: number; }
interface SlaStatusData {
  doughnut: { met: number; inProgress: number; exceeded: number }; metPct: number;
  buckets: string[]; priorities: string[];
  table: Record<string, Record<string, { met: number; total: number }>>;
}

function DashboardPage({ from, to }: { from: string; to: string }) {
  const q = `from=${from}&to=${to}`;
  const snap = useJson<Snapshot>(`/api/tpj-maintenance/dashboard?${q}`);
  const cr = useJson<DayCR[]>(`/api/tpj-maintenance/raised-vs-solved?${q}`);
  const sla = useJson<SlaStatusData>(`/api/tpj-maintenance/sla-status?${q}`);
  const slaDaily = useJson<DayME[]>(`/api/tpj-maintenance/sla-daily?${q}`);
  const backlog = useJson<{ byDay: Record<string, { wip: number; waiting: number }> }>(`/api/tpj-maintenance/backlog-daily?${q}`);

  const s = snap.data;
  return (
    <div className="space-y-5">
      {snap.error && <ErrBox msg={snap.error} />}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <StatCard label="Tickets created" value={s ? String(s.created) : '—'} delta={s?.createdDelta} accent={C.purple} />
        <StatCard label="Tickets resolved" value={s ? String(s.resolved) : '—'} sub={s ? `Solve rate ${s.solveRate}%` : undefined} accent={C.green} />
        <StatCard label="SLA met" value={s ? `${s.slaMetPct}%` : '—'} delta={s?.slaMetDelta} accent={C.green} />
        <StatCard label="Backlog >30 days" value={s ? String(s.backlogOver30) : '—'} accent={s ? ragBacklog(s.backlogOver30) : C.purple} />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Panel title="Tickets raised vs solved">
          <div style={{ height: 240 }}>
            {cr.data && <Line
              data={{
                labels: cr.data.map(d => ddmm(d.date)),
                datasets: [
                  { label: 'Created', data: cr.data.map(d => d.created), borderColor: C.purple, backgroundColor: `${C.purple}22`, tension: 0.3, pointRadius: 2, fill: true },
                  { label: 'Resolved', data: cr.data.map(d => d.resolved), borderColor: C.green, backgroundColor: `${C.green}22`, tension: 0.3, pointRadius: 2, fill: true },
                ],
              }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpt }, scales: axes() }}
            />}
          </div>
        </Panel>

        <Panel title="SLA status" note="First Response Time SLA (24h)">
          <div className="flex items-center gap-4">
            <div style={{ position: 'relative', width: 180, height: 180 }}>
              {sla.data && <Doughnut
                data={{
                  labels: ['Met', 'In Progress', 'Exceeded'],
                  datasets: [{ data: [sla.data.doughnut.met, sla.data.doughnut.inProgress, sla.data.doughnut.exceeded], backgroundColor: [C.green, C.purple, C.coral], borderWidth: 0 }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }}
              />}
              {sla.data && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="text-2xl font-extrabold" style={{ color: C.text1 }}>{sla.data.metPct}%</span>
                <span className="text-[10px]" style={{ color: C.text3 }}>met</span>
              </div>}
            </div>
            {sla.data && <SlaTable d={sla.data} />}
          </div>
        </Panel>

        <Panel title="SLA met vs exceeded">
          <div style={{ height: 240 }}>
            {slaDaily.data && <Line
              data={{
                labels: slaDaily.data.map(d => ddmm(d.date)),
                datasets: [
                  { label: 'Met', data: slaDaily.data.map(d => d.met), borderColor: C.green, backgroundColor: `${C.green}22`, tension: 0.3, pointRadius: 2 },
                  { label: 'Exceeded', data: slaDaily.data.map(d => d.exceeded), borderColor: C.coral, backgroundColor: `${C.coral}22`, tension: 0.3, pointRadius: 2 },
                ],
              }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpt }, scales: axes() }}
            />}
          </div>
        </Panel>

        <Panel title="Daily backlog by status" note="WIP / Waiting accrue from go-live">
          <div style={{ height: 240 }}>
            {cr.data && backlog.data && (() => {
              const labels = cr.data.map(d => d.date);
              const by = backlog.data!.byDay;
              return <Bar
                data={{
                  labels: labels.map(ddmm),
                  datasets: [
                    { label: 'Resolved', data: cr.data!.map(d => d.resolved), backgroundColor: C.green },
                    { label: 'Work in progress', data: labels.map(d => by[d]?.wip ?? 0), backgroundColor: C.purple },
                    { label: 'Waiting on Requestor', data: labels.map(d => by[d]?.waiting ?? 0), backgroundColor: C.amber },
                  ],
                }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpt }, scales: axes(true) }}
              />;
            })()}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SlaTable({ d }: { d: SlaStatusData }) {
  const pct = (c: { met: number; total: number }) => (c.total ? `${Math.round((c.met / c.total) * 100)}%` : '—');
  return (
    <div className="flex-1 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: C.text3 }}>
            <th className="text-left font-medium py-1">Type</th>
            {d.priorities.map(p => <th key={p} className="text-center font-medium py-1">{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {d.buckets.map(b => (
            <tr key={b} style={{ borderTop: `1px solid ${C.border}` }}>
              <td className="py-1.5" style={{ color: C.text2 }}>{b}</td>
              {d.priorities.map(p => {
                const cell = d.table[b]?.[p] ?? { met: 0, total: 0 };
                return <td key={p} className="text-center py-1.5" style={{ color: cell.total ? ragPct(cell.total ? (cell.met / cell.total) * 100 : 0) : C.text3 }}>{pct(cell)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return <div className="p-3 rounded-lg text-sm" style={{ background: 'rgba(248,113,113,0.12)', border: `1px solid ${C.coral}55`, color: C.coral }}>{msg}</div>;
}

// ── Page 2: KPI metrics ──

interface AgentRow { agentId: string; agent: string; psp: number; firstReplyPct: number; sloPct: number; reopenPct: number; backlogOver30: number; }
interface Metrics {
  team: { pspTotal: number; pspTarget: number; agentCount: number; firstReplyPct: number; sloPct: number; reopenPct: number; reopenAvoidablePct: number };
  agents: AgentRow[];
}
type SortKey = keyof Pick<AgentRow, 'agent' | 'psp' | 'firstReplyPct' | 'sloPct' | 'reopenPct' | 'backlogOver30'>;

function MetricsPage({ from, to }: { from: string; to: string }) {
  const q = `from=${from}&to=${to}`;
  const metrics = useJson<Metrics>(`/api/tpj-maintenance/metrics?${q}`);
  const psp = useJson<{ target: number; agents: { agent: string; psp: number }[] }>(`/api/tpj-maintenance/psp-monthly?${q}`);
  const trend = useJson<{ target: number; weeks: { week: string; firstReplyPct: number; sloPct: number }[] }>(`/api/tpj-maintenance/slo-trend?${q}`);

  const [sortKey, setSortKey] = useState<SortKey>('psp');
  const [asc, setAsc] = useState(false);
  function sortBy(k: SortKey) { if (k === sortKey) setAsc(!asc); else { setSortKey(k); setAsc(k === 'agent'); } }

  const t = metrics.data?.team;
  const agents = [...(metrics.data?.agents ?? [])].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    const cmp = typeof av === 'string' ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
    return asc ? cmp : -cmp;
  });

  const cols: [SortKey, string][] = [['agent', 'Agent'], ['psp', 'PSPs'], ['firstReplyPct', '1st reply'], ['sloPct', 'SLO'], ['reopenPct', 'Reopen'], ['backlogOver30', 'Backlog >30d']];

  return (
    <div className="space-y-5">
      {metrics.error && <ErrBox msg={metrics.error} />}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <StatCard label="Team PSPs" value={t ? String(t.pspTotal) : '—'} sub={t ? `Target ${t.pspTarget} (${t.agentCount}×180)` : undefined} accent={t ? ragPsp(t.agentCount ? t.pspTotal / t.agentCount : 0) : C.purple} />
        <StatCard label="First reply ≤24h" value={t ? `${t.firstReplyPct}%` : '—'} accent={t ? ragPct(t.firstReplyPct) : C.purple} />
        <StatCard label="SLO compliance" value={t ? `${t.sloPct}%` : '—'} sub="Resolved within due date" accent={t ? ragPct(t.sloPct) : C.purple} />
        <StatCard label="Reopen rate" value={t ? `${t.reopenPct}%` : '—'} sub={t ? `${t.reopenAvoidablePct}% avoidable` : undefined} accent={C.purple} />
      </div>

      <Panel title="Per agent">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: C.text3 }}>
                {cols.map(([k, label]) => (
                  <th key={k} onClick={() => sortBy(k)} className="py-2 px-2 font-medium cursor-pointer select-none whitespace-nowrap"
                    style={{ textAlign: k === 'agent' ? 'left' : 'left' }}>
                    {label}{sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.agentId} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td className="py-2 px-2" style={{ color: C.text1 }}>{a.agent}</td>
                  <td className="py-2 px-2" style={{ minWidth: 150 }}>
                    <div className="flex items-center gap-2">
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', minWidth: 70 }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (a.psp / 180) * 100)}%`, background: ragPsp(a.psp) }} />
                      </div>
                      <span style={{ color: C.text2, width: 28, textAlign: 'right' }}>{a.psp}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2"><Pill pct={a.firstReplyPct} /></td>
                  <td className="py-2 px-2"><Pill pct={a.sloPct} /></td>
                  <td className="py-2 px-2" style={{ color: C.text2 }}>{a.reopenPct}%</td>
                  <td className="py-2 px-2" style={{ color: a.backlogOver30 > 15 ? C.coral : a.backlogOver30 >= 5 ? C.amber : C.text2 }}>{a.backlogOver30}</td>
                </tr>
              ))}
              {!agents.length && !metrics.loading && <tr><td colSpan={6} className="py-4 text-center" style={{ color: C.text3 }}>No agent activity in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Panel title="PSPs — monthly progress" note="Target 180/agent">
          <div style={{ height: 260 }}>
            {psp.data && <Bar
              data={{
                labels: psp.data.agents.map(a => a.agent),
                datasets: [{ label: 'PSPs', data: psp.data.agents.map(a => a.psp), backgroundColor: psp.data.agents.map(a => ragPsp(a.psp)) }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { ...axes(), y: { ...axes().y, suggestedMax: 200 } },
              }}
            />}
          </div>
          <div className="text-[10px] mt-1" style={{ color: C.text3 }}>Dashed target line = 180 PSPs.</div>
        </Panel>

        <Panel title="SLO compliance trend" note="Last 4 weeks · target 85%">
          <div style={{ height: 260 }}>
            {trend.data && <Line
              data={{
                labels: trend.data.weeks.map(w => w.week),
                datasets: [
                  { label: '1st reply ≤24h', data: trend.data.weeks.map(w => w.firstReplyPct), borderColor: C.green, backgroundColor: `${C.green}22`, tension: 0.3, pointRadius: 3 },
                  { label: 'SLO overall', data: trend.data.weeks.map(w => w.sloPct), borderColor: C.purple, backgroundColor: `${C.purple}22`, tension: 0.3, pointRadius: 3 },
                  { label: 'Target', data: trend.data.weeks.map(() => trend.data!.target), borderColor: C.text3, borderDash: [5, 5], pointRadius: 0, fill: false },
                ],
              }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpt }, scales: { ...axes(), y: { ...axes().y, suggestedMax: 100 } } }}
            />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Pill({ pct }: { pct: number }) {
  const c = ragPct(pct);
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: c, background: `${c}1f` }}>{pct}%</span>;
}
