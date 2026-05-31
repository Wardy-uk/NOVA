/**
 * Clean-Sheet KPI — Team Dashboard (per space) (P3-WP1)
 *
 * Full enabled-metric grid for a single space from the NEW clean-sheet KPI data
 * source (GET /api/kpi/spaces + GET /api/kpi/team/:spaceKey). Shows current
 * value / target / RAG, a 7-day sparkline, the per-tier breakdown (NT) and the
 * most recent frozen EOD ticket-state snapshot. Sparse / manual spaces render
 * honestly. Parallel to the untouched legacy team KPI views.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
interface TeamMetric {
  metricKey: string; displayName: string; category: string; valueType: string; direction: string;
  source: string; value: number | null; target: number | null; rag: Rag; asOf: string | null;
  valueSource: string | null; unwired?: boolean; history: Array<{ date: string; value: number }>;
}
interface TeamDashboard {
  spaceKey: string; displayName: string; ownerName: string | null; timezone: string;
  isJiraSpace: boolean; hasTiers: boolean; hasData: boolean; note: string | null; generatedAt: string;
  metrics: TeamMetric[];
  tiers: Array<{ tierName: string; metrics: Array<{ metricKey: string; value: number | null; asOf: string | null }> }>;
  eodSnapshot: {
    date: string | null; snapshotTime: string | null; totalTickets: number; overSla: number;
    groups: Array<{ tierName: string | null; status: string | null; requestType: string | null; ticketCount: number; overSlaCount: number }>;
  } | null;
}
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }

const ragColor = (rag: Rag) => rag === 'green' ? C.green : rag === 'amber' ? C.amber : rag === 'red' ? C.red : C.text3;
const ragBg = (rag: Rag) => rag === 'green' ? 'rgba(16,185,129,0.08)' : rag === 'amber' ? 'rgba(234,179,8,0.08)' : rag === 'red' ? 'rgba(239,68,68,0.08)' : 'transparent';

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

/** Minimal inline sparkline (no chart dependency). */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span style={{ color: C.text3, fontSize: 10 }}>{points.length === 1 ? '·' : ''}</span>;
  const w = 80, h = 22, min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={coords} fill="none" stroke={C.teal} strokeWidth={1.5} />
    </svg>
  );
}

