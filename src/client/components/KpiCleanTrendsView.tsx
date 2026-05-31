/**
 * Clean-Sheet KPI — Trends Parity (KPX-WP7)
 *
 * A clean-sheet, per-space multi-day trend surface sourced ENTIRELY from the
 * clean-sheet read model (GET /api/kpi/spaces + GET /api/kpi/trends/:spaceKey).
 * It goes beyond the thin fixed 7-day sparkline the Team / QA / Escalations grids
 * carry: a configurable window (7 / 14 / 30 / 90 days), a proper line chart per
 * metric with a target reference line, and a direction-aware delta / movement
 * summary.
 *
 * Honesty rules (match the rest of the clean-sheet platform):
 *   - Only metrics with ≥2 real frozen daily points are drawn a trend ("supported").
 *   - Wired metrics without enough history are listed as "awaiting history" with NO line.
 *   - Structurally unwired metrics are listed as "not wired" with NO line.
 *   - A missing / single-point series is never extended, flattened, or back-filled.
 * Parallel to — and isolated from — the legacy Trends view.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
type TrendStatus = 'supported' | 'awaiting' | 'unsupported';
interface TrendPoint { date: string; value: number; }
interface TrendStats {
  points: number; first: number; last: number; min: number; max: number;
  deltaAbs: number; deltaPct: number | null; improving: boolean | null;
}
interface TrendMetric {
  metricKey: string; displayName: string; category: string; valueType: string; direction: string;
  source: string; value: number | null; target: number | null; rag: Rag; asOf: string | null;
  valueSource: string | null; unwired?: boolean;
  history: TrendPoint[]; trendStatus: TrendStatus; stats: TrendStats | null; trendNote: string | null;
}
interface TrendsSpace {
  spaceKey: string; displayName: string; ownerName: string | null; timezone: string;
  isJiraSpace: boolean; windowDays: number; hasData: boolean; note: string | null;
  supported: TrendMetric[]; unsupported: TrendMetric[];
}
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }

const WINDOWS = [7, 14, 30, 90];

const ragColor = (rag: Rag) => rag === 'green' ? C.green : rag === 'amber' ? C.amber : rag === 'red' ? C.red : C.text3;

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

/**
 * Multi-day trend chart — deliberately larger than the 80×22 sparkline: a real
 * line over the window, with a dashed target reference line when the target sits
 * within (or near) the value range, and min/max anchoring. No fabrication: it only
 * ever plots the real points it is given (caller guarantees ≥2).
 */
function TrendChart({ points, target }: { points: TrendPoint[]; target: number | null }) {
  const w = 360, h = 96, padX = 4, padY = 10;
  const values = points.map(p => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  // Include the target in the vertical range so the reference line is visible.
  if (target !== null && Number.isFinite(target)) { min = Math.min(min, target); max = Math.max(max, target); }
  const range = max - min || 1;
  const x = (i: number) => padX + (i / (points.length - 1)) * (w - 2 * padX);
  const y = (v: number) => padY + (1 - (v - min) / range) * (h - 2 * padY);
  const linePts = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const areaPts = `${x(0)},${h - padY} ${linePts} ${x(points.length - 1)},${h - padY}`;
  const targetY = target !== null && Number.isFinite(target) ? y(target) : null;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', maxWidth: w }}>
      <polygon points={areaPts} fill="rgba(94,193,202,0.08)" stroke="none" />
      {targetY !== null && (
        <line x1={padX} y1={targetY} x2={w - padX} y2={targetY} stroke={C.text3} strokeWidth={1} strokeDasharray="4 3" />
      )}
      <polyline points={linePts} fill="none" stroke={C.teal} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3 : 1.6} fill={C.teal} />)}
    </svg>
  );
}

function DeltaBadge({ stats, valueType }: { stats: TrendStats; valueType: string }) {
  const { improving, deltaAbs, deltaPct } = stats;
  const flat = deltaAbs === 0;
  const color = flat ? C.text3 : improving === true ? C.green : improving === false ? C.red : C.text2;
  const arrow = flat ? '→' : deltaAbs > 0 ? '▲' : '▼';
  const pct = deltaPct === null ? '' : ` (${deltaPct > 0 ? '+' : ''}${deltaPct}%)`;
  return (
    <span style={{ color, fontWeight: 700, fontSize: 12 }} title="Change from first to latest point in window">
      {arrow} {fmtValue(valueType, Math.abs(deltaAbs))}{pct}
    </span>
  );
}

export function KpiCleanTrendsView() {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>('');
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<TrendsSpace | null>(null);
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
      const r = await fetch(`/api/kpi/trends/${encodeURIComponent(key)}?days=${d}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load trends');
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

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Trends</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · multi-day metric history</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} style={selectStyle}>
            {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey}){s.isJiraSpace ? '' : ' — manual'}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle} title="Trend window">
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
            {data.ownerName ? `Owner: ${data.ownerName} · ` : ''}{data.timezone} · {data.isJiraSpace ? 'Jira-computed' : 'Manual / non-Jira'} · window: last {data.windowDays} days
          </div>

          {/* Supported trends */}
          {data.supported.length === 0 ? (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14, marginBottom: 18 }}>
              {data.note ?? 'No metric has enough multi-day history to trend in this window yet.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14, marginBottom: 22 }}>
              {data.supported.map((m) => (
                <div key={m.metricKey} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>
                      {m.displayName}
                      <span style={{ color: C.text3, fontWeight: 400, fontSize: 11 }}> · {m.category}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: ragColor(m.rag) }}>{fmtValue(m.valueType, m.value)}</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8, fontSize: 11, color: C.text3 }}>
                    {m.stats && <DeltaBadge stats={m.stats} valueType={m.valueType} />}
                    <span>
                      {m.target !== null ? `target ${fmtValue(m.valueType, m.target)} · ` : ''}{m.stats?.points ?? 0} pts
                    </span>
                  </div>
                  <TrendChart points={m.history} target={m.target} />
                  {m.stats && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.text3, marginTop: 6 }}>
                      <span>{m.history[0]?.date} → {m.history[m.history.length - 1]?.date}</span>
                      <span>min {fmtValue(m.valueType, m.stats.min)} · max {fmtValue(m.valueType, m.stats.max)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Honestly unsupported metrics — awaiting history or not wired. No line drawn. */}
          {data.unsupported.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 8 }}>
                Not yet trendable
                <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}> · honestly excluded — no fabricated history</span>
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
                          <span style={{ color: m.trendStatus === 'unsupported' ? C.text3 : C.amber, fontWeight: 600, fontSize: 11, fontStyle: 'italic' }}>
                            {m.trendStatus === 'unsupported' ? 'not wired' : 'awaiting history'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', color: C.text2, fontSize: 12 }}>{m.trendNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
            Source: clean-sheet <code>kpi_daily</code> frozen history (NOVA), space-level rows only, over the selected window. A metric is trended only with ≥2 real frozen days; otherwise it is listed honestly as awaiting history or not wired — never drawn a fabricated line. Isolated from, and parallel to, the legacy Trends view.
          </div>
        </>
      )}
    </div>
  );
}
