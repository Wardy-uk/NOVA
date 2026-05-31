/**
 * Clean-Sheet KPI — Daily History Parity (KPX-WP9)
 *
 * A clean-sheet, per-space multi-day historical GRID sourced ENTIRELY from the
 * clean-sheet read model (GET /api/kpi/spaces + GET /api/kpi/daily-history/:spaceKey).
 * Unlike the Trends view (per-metric line charts), this is the classic
 * date × metric table: one column per metric that carries frozen history, one row
 * per frozen report date in the window, each cell the value frozen that day with
 * the RAG stored at freeze time.
 *
 * Honesty rules (match the rest of the clean-sheet platform):
 *   - A column appears only for a metric with ≥1 real frozen daily row in the window.
 *   - A (date, metric) cell with no frozen row renders "—", never a fabricated 0
 *     or carried-forward value.
 *   - Only real frozen report dates appear as rows — missing/skipped days are absent,
 *     never synthesised.
 *   - Enabled metrics with no frozen history are listed separately as honestly
 *     unsupported (awaiting history / not wired), never given a fake column/row.
 * Parallel to — and isolated from — the legacy Daily History view.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
type UnsupportedStatus = 'awaiting' | 'unwired';

interface Column {
  metricKey: string; displayName: string; category: string; valueType: string;
  direction: string; source: string; target: number | null;
}
interface Cell { value: number | null; rag: Rag; }
interface HistoryRow { date: string; cells: Record<string, Cell>; }
interface UnsupportedMetric { metricKey: string; displayName: string; category: string; status: UnsupportedStatus; reason: string; }
interface DailyHistorySpace {
  spaceKey: string; displayName: string; ownerName: string | null; timezone: string;
  isJiraSpace: boolean; windowDays: number; hasData: boolean; note: string | null;
  columns: Column[]; rows: HistoryRow[]; unsupported: UnsupportedMetric[];
}
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }

const WINDOWS = [7, 14, 30, 90, 180];

const ragColor = (rag: Rag) => rag === 'green' ? C.green : rag === 'amber' ? C.amber : rag === 'red' ? C.red : C.text3;
const ragBg = (rag: Rag) => rag === 'green' ? 'rgba(16,185,129,0.08)' : rag === 'amber' ? 'rgba(234,179,8,0.08)' : rag === 'red' ? 'rgba(239,68,68,0.10)' : 'transparent';

function fmtValue(valueType: string, value: number | null): string {
  if (value === null || value === undefined) return '—';
  switch (valueType) {
    case 'percentage': return `${Math.round(value * 10) / 10}%`;
    case 'currency': return `£${Math.round(value).toLocaleString('en-GB')}`;
    case 'duration_minutes': return value >= 60 ? `${Math.round(value / 6) / 10}h` : `${Math.round(value)}m`;
    case 'integer': return String(Math.round(value));
    default: return String(Math.round(value * 10) / 10);
  }
}

export function KpiCleanDailyHistoryView() {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>('');
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<DailyHistorySpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load space list once.
  useEffect(() => {
    fetch('/api/kpi/spaces')
      .then(r => r.json())
      .then(j => {
        if (j.ok && Array.isArray(j.data)) {
          const list: SpaceListItem[] = j.data.map((s: any) => ({ spaceKey: s.spaceKey, displayName: s.displayName, isJiraSpace: s.isJiraSpace }));
          setSpaces(list);
          const def = list.find(s => s.isJiraSpace) ?? list[0];
          if (def) setSpaceKey(def.spaceKey);
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = useCallback(async (key: string, d: number) => {
    if (!key) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/kpi/daily-history/${encodeURIComponent(key)}?window=${d}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load daily history');
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (spaceKey) load(spaceKey, days); }, [spaceKey, days, load]);

  const selectStyle = { background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' } as const;
  const thBase = { padding: '10px 14px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Daily History</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · day-by-day frozen metric record</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} style={selectStyle}>
            {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey}){s.isJiraSpace ? '' : ' — manual'}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle} title="History window">
            {WINDOWS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button onClick={() => load(spaceKey, days)} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && (
        <>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 14 }}>
            {data.ownerName ? `Owner: ${data.ownerName} · ` : ''}{data.timezone} · {data.isJiraSpace ? 'Jira-computed' : 'Manual / non-Jira'} · window: last {data.windowDays} days · {data.rows.length} frozen day{data.rows.length === 1 ? '' : 's'}
          </div>

          {/* The date × metric grid (supported metrics only) */}
          {!data.hasData || data.columns.length === 0 ? (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14, marginBottom: 18 }}>
              {data.note ?? 'No frozen daily history in this window yet.'}
            </div>
          ) : (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto', marginBottom: 22 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    <th style={{ padding: '10px 14px', position: 'sticky', left: 0, background: C.bg1, zIndex: 1 }}>Date</th>
                    {data.columns.map((c) => (
                      <th key={c.metricKey} style={thBase}>
                        {c.displayName}
                        {c.target !== null && <div style={{ fontSize: 9, color: C.text3, fontWeight: 400, textTransform: 'none' }}>target {fmtValue(c.valueType, c.target)}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.date} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '9px 14px', color: C.text1, fontWeight: 600, position: 'sticky', left: 0, background: C.bg1, zIndex: 1 }}>{row.date}</td>
                      {data.columns.map((c) => {
                        const cell = row.cells[c.metricKey];
                        const v = cell?.value ?? null;
                        const rag = cell?.rag ?? null;
                        return (
                          <td key={c.metricKey} style={{ ...thBase, padding: '9px 14px', background: ragBg(rag) }}>
                            <span style={{ color: v === null ? C.text3 : ragColor(rag), fontWeight: v === null ? 400 : 700 }}>
                              {fmtValue(c.valueType, v)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Honestly unsupported metrics — no frozen history. No column/row drawn. */}
          {data.unsupported.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 8 }}>
                No frozen history in this window
                <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}> · honestly excluded — no fabricated rows</span>
              </div>
              <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      <th style={{ padding: '10px 14px' }}>Metric</th>
                      <th style={{ padding: '10px 14px' }}>Category</th>
                      <th style={{ padding: '10px 14px' }}>State</th>
                      <th style={{ padding: '10px 14px' }}>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unsupported.map((m) => (
                      <tr key={m.metricKey} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '9px 14px', color: C.text1 }}>{m.displayName}</td>
                        <td style={{ padding: '9px 14px', color: C.text3 }}>{m.category}</td>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{ color: m.status === 'unwired' ? C.text3 : C.amber, fontWeight: 600, fontSize: 11, fontStyle: 'italic' }}>
                            {m.status === 'unwired' ? 'not wired' : 'awaiting history'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', color: C.text2, fontSize: 12 }}>{m.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
            Source: clean-sheet <code>kpi_daily</code> frozen history (NOVA), space-level rows only, over the selected window. Each cell is the value frozen that day with the RAG stored at freeze time; a (date, metric) with no frozen row renders "—", never a fabricated value, and only real frozen report dates appear as rows. Metrics with no frozen history are listed honestly as awaiting history or not wired — never given a fake column/row. Isolated from, and parallel to, the legacy Daily History view.
          </div>
        </>
      )}
    </div>
  );
}
