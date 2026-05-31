/**
 * Clean-Sheet KPI — QA Parity (KPX-WP4)
 *
 * Focused parity surface for the now-wired QA metric family — `qa_score_avg`
 * and `golden_rules_avg` ONLY — sourced entirely from the clean-sheet read model
 * (GET /api/kpi/qa-parity). For each space carrying the family it shows the
 * space-level current value / target / RAG, a 7-day sparkline, and the per-agent
 * breakdown from the latest frozen kpi_agent_daily rows.
 *
 * Honesty rules (match the rest of the clean-sheet platform):
 *   - Only spaces with the QA family enabled appear.
 *   - A QA metric with no upstream rows renders "—" (value null), never a 0.
 *   - A space wired-but-empty shows an explicit awaiting-data note.
 * Parallel to the untouched legacy QA view.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
interface QaMetric {
  metricKey: string; displayName: string; category: string; valueType: string; direction: string;
  source: string; value: number | null; target: number | null; rag: Rag; asOf: string | null;
  valueSource: string | null; unwired?: boolean; history: Array<{ date: string; value: number }>;
}
interface QaAgent {
  agentId: string; agentName: string | null; metrics: Record<string, number>;
}
interface QaSpace {
  spaceKey: string; displayName: string; ownerName: string | null; isJiraSpace: boolean;
  hasData: boolean; note: string | null;
  metrics: QaMetric[];
  agentReportDate: string | null;
  agents: QaAgent[];
}
interface QaParity {
  generatedAt: string; qaMetricKeys: string[]; spaces: QaSpace[];
}

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

/** Minimal inline sparkline (no chart dependency) — same as the Team view. */
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

export function KpiCleanQaView() {
  const [data, setData] = useState<QaParity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/kpi/qa-parity');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load QA parity');
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>QA Parity</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · QA Score &amp; Golden Rules</div>
        </div>
        <button onClick={load} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && data.spaces.length === 0 && (
        <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14 }}>
          No space currently carries the QA metric family.
        </div>
      )}

      {!loading && data && data.spaces.map((space) => (
        <div key={space.spaceKey} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text1, marginBottom: 2 }}>
            {space.displayName} <span style={{ color: C.text3, fontWeight: 400, fontSize: 12 }}>({space.spaceKey})</span>
          </div>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 10 }}>
            {space.ownerName ? `Owner: ${space.ownerName} · ` : ''}{space.isJiraSpace ? 'Jira-computed' : 'Manual / non-Jira'}
          </div>

          {!space.hasData ? (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, color: C.text2, fontSize: 13 }}>
              {space.note ?? 'No QA data available for this space.'}
            </div>
          ) : (
            <>
              {/* Space-level QA metrics */}
              <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      <th style={{ padding: '10px 14px' }}>QA Metric</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Current</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Target</th>
                      <th style={{ padding: '10px 14px' }}>RAG</th>
                      <th style={{ padding: '10px 14px' }}>7-day</th>
                      <th style={{ padding: '10px 14px' }}>As of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {space.metrics.map((m) => (
                      <tr key={m.metricKey} style={{ borderTop: `1px solid ${C.border}`, background: ragBg(m.rag) }}>
                        <td style={{ padding: '9px 14px', color: C.text1 }}>{m.displayName}</td>
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

              {/* Per-agent QA breakdown */}
              {space.isJiraSpace && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 8 }}>
                    Per-Agent QA
                    {space.agentReportDate && <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}> · {space.agentReportDate}</span>}
                  </div>
                  {space.agents.length === 0 ? (
                    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, color: C.text3, fontSize: 12 }}>
                      No per-agent QA scores captured yet (populated at EOD freeze where agents have scored tickets).
                    </div>
                  ) : (
                    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            <th style={{ padding: '10px 14px' }}>Agent</th>
                            {space.metrics.map((m) => (
                              <th key={m.metricKey} style={{ padding: '10px 14px', textAlign: 'right' }}>{m.displayName}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {space.agents.map((a) => (
                            <tr key={a.agentId} style={{ borderTop: `1px solid ${C.border}` }}>
                              <td style={{ padding: '9px 14px', color: C.text1 }}>{a.agentName ?? a.agentId}</td>
                              {space.metrics.map((m) => {
                                const v = a.metrics[m.metricKey];
                                return (
                                  <td key={m.metricKey} style={{ padding: '9px 14px', textAlign: 'right', color: v === undefined ? C.text3 : C.text1, fontWeight: v === undefined ? 400 : 600 }}>
                                    {v === undefined ? '—' : fmtValue(m.valueType, v)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {!loading && data && (
        <div style={{ marginTop: 8, fontSize: 10, color: C.text3 }}>
          Source: clean-sheet <code>kpi_*</code> tables (NOVA). QA values are computed from the wired QA / Golden Rules source families; a metric reads "—" where no scores exist, never a fabricated 0. Runs in parallel with the legacy QA view.
        </div>
      )}
    </div>
  );
}
