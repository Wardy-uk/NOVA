/**
 * Clean-Sheet KPI — KPI Data Parity (KPX-WP10)
 *
 * A clean-sheet, raw/grid-style row inspector — the parity replacement for the
 * legacy "KPI Data Explorer". Where the SLT / Team / QA / Trends views summarise
 * into cards and charts, this surface exposes the underlying clean-sheet OUTPUT
 * rows directly, so they can be inspected as stored.
 *
 * Sourced ENTIRELY from the clean-sheet read model:
 *   GET /api/kpi/spaces                          (space filter)
 *   GET /api/kpi/data/:dataset?spaceKey&window   (raw rows for one dataset)
 *
 * Exactly four datasets are exposed — one per real clean-sheet output table
 * (kpi_daily / kpi_agent_daily / kpi_eod_snapshot / kpi_snapshots). Every column
 * is a real column of its table. Honesty: a dataset with no rows in the window
 * shows the server's "not yet frozen / sparse" note, never a placeholder row; the
 * row cap is reported honestly when hit; legacy KPI-Data tabs the clean-sheet path
 * does not store (e.g. the live agent ticket-health roster) are listed as
 * honestly unsupported, never faked. Parallel to — and isolated from — the legacy
 * KPI Data Explorer.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type ColType = 'date' | 'datetime' | 'number' | 'text' | 'rag';
interface Column { key: string; label: string; type: ColType; }
interface DatasetInfo { key: string; label: string; table: string; description: string; windowed: boolean; }
interface UnsupportedFamily { key: string; label: string; reason: string; }
interface KpiDataResult {
  generatedAt: string;
  dataset: string;
  datasetLabel: string;
  table: string;
  spaceKey: string | null;
  windowDays: number | null;
  rowLimit: number;
  columns: Column[];
  rows: Array<Record<string, string | number | null>>;
  rowCount: number;
  truncated: boolean;
  note: string | null;
  datasets: DatasetInfo[];
  unsupportedDatasets: UnsupportedFamily[];
}
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }

const WINDOWS = [1, 7, 14, 30, 90, 180];
const DATASETS: Array<{ key: string; label: string }> = [
  { key: 'daily', label: 'Daily Metrics' },
  { key: 'agent-daily', label: 'Agent Daily' },
  { key: 'eod-snapshot', label: 'EOD Snapshot' },
  { key: 'snapshot', label: 'Live Snapshot' },
];

const ragColor = (rag: string | null) => {
  const s = (rag ?? '').toLowerCase();
  return s === 'green' ? C.green : s === 'amber' ? C.amber : s === 'red' ? C.red : C.text3;
};

/** Raw inspector formatting — show the stored value as-is, only trimming float noise. */
function fmtCell(col: Column, v: string | number | null) {
  if (v === null || v === undefined || v === '') return <span style={{ color: C.text3 }}>—</span>;
  if (col.type === 'rag') {
    return <span style={{ color: ragColor(String(v)), fontWeight: 700, textTransform: 'capitalize' }}>{String(v)}</span>;
  }
  if (col.type === 'datetime') {
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  if (col.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000);
  }
  return String(v);
}

