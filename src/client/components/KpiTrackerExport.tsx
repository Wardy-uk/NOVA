import { useEffect, useMemo, useState } from 'react';

// Daily KPI Tracker export — renders the Support KPIs in the exact row order of Nick's
// spreadsheet (rows 07–40), weekday columns for the selected month, so the number block
// can be copied straight into the sheet. Rows 17 / 39 / 40 come back blank by design.
// Data: /api/kpi-org/support/tracker-export?from&to (today's column is live-overlaid).

interface ExportRow { label: string; values: (number | null)[] }
interface ExportData { dates: string[]; rows: ExportRow[] }

const ddmm = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const cell = (v: number | null) => (v == null ? '' : String(v));

/** Current UK month as YYYY-MM. */
function currentMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }).slice(0, 7);
}

export function KpiTrackerExport() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // from = 1st of month; to = last day of month, capped at today for the current month.
  const { from, to } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const todayUk = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
    return { from: first, to: monthEnd < todayUk ? monthEnd : (todayUk.slice(0, 7) === month ? todayUk : monthEnd) };
  }, [month]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/kpi-org/support/tracker-export?from=${from}&to=${to}`);
      const j = await r.json();
      if (j.ok) setData(j.data); else setError(j.error);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  function copy(withLabels: boolean) {
    if (!data) return;
    const tsv = data.rows
      .map(row => {
        const nums = row.values.map(cell).join('\t');
        return withLabels ? `${row.label}\t${nums}` : nums;
      })
      .join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(withLabels ? 'labels' : 'numbers');
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => setError('Clipboard copy failed — select the table and copy manually.'));
  }

  const th = 'px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-center font-medium whitespace-nowrap';
  const btn = 'px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40';

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 className="text-2xl font-bold">Tracker Export <span className="text-sm font-normal text-slate-400">(Daily KPI Tracker format)</span></h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-2 py-1 text-sm rounded bg-black/30 border border-white/10" />
          <button onClick={() => copy(false)} disabled={!data} className={btn}>{copied === 'numbers' ? 'Copied ✓' : 'Copy numbers'}</button>
          <button onClick={() => copy(true)} disabled={!data} className="px-3 py-1.5 text-sm rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 disabled:opacity-40">{copied === 'labels' ? 'Copied ✓' : 'Copy + labels'}</button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Weekday columns only, exact spreadsheet row order. <b>Copy numbers</b> puts just the value grid (tab-separated) on your clipboard —
        click the first date cell for this month in the sheet and paste. Rows 17 / 39 / 40 (TPJ-in-Dev, Failed Jobs, CI) are intentionally blank. Today's column is live.
      </p>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-slate-400">Loading…</div>}

      {!loading && data && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="border-collapse text-sm">
            <thead className="bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 text-left sticky left-0 bg-[#1c2128] z-10">KPI</th>
                {data.dates.map(d => <th key={d} className={th}>{ddmm(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-1.5 sticky left-0 bg-[#1a1f26] whitespace-nowrap text-slate-300">{row.label}</td>
                  {row.values.map((v, j) => (
                    <td key={j} className="px-3 py-1.5 text-center tabular-nums text-slate-200">{cell(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