export function KpiCleanTeamView() {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>('');
  const [data, setData] = useState<TeamDashboard | null>(null);
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
          // Default to first Jira space (data most likely present), else first.
          const def = list.find(s => s.isJiraSpace) ?? list[0];
          if (def) setSpaceKey(def.spaceKey);
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = useCallback(async (key: string) => {
    if (!key) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/kpi/team/${encodeURIComponent(key)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load team dashboard');
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (spaceKey) load(spaceKey); }, [spaceKey, load]);

  const SpaceSelector = (
    <select
      value={spaceKey}
      onChange={(e) => setSpaceKey(e.target.value)}
      style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
    >
      {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey}){s.isJiraSpace ? '' : ' — manual'}</option>)}
    </select>
  );

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Team Dashboard</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · per-space metric grid</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {SpaceSelector}
          <button onClick={() => load(spaceKey)} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && (
        <>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 14 }}>
            {data.ownerName ? `Owner: ${data.ownerName} · ` : ''}{data.timezone} · {data.isJiraSpace ? 'Jira-computed' : 'Manual / non-Jira'}
          </div>

          {!data.hasData ? (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14 }}>
              {data.note ?? 'No data available for this space.'}
            </div>
          ) : (
            <>
              {/* Metric grid */}
              <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      <th style={{ padding: '10px 14px' }}>Metric</th>
                      <th style={{ padding: '10px 14px' }}>Category</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Current</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Target</th>
                      <th style={{ padding: '10px 14px' }}>RAG</th>
                      <th style={{ padding: '10px 14px' }}>7-day</th>
                      <th style={{ padding: '10px 14px' }}>As of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.metrics.map((m) => (
                      <tr key={m.metricKey} style={{ borderTop: `1px solid ${C.border}`, background: ragBg(m.rag) }}>
                        <td style={{ padding: '9px 14px', color: C.text1 }}>{m.displayName}{m.source === 'manual' && <span style={{ color: C.text3, fontSize: 10 }}> · manual</span>}</td>
                        <td style={{ padding: '9px 14px', color: C.text3 }}>{m.category}</td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: m.unwired ? C.text3 : ragColor(m.rag) }}>
                          {m.unwired ? <span title="No data source wired yet" style={{ fontWeight: 600, fontSize: 11, fontStyle: 'italic' }}>not wired</span> : fmtValue(m.valueType, m.value)}
                        </td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', color: C.text2 }}>{m.target !== null ? fmtValue(m.valueType, m.target) : '—'}</td>
                        <td style={{ padding: '9px 14px' }}>
                          {m.rag ? <span style={{ color: ragColor(m.rag), fontWeight: 600, textTransform: 'capitalize' }}>{m.rag}</span> : <span style={{ color: C.text3 }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 14px' }}><Sparkline points={m.history.map(h => h.value)} /></td>
                        <td style={{ padding: '9px 14px', color: C.text3, fontSize: 11 }}>{m.asOf ? (m.valueSource === 'snapshot' ? new Date(m.asOf).toLocaleTimeString('en-GB') : m.asOf) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tier breakdown (NT) */}
              {data.hasTiers && data.tiers.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 8 }}>Tier Breakdown</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {data.tiers.map((t) => (
                      <div key={t.tierName} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', minWidth: 200 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 8 }}>{t.tierName}</div>
                        {t.metrics.length === 0 && <div style={{ fontSize: 11, color: C.text3 }}>No tier values captured.</div>}
                        {t.metrics.map((tm) => (
                          <div key={tm.metricKey} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.text2, padding: '3px 0' }}>
                            <span>{tm.metricKey}</span>
                            <span style={{ color: C.text1, fontWeight: 600 }}>{Math.round(tm.value !== null ? tm.value * 10 : 0) / 10}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* EOD snapshot */}
              {data.eodSnapshot && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 8 }}>
                    EOD Ticket-State Snapshot
                    <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}> · {data.eodSnapshot.date} @ {data.eodSnapshot.snapshotTime} · {data.eodSnapshot.totalTickets} open, {data.eodSnapshot.overSla} over SLA</span>
                  </div>
                  <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: C.text3, textAlign: 'left', fontSize: 10, textTransform: 'uppercase' }}>
                          {data.hasTiers && <th style={{ padding: '8px 14px' }}>Tier</th>}
                          <th style={{ padding: '8px 14px' }}>Status</th>
                          <th style={{ padding: '8px 14px' }}>Request Type</th>
                          <th style={{ padding: '8px 14px', textAlign: 'right' }}>Tickets</th>
                          <th style={{ padding: '8px 14px', textAlign: 'right' }}>Over SLA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.eodSnapshot.groups.map((g, i) => (
                          <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                            {data.hasTiers && <td style={{ padding: '7px 14px', color: C.text2 }}>{g.tierName ?? '—'}</td>}
                            <td style={{ padding: '7px 14px', color: C.text2 }}>{g.status ?? '—'}</td>
                            <td style={{ padding: '7px 14px', color: C.text3 }}>{g.requestType ?? '—'}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', color: C.text1 }}>{g.ticketCount}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', color: g.overSlaCount > 0 ? C.red : C.text3 }}>{g.overSlaCount}</td>
                          </tr>
                        ))}
                        {data.eodSnapshot.groups.length === 0 && (
                          <tr><td colSpan={5} style={{ padding: 14, color: C.text3 }}>No open tickets at last EOD capture.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
            Source: clean-sheet <code>kpi_*</code> tables (NOVA). Current value prefers the latest live snapshot, falling back to the most recent frozen daily value. Runs in parallel with the legacy KPI views.
          </div>
        </>
      )}
    </div>
  );
}