export function KpiCleanDataView() {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>(''); // '' = all spaces
  const [dataset, setDataset] = useState<string>('daily');
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<KpiDataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load space list once (for the optional filter).
  useEffect(() => {
    fetch('/api/kpi/spaces')
      .then(r => r.json())
      .then(j => {
        if (j.ok && Array.isArray(j.data)) {
          setSpaces(j.data.map((s: any) => ({ spaceKey: s.spaceKey, displayName: s.displayName, isJiraSpace: s.isJiraSpace })));
        }
      })
      .catch(() => { /* filter is optional; ignore */ });
  }, []);

  const load = useCallback(async (ds: string, key: string, d: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ window: String(d) });
      if (key) params.set('spaceKey', key);
      const r = await fetch(`/api/kpi/data/${encodeURIComponent(ds)}?${params}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load KPI data');
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(dataset, spaceKey, days); }, [dataset, spaceKey, days, load]);

  const selectStyle = { background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' } as const;
  const activeInfo = data?.datasets?.find(d => d.key === dataset);

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>KPI Data</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · raw row inspector over the frozen / live output tables</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} style={selectStyle} title="Space filter">
            <option value="">All spaces</option>
            {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey}){s.isJiraSpace ? '' : ' — manual'}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle} title="Window">
            {WINDOWS.map(d => <option key={d} value={d}>Last {d} day{d === 1 ? '' : 's'}</option>)}
          </select>
          <button onClick={() => load(dataset, spaceKey, days)} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
        </div>
      </div>

      {/* Dataset switch */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14, flexWrap: 'wrap' }}>
        {DATASETS.map(ds => (
          <button
            key={ds.key}
            onClick={() => setDataset(ds.key)}
            style={{
              background: 'transparent', border: 'none', borderBottom: `2px solid ${dataset === ds.key ? C.teal : 'transparent'}`,
              color: dataset === ds.key ? C.teal : C.text3, padding: '8px 14px', marginBottom: -1,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {ds.label}
          </button>
        ))}
      </div>

      {activeInfo && (
        <div style={{ fontSize: 12, color: C.text3, marginBottom: 12 }}>
          Source: clean-sheet <code>{activeInfo.table}</code> · {activeInfo.description}
        </div>
      )}

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && (
        <>
          <div style={{ fontSize: 12, color: C.text2, marginBottom: 10 }}>
            {data.rowCount} row{data.rowCount === 1 ? '' : 's'}
            {data.spaceKey ? ` · ${data.spaceKey}` : ' · all spaces'}
            {` · last ${data.windowDays} day${data.windowDays === 1 ? '' : 's'}`}
            {data.truncated && <span style={{ color: C.amber }}> · capped at {data.rowLimit} rows (more exist — narrow the window or pick a space)</span>}
          </div>

          {data.rows.length === 0 ? (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14, marginBottom: 18 }}>
              {data.note ?? 'No rows in this window.'}
            </div>
          ) : (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto', maxHeight: '64vh', marginBottom: 22 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: C.text3, textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {data.columns.map((c) => (
                      <th key={c.key} style={{ padding: '9px 12px', position: 'sticky', top: 0, background: C.bg1, whiteSpace: 'nowrap', textAlign: c.type === 'number' ? 'right' : 'left', zIndex: 1 }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      {data.columns.map((c) => (
                        <td key={c.key} style={{ padding: '8px 12px', color: C.text1, whiteSpace: 'nowrap', textAlign: c.type === 'number' ? 'right' : 'left', fontVariantNumeric: 'tabular-nums', fontFamily: c.key === 'metric_key' || c.key === 'agent_id' ? 'monospace' : undefined }}>
                          {fmtCell(c, row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Honestly unsupported legacy KPI-Data tabs — no fabricated dataset. */}
          {data.unsupportedDatasets.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 8 }}>
                Not in the clean-sheet output
                <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}> · legacy KPI-Data tabs with no clean-sheet raw rows — listed, never faked</span>
              </div>
              <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      <th style={{ padding: '10px 14px' }}>Legacy tab</th>
                      <th style={{ padding: '10px 14px' }}>Why no raw rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unsupportedDatasets.map((u) => (
                      <tr key={u.key} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '9px 14px', color: C.text1, whiteSpace: 'nowrap' }}>{u.label}</td>
                        <td style={{ padding: '9px 14px', color: C.text2, fontSize: 12 }}>{u.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
            Source: clean-sheet KPI output tables (NOVA) — <code>kpi_daily</code>, <code>kpi_agent_daily</code>, <code>kpi_eod_snapshot</code>, <code>kpi_snapshots</code>. Every column is a real column of its table; metric display names are joined from <code>kpi_metric_definitions</code>. Rows are the values exactly as frozen / captured — a dataset with nothing frozen in the window shows an honest empty note rather than a placeholder row, and output is window- and row-capped (truncation reported). Isolated from, and parallel to, the legacy KPI Data Explorer.
          </div>
        </>
      )}
    </div>
  );
}
