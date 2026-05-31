/**
 * Clean-Sheet KPI — Agent Breaches Parity (KPX-WP8)
 *
 * Focused per-agent breach surface sourced entirely from the clean-sheet read
 * model (GET /api/kpi/agent-breaches), which reads the frozen kpi_agent_daily
 * rows — the SAME clean-sheet path as the Agent Scorecard. For each space that
 * carries a breach-evaluable agent metric it shows, for the latest frozen date,
 * one row per agent with each metric's value + RAG and a derived breach status
 * (breach / at-risk / clear), plus summary counts.
 *
 * Honesty rules (match the rest of the clean-sheet platform):
 *   - Only spaces with a breach-evaluable agent metric appear.
 *   - A breach-evaluable metric is agent-level, computer-backed, target-bearing,
 *     with a RAG-able direction — RAG red = breach, amber = at-risk, green = met.
 *   - A missing per-agent value renders "—" (null), never a fabricated pass/fail.
 *   - A space wired-but-empty shows an explicit awaiting-data note.
 *   - Legacy live-queue breach families the clean-sheet agent path cannot produce
 *     (per-agent open-over-SLA count, not-updated, oldest-ticket age) are listed
 *     as honestly unsupported, never invented.
 * Runs in parallel with the untouched legacy Agent-Breaches board.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
type BreachStatus = 'breach' | 'at_risk' | 'clear' | 'no_data';

interface MetricDef {
  metricKey: string; displayName: string; valueType: string; direction: string;
  target: number | null; amberBand: number | null;
}
interface BreachCell { metricKey: string; value: number | null; rag: Rag; }
interface AgentRow {
  agentId: string; agentName: string | null; status: BreachStatus;
  breachCount: number; atRiskCount: number; cells: BreachCell[];
}
interface UnsupportedFamily { key: string; label: string; reason: string; }
interface BreachSpace {
  spaceKey: string; displayName: string; ownerName: string | null; isJiraSpace: boolean;
  hasData: boolean; note: string | null; reportDate: string | null;
  metricDefs: MetricDef[]; agents: AgentRow[];
  summary: { agentsBreaching: number; agentsAtRisk: number; agentsClear: number; breachesByMetric: Record<string, number> };
}
interface BreachData {
  generatedAt: string; unsupportedFamilies: UnsupportedFamily[]; spaces: BreachSpace[];
}

const ragColor = (rag: Rag) => rag === 'green' ? C.green : rag === 'amber' ? C.amber : rag === 'red' ? C.red : C.text3;
const ragBg = (rag: Rag) => rag === 'green' ? 'rgba(16,185,129,0.08)' : rag === 'amber' ? 'rgba(234,179,8,0.08)' : rag === 'red' ? 'rgba(239,68,68,0.10)' : 'transparent';

const STATUS_META: Record<BreachStatus, { label: string; color: string }> = {
  breach: { label: 'Breach', color: C.red },
  at_risk: { label: 'At risk', color: C.amber },
  clear: { label: 'Clear', color: C.green },
  no_data: { label: 'No data', color: C.text3 },
};

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

export function KpiCleanAgentBreachesView() {
  const [data, setData] = useState<BreachData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breachedOnly, setBreachedOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/kpi/agent-breaches');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load agent breaches');
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
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Agent Breaches</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · per-agent target breaches from frozen agent-daily rows</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: C.text2, cursor: 'pointer' }}>
            <input type="checkbox" checked={breachedOnly} onChange={(e) => setBreachedOnly(e.target.checked)} />
            Breaching only
          </label>
          <button onClick={load} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && data.spaces.length === 0 && (
        <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14 }}>
          No space currently carries a breach-evaluable agent metric (agent-level, computer-backed, target-bearing).
        </div>
      )}

      {!loading && data && data.spaces.map((space) => {
        const rows = breachedOnly ? space.agents.filter((a) => a.status === 'breach') : space.agents;
        return (
          <div key={space.spaceKey} style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text1, marginBottom: 2 }}>
              {space.displayName} <span style={{ color: C.text3, fontWeight: 400, fontSize: 12 }}>({space.spaceKey})</span>
            </div>
            <div style={{ fontSize: 12, color: C.text3, marginBottom: 10 }}>
              {space.ownerName ? `Owner: ${space.ownerName} · ` : ''}{space.isJiraSpace ? 'Jira-computed' : 'Manual / non-Jira'}
              {space.reportDate && <span> · {space.reportDate}</span>}
            </div>

            {!space.hasData ? (
              <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, color: C.text2, fontSize: 13 }}>
                {space.note ?? 'No agent breach data available for this space.'}
              </div>
            ) : (
              <>
                {/* Summary chips */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  {[
                    { label: 'Agents breaching', value: space.summary.agentsBreaching, color: space.summary.agentsBreaching === 0 ? C.green : C.red },
                    { label: 'At risk', value: space.summary.agentsAtRisk, color: space.summary.agentsAtRisk === 0 ? C.green : C.amber },
                    { label: 'Clear', value: space.summary.agentsClear, color: C.green },
                    { label: 'Agents assessed', value: space.agents.length, color: C.text2 },
                  ].map((s) => (
                    <div key={s.label} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 14px', minWidth: 110 }}>
                      <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Per-agent breach matrix */}
                <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        <th style={{ padding: '10px 14px' }}>Agent</th>
                        <th style={{ padding: '10px 14px' }}>Status</th>
                        {space.metricDefs.map((m) => (
                          <th key={m.metricKey} style={{ padding: '10px 14px', textAlign: 'right' }}>
                            {m.displayName}
                            {m.target !== null && <div style={{ fontSize: 9, color: C.text3, fontWeight: 400, textTransform: 'none' }}>target {fmtValue(m.valueType, m.target)}</div>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr><td colSpan={2 + space.metricDefs.length} style={{ padding: 18, textAlign: 'center', color: C.text3 }}>
                          {breachedOnly ? 'No agents currently breaching — all assessed agents are within target.' : 'No agents to display.'}
                        </td></tr>
                      )}
                      {rows.map((a) => {
                        const sm = STATUS_META[a.status];
                        const cellByKey = new Map(a.cells.map((c) => [c.metricKey, c]));
                        return (
                          <tr key={a.agentId} style={{ borderTop: `1px solid ${C.border}`, background: a.status === 'breach' ? 'rgba(239,68,68,0.04)' : undefined }}>
                            <td style={{ padding: '9px 14px', color: C.text1, fontWeight: 600 }}>{a.agentName ?? a.agentId}</td>
                            <td style={{ padding: '9px 14px' }}>
                              <span style={{ color: sm.color, fontWeight: 700, fontSize: 12 }}>{sm.label}</span>
                              {a.status === 'breach' && a.breachCount > 1 && <span style={{ color: C.text3, fontSize: 11 }}> ·{a.breachCount}</span>}
                            </td>
                            {space.metricDefs.map((m) => {
                              const c = cellByKey.get(m.metricKey);
                              const v = c?.value ?? null;
                              const rag = c?.rag ?? null;
                              return (
                                <td key={m.metricKey} style={{ padding: '9px 14px', textAlign: 'right', background: ragBg(rag) }}>
                                  <span style={{ color: v === null ? C.text3 : ragColor(rag), fontWeight: v === null ? 400 : 700 }}>
                                    {fmtValue(m.valueType, v)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Honestly unsupported legacy breach families */}
      {!loading && data && data.unsupportedFamilies.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 8 }}>Not supported by the clean-sheet agent path</div>
          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  <th style={{ padding: '10px 14px', width: '32%' }}>Legacy breach family</th>
                  <th style={{ padding: '10px 14px' }}>Why it is honestly withheld</th>
                </tr>
              </thead>
              <tbody>
                {data.unsupportedFamilies.map((f) => (
                  <tr key={f.key} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '9px 14px', color: C.text2, fontWeight: 600 }}>{f.label}</td>
                    <td style={{ padding: '9px 14px', color: C.text3, fontSize: 12 }}>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && data && (
        <div style={{ marginTop: 8, fontSize: 10, color: C.text3 }}>
          Source: clean-sheet <code>kpi_agent_daily</code> (NOVA), the same frozen per-agent rows as the Agent Scorecard. A breach is a per-agent metric whose RAG is red against its target; "—" is rendered where no per-agent value exists, never a fabricated pass/fail. Per-agent live-queue families (open over-SLA, not-updated, oldest-ticket) are not captured by the clean-sheet agent path and are listed as unsupported above. Runs in parallel with the legacy Agent-Breaches board.
        </div>
      )}
    </div>
  );
}
