import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Trends for the NEW KPI engine (kpi-org / Layer 1). One call to the support
// history-grid returns every KPI's daily series already grouped by category
// (Volume / Hygiene / SLA / Flow / Manual); we render a multi-line chart per group.
// Endpoint: GET /api/kpi-org/support/history-grid?from=&to=

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const C = {
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669', amber: '#d97706', red: '#ef4444',
  blue: '#3b82f6', pink: '#ec4899', orange: '#f97316', lime: '#84cc16', cyan: '#06b6d4',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
} as const;
const CHART_COLORS = [C.teal, C.purple, C.blue, C.pink, C.orange, C.green, C.amber, C.red, C.lime, C.cyan];

const iso = (d: Date) => d.toLocaleDateString('en-CA');
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

interface Cell { value: number | null; rag: string | null }
interface Row { key: string; label: string; unit: string; direction: string; target: number | null; cells: Record<string, Cell> }
interface Group { name: string; rows: Row[] }

function chartOptions(title: string): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: C.text2, boxWidth: 12, padding: 12, font: { size: 11 } } },
      title: { display: true, text: title, color: C.text1, font: { size: 14, weight: 'bold' }, padding: { bottom: 12 } },
      tooltip: { backgroundColor: '#1e2228', titleColor: C.text1, bodyColor: C.text2, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 },
    },
    scales: {
      x: { ticks: { color: C.text3, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 16 }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: C.text3, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
    },
  };
}

export function KpiRebuildTrends() {
  const [weeks, setWeeks] = useState(8);
  const [dates, setDates] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const to = new Date();
    const from = new Date(); from.setDate(to.getDate() - (weeks * 7 - 1));
    try {
      const r = await fetch(`/api/kpi-org/support/history-grid?from=${iso(from)}&to=${iso(to)}`);
      const j = await r.json();
      if (j.ok) { setDates(j.data.dates); setGroups(j.data.groups); } else setError(j.error || 'Failed to load');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [weeks]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = dates.map(fmtDate);
  const wbtn = (active: boolean) =>
    `px-3 py-1.5 text-sm ${active ? 'bg-blue-600 text-white' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'}`;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Trends <span className="text-sm font-normal text-slate-400">(KPI engine)</span></h1>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {[4, 8, 12].map(w => (
            <button key={w} onClick={() => setWeeks(w)} className={wbtn(weeks === w)}>{w} Weeks</button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && !error && groups.length === 0 && (
        <div className="p-8 text-center text-slate-500 rounded-xl border border-white/10">
          No captured history yet — run a capture or backfill in the new KPI engine first.
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {groups.map(g => {
            const datasets = g.rows.map((row, i) => ({
              label: row.label,
              data: dates.map(d => row.cells[d]?.value ?? null),
              borderColor: CHART_COLORS[i % CHART_COLORS.length],
              backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
              tension: 0.3,
              borderWidth: 2,
              pointRadius: dates.length > 40 ? 0 : 2,
              pointHoverRadius: 4,
              spanGaps: true,
            }));
            return (
              <div key={g.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="h-72">
                  <Line data={{ labels, datasets }} options={chartOptions(g.name)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
