import { useEffect, useState } from 'react';

// Layer-1 org KPI scorecard for the Support (NT) team. Reads the rebuilt
// /api/kpi-org/support/latest feed (kpi_org_daily). Jira KPIs are captured at
// 18:00; the two manual KPIs (Failed Jobs, CI) are entered here.

interface KpiRow {
  key: string;
  label: string;
  colA: string | null;
  unit: string;
  direction: string;
  rollup: string;
  manual: boolean;
  note: string | null;
  date: string | null;
  value: number | null;
  target: number | null;
  rag: string | null;
  source: string | null;
  capturedAt: string | null;
}

const RAG_COLOR: Record<string, string> = { green: '#10b981', amber: '#eab308', red: '#ef4444' };

function fmt(value: number | null, unit: string): string {
  if (value == null) return '—';
  if (unit === 'days') return `${value}d`;
  if (unit === 'percent') return `${value}%`;
  if (unit === 'currency') return `£${value.toLocaleString('en-GB')}`;
  return String(value);
}

type ViewPeriod = 'live' | 'week' | 'month';

export function SupportKpiScorecard() {
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<ViewPeriod>('live');

  async function load() {
    setLoading(true);
    try {
      if (period === 'live') {
        const r = await fetch('/api/kpi-org/support/latest');
        const j = await r.json();
        if (j.ok) { setRows(j.data); setError(null); } else setError(j.error ?? 'Failed to load');
      } else {
        const r = await fetch(`/api/kpi-org/support/period?period=${period}`);
        const j = await r.json();
        if (j.ok) {
          const d = j.data;
          setRows((d.kpis as Array<{ key: string; label: string; colA: string; unit: string; rollup: string; value: number | null; target: number | null; rag: string | null; days: number }>).map(k => ({
            key: k.key, label: k.label, colA: k.colA, unit: k.unit, direction: '', rollup: k.rollup,
            manual: false, note: `${k.days} day(s) · ${k.rollup}`, date: `${d.from} → ${d.to}`,
            value: k.value, target: k.target, rag: k.rag, source: period, capturedAt: null,
          })));
          setError(null);
        } else setError(j.error ?? 'Failed to load');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runCapture() {
    setBusy(true);
    try {
      const r = await fetch('/api/kpi-org/capture', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) setError(j.error ?? 'Capture failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveManual(key: string, value: number) {
    const day = new Date().toLocaleDateString('en-CA');
    await fetch('/api/kpi-org/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kpiKey: key, day, value }),
    });
    await load();
  }

  const groups = ['Support', 'Development'];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Support KPIs <span className="text-sm font-normal text-slate-400">(Layer 1 — rebuild)</span></h1>
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
            <button onClick={runCapture} disabled={busy}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
              {busy ? 'Capturing…' : 'Run capture now'}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Jira KPIs freeze at 18:00 daily. Source: NT project · spec in agent_work/ba/org-kpis-spec.md
      </p>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && groups.map(group => {
        const groupRows = rows.filter(r => (r.colA ?? 'Support') === group);
        if (!groupRows.length) return null;
        return (
          <div key={group} className="mb-6">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">{group}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {groupRows.map(row => (
                <div key={row.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col">
                  <div className="text-xs text-slate-400 mb-2 leading-snug min-h-[2.5rem]">{row.label}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold" style={{ color: row.rag ? RAG_COLOR[row.rag] : '#e2e8f0' }}>
                      {fmt(row.value, row.unit)}
                    </span>
                    {row.target != null && <span className="text-xs text-slate-500">/ {fmt(row.target, row.unit)}</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                    {row.manual && <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400">manual</span>}
                    {row.source && !row.manual && <span>{row.source}</span>}
                    {row.date && <span>· {row.date}</span>}
                  </div>
                  {row.manual && (
                    <div className="mt-2 flex gap-1">
                      <input
                        type="number"
                        defaultValue={row.value ?? ''}
                        className="w-20 px-2 py-1 text-sm rounded bg-black/30 border border-white/10"
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveManual(row.key, Number((e.target as HTMLInputElement).value));
                        }}
                      />
                      <span className="text-[10px] text-slate-600 self-center">↵ to save</span>
                    </div>
                  )}
                  {row.note && <div className="mt-2 text-[10px] text-slate-600 leading-snug">{row.note}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
