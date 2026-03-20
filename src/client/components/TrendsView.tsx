import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler, annotationPlugin);

/* ------------------------------------------------------------------ */
/*  Colours & Tokens (matches KpiDashboardView)                        */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  bg3: '#343a42',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  blue: '#3b82f6',
  pink: '#ec4899',
  orange: '#f97316',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
} as const;

const CHART_COLORS = [C.teal, C.purple, C.blue, C.pink, C.orange, C.green, C.amber, C.red];

function fmtNum(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined) return '\u2014';
  return Number.isFinite(v) ? v.toFixed(dp) : String(v);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function ragColor(value: number | null, target: number | null, direction: string): string {
  if (value === null || target === null) return C.text3;
  if (direction === 'higher') {
    if (value >= target) return C.green;
    if (value >= target * 0.9) return C.amber;
    return C.red;
  }
  // lower is better
  if (value <= target) return C.green;
  if (value <= target * 1.15) return C.amber;
  return C.red;
}

/* ------------------------------------------------------------------ */
/*  Shared chart options                                               */
/* ------------------------------------------------------------------ */

const DAY1_DATE = '2026-03-16';

function baseLineOptions(title: string, targetValue?: number | null): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: C.text2, boxWidth: 12, padding: 16, font: { size: 11 } } },
      title: { display: true, text: title, color: C.text1, font: { size: 14, weight: 'bold' as const }, padding: { bottom: 16 } },
      annotation: {
        annotations: {
          day1Line: {
            type: 'line' as const,
            xMin: DAY1_DATE,
            xMax: DAY1_DATE,
            borderColor: C.teal,
            borderWidth: 1.5,
            borderDash: [4, 4],
            label: { display: true, content: 'Day 1', color: C.teal, font: { size: 10 }, position: 'start' as const },
          },
          ...(targetValue != null ? {
            targetLine: {
              type: 'line' as const,
              yMin: targetValue,
              yMax: targetValue,
              borderColor: C.green,
              borderWidth: 1.5,
              borderDash: [6, 3],
              label: { display: true, content: `Target: ${targetValue}`, color: C.green, font: { size: 10 }, position: 'end' as const },
            },
          } : {}),
        },
      },
    },
    scales: {
      x: { ticks: { color: C.text3, font: { size: 10 }, maxRotation: 45 }, grid: { color: C.border } },
      y: { ticks: { color: C.text3, font: { size: 10 } }, grid: { color: C.border } },
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Section components                                                 */
/* ------------------------------------------------------------------ */

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border p-5 ${className}`} style={{ background: C.bg2, borderColor: C.border }}>
      {title && <h3 className="text-sm font-semibold mb-4" style={{ color: C.text1 }}>{title}</h3>}
      {children}
    </div>
  );
}

/* ── Section 5: Checkpoint Evidence Panel ── */

interface CheckpointData {
  checkpoints: Array<{ label: string; date: string }>;
  metrics: Array<{
    key: string;
    label: string;
    target: number | null;
    direction: string;
    checkpoints: Record<string, number | null>;
    current: number | null;
  }>;
}

function CheckpointPanel({ data }: { data: CheckpointData | null }) {
  const downloadCsv = useCallback(() => {
    if (!data) return;
    const headers = ['Metric', ...data.checkpoints.map(c => `${c.label} (${c.date})`), 'Current', 'Target', 'Status'];
    const rows = data.metrics.map(m => {
      const status = m.current !== null && m.target !== null
        ? (m.direction === 'higher' ? (m.current >= m.target ? 'On Track' : 'Behind') : (m.current <= m.target ? 'On Track' : 'Behind'))
        : 'TBD';
      return [
        m.label,
        ...data.checkpoints.map(c => fmtNum(m.checkpoints[c.label], 1)),
        fmtNum(m.current, 1),
        m.target !== null ? String(m.target) : 'TBD',
        status,
      ];
    });
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checkpoint-evidence-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  if (!data) return <Card title="Checkpoint Evidence Panel"><p style={{ color: C.text3 }}>Loading...</p></Card>;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: C.text1 }}>Checkpoint Evidence Panel</h3>
        <button
          onClick={downloadCsv}
          className="text-xs px-3 py-1.5 rounded-md border transition-colors"
          style={{ borderColor: C.teal, color: C.teal, background: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(94,193,202,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="text-left py-2 px-3 font-medium sticky left-0" style={{ color: C.text2, background: C.bg2, borderBottom: `1px solid ${C.border}` }}>Metric</th>
              {data.checkpoints.map(cp => (
                <th key={cp.label} className="text-center py-2 px-3 font-medium" style={{ color: C.text2, borderBottom: `1px solid ${C.border}` }}>
                  {cp.label}
                  <div className="text-[10px] font-normal" style={{ color: C.text3 }}>{fmtDate(cp.date)}</div>
                </th>
              ))}
              <th className="text-center py-2 px-3 font-medium" style={{ color: C.teal, borderBottom: `1px solid ${C.border}` }}>Current</th>
              <th className="text-center py-2 px-3 font-medium" style={{ color: C.text2, borderBottom: `1px solid ${C.border}` }}>Target</th>
              <th className="text-center py-2 px-3 font-medium" style={{ color: C.text2, borderBottom: `1px solid ${C.border}` }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.metrics.map(m => {
              const statusColor = ragColor(m.current, m.target, m.direction);
              const statusLabel = m.current !== null && m.target !== null
                ? (m.direction === 'higher' ? (m.current >= m.target ? 'On Track' : 'Behind') : (m.current <= m.target ? 'On Track' : 'Behind'))
                : 'TBD';
              return (
                <tr key={m.key}>
                  <td className="py-2.5 px-3 font-medium sticky left-0" style={{ color: C.text1, background: C.bg2, borderBottom: `1px solid ${C.border}` }}>{m.label}</td>
                  {data.checkpoints.map(cp => {
                    const val = m.checkpoints[cp.label];
                    const isPast = new Date(cp.date) <= new Date();
                    return (
                      <td key={cp.label} className="text-center py-2.5 px-3" style={{ color: val !== null ? C.text1 : C.text3, borderBottom: `1px solid ${C.border}` }}>
                        {val !== null ? fmtNum(val, 1) : (isPast ? '\u2014' : '\u2014')}
                      </td>
                    );
                  })}
                  <td className="text-center py-2.5 px-3 font-semibold" style={{ color: statusColor, borderBottom: `1px solid ${C.border}` }}>
                    {fmtNum(m.current, 1)}
                  </td>
                  <td className="text-center py-2.5 px-3" style={{ color: C.text2, borderBottom: `1px solid ${C.border}` }}>
                    {m.target !== null ? String(m.target) : 'TBD'}
                  </td>
                  <td className="text-center py-2.5 px-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: statusColor, background: `${statusColor}15` }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[10px]" style={{ color: C.text3 }}>
        Checkpoints: D1=16 Mar, D15=31 Mar, D30=15 Apr, D45=30 Apr, D60=15 May, D90=14 Jun &bull; Values auto-populate from closest daily snapshot
      </div>
    </Card>
  );
}

/* ── Section 1: SLA Compliance Trend ── */

function SlaSection({ data }: { data: any[] | null }) {
  if (!data || data.length === 0) return <Card title="SLA Compliance Trend"><p style={{ color: C.text3 }}>No data available</p></Card>;

  // Group by kpi
  const kpis = [...new Set(data.map((r: any) => r.kpi))];
  const frtKpis = kpis.filter(k => k.includes('FRT'));
  const resKpis = kpis.filter(k => k.includes('Resolution'));

  const buildDataset = (filteredKpis: string[]) => {
    const labels = [...new Set(data.filter((r: any) => filteredKpis.includes(r.kpi)).map((r: any) => r.period))].sort();
    const datasets = filteredKpis.map((kpi, i) => ({
      label: kpi.replace(/ *\(.*$/, '').replace('Compliance', '').trim(),
      data: labels.map(l => data.find((r: any) => r.kpi === kpi && r.period === l)?.avg_value ?? null),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: `${CHART_COLORS[i % CHART_COLORS.length]}20`,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
    }));
    return { labels: labels.map(l => fmtDate(l)), datasets };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div style={{ height: 280 }}>
          <Line data={buildDataset(frtKpis)} options={baseLineOptions('FRT Compliance %', 95)} />
        </div>
      </Card>
      <Card>
        <div style={{ height: 280 }}>
          <Line data={buildDataset(resKpis)} options={baseLineOptions('Resolution Compliance %', 95)} />
        </div>
      </Card>
    </div>
  );
}

/* ── Section 2: Queue Health ── */

function QueueSection({ data }: { data: any[] | null }) {
  if (!data || data.length === 0) return <Card title="Queue Health Trend"><p style={{ color: C.text3 }}>No data available</p></Card>;

  const volumeKpis = data.filter((r: any) =>
    r.kpi?.toLowerCase().includes('open') && !r.kpi?.toLowerCase().includes('oldest') && !r.kpi?.toLowerCase().includes('age')
  );
  const ageKpis = data.filter((r: any) =>
    r.kpi?.toLowerCase().includes('oldest') || r.kpi?.toLowerCase().includes('age')
  );

  const buildDataset = (filtered: any[]) => {
    const kpis = [...new Set(filtered.map((r: any) => r.kpi))].slice(0, 6);
    const labels = [...new Set(filtered.map((r: any) => r.period))].sort();
    const datasets = kpis.map((kpi, i) => ({
      label: kpi.replace(/ *\(.*$/, '').trim(),
      data: labels.map(l => filtered.find((r: any) => r.kpi === kpi && r.period === l)?.avg_value ?? null),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: `${CHART_COLORS[i % CHART_COLORS.length]}20`,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
    }));
    return { labels: labels.map(l => fmtDate(l)), datasets };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div style={{ height: 280 }}>
          <Line data={buildDataset(volumeKpis)} options={baseLineOptions('Open Tickets by Tier')} />
        </div>
      </Card>
      <Card>
        <div style={{ height: 280 }}>
          <Line data={buildDataset(ageKpis)} options={baseLineOptions('Oldest Actionable Ticket Age (days)')} />
        </div>
      </Card>
    </div>
  );
}

/* ── Section 4: Escalation Trend ── */

function EscalationSection({ data }: { data: any[] | null }) {
  if (!data || data.length === 0) return <Card title="Escalation Trend"><p style={{ color: C.text3 }}>No data available</p></Card>;

  const accuracyKpis = data.filter((r: any) => r.kpi?.toLowerCase().includes('accuracy'));
  const countKpis = data.filter((r: any) => !r.kpi?.toLowerCase().includes('accuracy'));

  const buildLineData = (filtered: any[]) => {
    const kpis = [...new Set(filtered.map((r: any) => r.kpi))];
    const labels = [...new Set(filtered.map((r: any) => r.period))].sort();
    const datasets = kpis.map((kpi, i) => ({
      label: kpi.replace(/ *\(.*$/, '').trim(),
      data: labels.map(l => filtered.find((r: any) => r.kpi === kpi && r.period === l)?.avg_value ?? null),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: `${CHART_COLORS[i % CHART_COLORS.length]}20`,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
    }));
    return { labels: labels.map(l => fmtDate(l)), datasets };
  };

  const buildBarData = (filtered: any[]) => {
    const kpis = [...new Set(filtered.map((r: any) => r.kpi))].slice(0, 6);
    const labels = [...new Set(filtered.map((r: any) => r.period))].sort();
    const datasets = kpis.map((kpi, i) => ({
      label: kpi.replace(/ *\(.*$/, '').trim(),
      data: labels.map(l => filtered.find((r: any) => r.kpi === kpi && r.period === l)?.avg_value ?? null),
      backgroundColor: `${CHART_COLORS[i % CHART_COLORS.length]}80`,
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      borderWidth: 1,
    }));
    return { labels: labels.map(l => fmtDate(l)), datasets };
  };

  const barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: C.text2, boxWidth: 12, padding: 16, font: { size: 11 } } },
      title: { display: true, text: 'Escalation Counts by Tier', color: C.text1, font: { size: 14, weight: 'bold' as const }, padding: { bottom: 16 } },
    },
    scales: {
      x: { stacked: true, ticks: { color: C.text3, font: { size: 10 }, maxRotation: 45 }, grid: { color: C.border } },
      y: { stacked: true, ticks: { color: C.text3, font: { size: 10 } }, grid: { color: C.border } },
    },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div style={{ height: 280 }}>
          <Line data={buildLineData(accuracyKpis)} options={baseLineOptions('Escalation Accuracy %', 90)} />
        </div>
      </Card>
      <Card>
        <div style={{ height: 280 }}>
          <Bar data={buildBarData(countKpis)} options={barOptions} />
        </div>
      </Card>
    </div>
  );
}

/* ── Section 3: QA & Golden Rules Trend ── */

interface QaData {
  qaScores: Array<{ period: string; avg_score: number; ticket_count: number }>;
  goldenRules: Array<{ period: string; ownership_pct: number; next_action_pct: number; timeframe_pct: number; comment_count: number }>;
  agents: string[];
}

function QaSection({ data, agent, onAgentChange }: { data: QaData | null; agent: string; onAgentChange: (a: string) => void }) {
  if (!data) return <Card title="QA & Golden Rules Trend"><p style={{ color: C.text3 }}>Loading...</p></Card>;

  const qaLabels = data.qaScores.map(r => fmtDate(r.period));
  const qaChartData = {
    labels: qaLabels,
    datasets: [{
      label: 'QA Avg Score (1-10)',
      data: data.qaScores.map(r => r.avg_score),
      borderColor: C.teal,
      backgroundColor: `${C.teal}20`,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
      fill: true,
    }],
  };

  const grLabels = data.goldenRules.map(r => fmtDate(r.period));
  const grChartData = {
    labels: grLabels,
    datasets: [
      { label: 'Ownership %', data: data.goldenRules.map(r => r.ownership_pct), borderColor: C.teal, backgroundColor: `${C.teal}20`, tension: 0.3, pointRadius: 2, borderWidth: 2 },
      { label: 'Next Action %', data: data.goldenRules.map(r => r.next_action_pct), borderColor: C.purple, backgroundColor: `${C.purple}20`, tension: 0.3, pointRadius: 2, borderWidth: 2 },
      { label: 'Timeframe %', data: data.goldenRules.map(r => r.timeframe_pct), borderColor: C.blue, backgroundColor: `${C.blue}20`, tension: 0.3, pointRadius: 2, borderWidth: 2 },
    ],
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs font-medium" style={{ color: C.text2 }}>Agent:</label>
        <select
          value={agent}
          onChange={e => onAgentChange(e.target.value)}
          className="text-xs rounded-md border px-2 py-1.5"
          style={{ background: C.bg3, borderColor: C.border, color: C.text1 }}
        >
          <option value="all">All Agents (Team Average)</option>
          {data.agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div style={{ height: 280 }}>
            <Line data={qaChartData} options={baseLineOptions('Team QA Average Score', 8.0)} />
          </div>
        </Card>
        <Card>
          <div style={{ height: 280 }}>
            <Line data={grChartData} options={baseLineOptions('Golden Rules Compliance %', 80)} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main TrendsView                                                    */
/* ------------------------------------------------------------------ */

type DateRange = '4w' | '8w' | '12w' | 'custom';
type Granularity = 'daily' | 'weekly';

export function TrendsView() {
  const [dateRange, setDateRange] = useState<DateRange>('12w');
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [env, setEnv] = useState<'live' | 'uat'>('live');
  const [loading, setLoading] = useState(true);

  const [checkpointData, setCheckpointData] = useState<CheckpointData | null>(null);
  const [slaData, setSlaData] = useState<any[] | null>(null);
  const [queueData, setQueueData] = useState<any[] | null>(null);
  const [escalationData, setEscalationData] = useState<any[] | null>(null);
  const [qaData, setQaData] = useState<QaData | null>(null);
  const [qaAgent, setQaAgent] = useState('all');

  const daysFromRange = (r: DateRange) => {
    switch (r) {
      case '4w': return 28;
      case '8w': return 56;
      case '12w': return 84;
      default: return 90;
    }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const days = daysFromRange(dateRange);
    const qs = `days=${days}&granularity=${granularity}&env=${env}`;

    try {
      const [cpRes, slaRes, qRes, escRes, qaRes] = await Promise.all([
        fetch(`/api/trends/checkpoint?env=${env}`),
        fetch(`/api/trends/sla?${qs}`),
        fetch(`/api/trends/queue?${qs}`),
        fetch(`/api/trends/escalation?${qs}`),
        fetch(`/api/trends/qa?${qs}&agent=${qaAgent}`),
      ]);

      const [cp, sla, q, esc, qa] = await Promise.all([cpRes.json(), slaRes.json(), qRes.json(), escRes.json(), qaRes.json()]);

      if (cp.ok) setCheckpointData(cp.data);
      if (sla.ok) setSlaData(sla.data);
      if (q.ok) setQueueData(q.data);
      if (esc.ok) setEscalationData(esc.data);
      if (qa.ok) setQaData(qa.data);
    } catch (err) {
      console.error('Trends fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, granularity, env, qaAgent]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refetch QA only when agent changes
  const fetchQa = useCallback(async (agent: string) => {
    const days = daysFromRange(dateRange);
    try {
      const res = await fetch(`/api/trends/qa?days=${days}&granularity=${granularity}&env=${env}&agent=${agent}`);
      const json = await res.json();
      if (json.ok) setQaData(json.data);
    } catch (err) { console.error('QA fetch error:', err); }
  }, [dateRange, granularity, env]);

  const handleAgentChange = useCallback((a: string) => {
    setQaAgent(a);
    fetchQa(a);
  }, [fetchQa]);

  const ctl = (label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded-md border transition-colors"
      style={{
        borderColor: active ? C.teal : C.border,
        color: active ? C.teal : C.text3,
        background: active ? `${C.teal}10` : 'transparent',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Header + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold" style={{ color: C.text1 }}>Trends</h1>
          <p className="text-xs mt-1" style={{ color: C.text3 }}>90-day performance framework &bull; Day 1 baseline: 16 Mar 2026</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ctl('4 Weeks', dateRange === '4w', () => setDateRange('4w'))}
          {ctl('8 Weeks', dateRange === '8w', () => setDateRange('8w'))}
          {ctl('12 Weeks', dateRange === '12w', () => setDateRange('12w'))}
          <span className="mx-1 w-px h-5" style={{ background: C.border }} />
          {ctl('Daily', granularity === 'daily', () => setGranularity('daily'))}
          {ctl('Weekly', granularity === 'weekly', () => setGranularity('weekly'))}
          <span className="mx-1 w-px h-5" style={{ background: C.border }} />
          {ctl('Live', env === 'live', () => setEnv('live'))}
          {ctl('UAT', env === 'uat', () => setEnv('uat'))}
        </div>
      </div>

      {loading && (
        <div className="text-center py-12">
          <div className="inline-block w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: `${C.teal} transparent ${C.teal} transparent` }} />
          <p className="text-xs mt-2" style={{ color: C.text3 }}>Loading trends data...</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Section 5: Checkpoint Evidence Panel */}
          <CheckpointPanel data={checkpointData} />

          {/* Section 1: SLA Compliance */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: C.text1 }}>SLA Compliance</h2>
            <SlaSection data={slaData} />
          </div>

          {/* Section 2: Queue Health */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: C.text1 }}>Queue Health</h2>
            <QueueSection data={queueData} />
          </div>

          {/* Section 4: Escalation & Resolution */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: C.text1 }}>Escalation & Resolution</h2>
            <EscalationSection data={escalationData} />
          </div>

          {/* Section 3: QA & Golden Rules */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: C.text1 }}>QA & Golden Rules</h2>
            <QaSection data={qaData} agent={qaAgent} onAgentChange={handleAgentChange} />
          </div>
        </>
      )}
    </div>
  );
}
