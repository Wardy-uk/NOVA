/**
 * Clean-Sheet KPI — Escalations Parity (KPX-WP6)
 *
 * Focused parity surface for the now-wired escalation metric family —
 * `escalation_rate`, `escalation_accuracy` and `rejection_rate` ONLY — sourced
 * entirely from the clean-sheet read model (GET /api/kpi/escalations-parity).
 * For each space carrying the family it shows the space-level current value /
 * target / RAG, a 7-day sparkline, and the per-agent breakdown from the latest
 * frozen kpi_agent_daily rows.
 *
 * Honesty rules (match the rest of the clean-sheet platform):
 *   - Only spaces with the escalation family enabled appear.
 *   - A metric with no captured value renders "—" (value null), never a 0% / 100%.
 *   - `escalation_accuracy` / `rejection_rate` depend on the explicit rejection
 *     (bounce-back) capture path: until a bounce-back is captured they read "—"
 *     (wired, awaiting capture), not a fabricated percentage.
 *   - A space wired-but-empty shows an explicit awaiting-data note.
 * Runs in parallel with the untouched legacy KPI / escalation report views.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
interface EscMetric {
  metricKey: string; displayName: string; category: string; valueType: string; direction: string;
  source: string; value: number | null; target: number | null; rag: Rag; asOf: string | null;
  valueSource: string | null; unwired?: boolean; history: Array<{ date: string; value: number }>;
}
interface EscAgent {
  agentId: string; agentName: string | null; metrics: Record<string, number>;
}
interface EscSpace {
  spaceKey: string; displayName: string; ownerName: string | null; isJiraSpace: boolean;
  hasData: boolean; note: string | null;
  metrics: EscMetric[];
  agentReportDate: string | null;
  agents: EscAgent[];
}
interface EscParity {
  generatedAt: string; escalationMetricKeys: string[]; spaces: EscSpace[];
}

/** Metrics whose value depends on the rejection (bounce-back) capture path. */
const REJECTION_DEPENDENT = new Set(['escalation_accuracy', 'rejection_rate']);

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

/** Minimal inline sparkline (no chart dependency) — same as the QA / Team view. */
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

export function KpiCleanEscalationsView() {
  const [data, setData] = useState<EscParity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/kpi/escalations-parity');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load escalations parity');
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

  /** Honest cell label for a null escalation value (distinguishes awaiting-rejection-capture). */
  const emptyLabel = (m: EscMetric) =>
    REJECTION_DEPENDENT.has(m.metricKey)
      ? <span title="No bounce-back/rejection captured yet — value withheld rather than fabricated" style={{ fontSize: 11, fontStyle: 'italic', color: C.text3 }}>awaiting capture</span>
      : '—';

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Escalations Parity</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · Escalation Rate, Accuracy &amp; Rejection Rate</div>
        </div>
        <button onClick={load} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && data.spaces.length === 0 && (
        <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14 }}>
          No space currently carries the escalation metric family.
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
              {space.note ?? 'No escalation data available for this space.'}
            </div>
          ) : (
            <>
              {/* Space-level escalation metrics */}
              <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      <th style={{ padding: '10px 14px' }}>Escalation Metric</th>
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
                        <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: m.unwired || m.value === null ? C.text3 : ragColor(m.rag) }}>
                          {m.unwired
                            ? <span title="No data source wired yet" style={{ fontWeight: 600, fontSize: 11, fontStyle: 'italic' }}>not wired</span>
                            : m.value === null ? emptyLabel(m) : fmtValue(m.valueType, m.value)}
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

              {/* Per-agent escalation breakdown */}
              {space.isJiraSpace && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 8 }}>
                    Per-Agent Escalations
                    {space.agentReportDate && <span style={{ fontSize: 11, color: C.text3, fontWeight: 400 }}> · {space.agentReportDate}</span>}
                  </div>
                  {space.agents.length === 0 ? (
                    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, color: C.text3, fontSize: 12 }}>
                      No per-agent escalation values captured yet (populated at EOD freeze where agents have escalation-family rows).
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
          Source: clean-sheet <code>kpi_*</code> tables (NOVA), computed from the wired escalation family (<code>escalation_log</code>). A metric reads "—" / "awaiting capture" where no value exists, never a fabricated 0% / 100%. <code>escalation_accuracy</code> and <code>rejection_rate</code> stay withheld until a bounce-back/rejection has been captured. Runs in parallel with the legacy KPI / escalation views.
        </div>
      )}
    </div>
  );
}
