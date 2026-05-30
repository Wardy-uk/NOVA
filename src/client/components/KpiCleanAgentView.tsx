/**
 * Clean-Sheet KPI — Agent Scorecard / Leaderboard (P3-WP1)
 *
 * Per-agent breakdown of the agent-level metrics for a space, from the NEW
 * clean-sheet KPI data source (GET /api/kpi/spaces + GET /api/kpi/leaderboard/
 * :spaceKey). Agents are ranked by a composite attainment score vs target.
 * Sparse / manual spaces and dates with no agent data render honestly. Parallel
 * to the untouched legacy agent KPI / leaderboard views.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

interface MetricDef { metricKey: string; displayName: string; valueType: string; direction: string; target: number | null; }
interface LbAgent { agentId: string; agentName: string | null; metrics: Record<string, number>; compositeScore: number | null; rank: number | null; }
interface Leaderboard {
  spaceKey: string; displayName: string; isJiraSpace: boolean; hasData: boolean; note: string | null;
  reportDate: string | null; metricDefs: MetricDef[]; agents: LbAgent[];
}
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }

function fmtValue(valueType: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  switch (valueType) {
    case 'percentage': return `${Math.round(value * 10) / 10}%`;
    case 'currency': return `£${Math.round(value).toLocaleString('en-GB')}`;
    case 'duration_minutes': return value >= 60 ? `${Math.round(value / 6) / 10}h` : `${Math.round(value)}m`;
    case 'integer': return String(Math.round(value));
    default: return String(Math.round(value * 10) / 10);
  }
}
const scoreColor = (s: number | null) => s === null ? C.text3 : s >= 100 ? C.green : s >= 85 ? C.amber : C.red;

export function KpiCleanAgentView() {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>('');
  const [data, setData] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

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

  const load = useCallback(async (key: string) => {
    if (!key) return;
    setLoading(true);
    setSelectedAgent(null);
    try {
      const r = await fetch(`/api/kpi/leaderboard/${encodeURIComponent(key)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load leaderboard');
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

  const agent = data?.agents.find(a => a.agentId === selectedAgent) ?? null;

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Agent Scorecard</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · per-agent leaderboard{data?.reportDate ? ` · ${data.reportDate}` : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
            {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey}){s.isJiraSpace ? '' : ' — manual'}</option>)}
          </select>
          <button onClick={() => load(spaceKey)} style={{ background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && data && (
        <>
          {(!data.hasData) ? (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text2, fontSize: 14 }}>
              {data.note ?? 'No agent-level data available.'}
            </div>
          ) : (
            <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    <th style={{ padding: '10px 14px' }}>#</th>
                    <th style={{ padding: '10px 14px' }}>Agent</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Composite</th>
                    {data.metricDefs.map(md => <th key={md.metricKey} style={{ padding: '10px 14px', textAlign: 'right' }}>{md.displayName}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr
                      key={a.agentId}
                      onClick={() => setSelectedAgent(a.agentId === selectedAgent ? null : a.agentId)}
                      style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer', background: a.agentId === selectedAgent ? 'rgba(94,193,202,0.08)' : 'transparent' }}
                    >
                      <td style={{ padding: '9px 14px', color: C.text3 }}>{a.rank ?? '—'}</td>
                      <td style={{ padding: '9px 14px', color: C.text1, fontWeight: 600 }}>{a.agentName ?? a.agentId}</td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: scoreColor(a.compositeScore) }}>{a.compositeScore === null ? '—' : `${a.compositeScore}%`}</td>
                      {data.metricDefs.map(md => (
                        <td key={md.metricKey} style={{ padding: '9px 14px', textAlign: 'right', color: C.text2 }}>{fmtValue(md.valueType, a.metrics[md.metricKey])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {agent && (
            <div style={{ marginTop: 16, background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text1, marginBottom: 4 }}>{agent.agentName ?? agent.agentId}</div>
              <div style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>Composite attainment: <span style={{ color: scoreColor(agent.compositeScore), fontWeight: 700 }}>{agent.compositeScore === null ? 'n/a' : `${agent.compositeScore}%`}</span> · {data.reportDate}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {data.metricDefs.map(md => (
                  <div key={md.metricKey} style={{ background: C.bg2, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: C.text3 }}>{md.displayName}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text1 }}>{fmtValue(md.valueType, agent.metrics[md.metricKey])}</div>
                    {md.target !== null && <div style={{ fontSize: 10, color: C.text3 }}>Target {fmtValue(md.valueType, md.target)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
            Source: clean-sheet <code>kpi_agent_daily</code> (NOVA), most recent captured date. Composite = mean attainment vs target across the agent's target-bearing metrics (direction-aware, clamped 0–150%); agents with no target-bearing metric show no composite and rank last. Click a row for the per-agent breakdown.
          </div>
        </>
      )}
    </div>
  );
}
