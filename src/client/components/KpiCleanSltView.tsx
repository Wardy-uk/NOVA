/**
 * Clean-Sheet KPI — SLT Cross-Space Dashboard (P3-WP1)
 *
 * Senior-leadership cross-space view. One card per space showing the SLT-flagged
 * metrics from the NEW clean-sheet KPI data source (GET /api/kpi/slt), running
 * in parallel with the untouched legacy KPI dashboards. Sparse / manual / non-
 * Jira spaces are rendered honestly (clear note, "—" values) rather than faked.
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
interface SltMetric {
  metricKey: string; displayName: string; valueType: string; direction: string;
  value: number | null; target: number | null; rag: Rag; asOf: string | null; valueSource: string | null;
  unwired?: boolean;
}
interface SltSpace {
  spaceKey: string; displayName: string; ownerName: string | null; timezone: string;
  isJiraSpace: boolean; hasData: boolean; note: string | null; metrics: SltMetric[];
}
interface SltSummary { generatedAt: string; spaces: SltSpace[]; }

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

export function KpiCleanSltView() {
  const [data, setData] = useState<SltSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/kpi/slt');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load SLT summary');
      setData(j.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return <div style={{ padding: 40, color: C.text2 }}>Loading SLT cross-space dashboard…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 40, color: C.red }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Could not load clean-sheet SLT data</div>
        <div style={{ color: C.text2, fontSize: 13 }}>{error}</div>
        <button onClick={load} style={{ marginTop: 16, background: C.glass, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }
  const spaces = data?.spaces ?? [];

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>SLT Cross-Space Dashboard</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · live cross-space leadership view</div>
        </div>
        <div style={{ fontSize: 11, color: C.text3 }}>
          {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString('en-GB')}` : ''}
          <button onClick={load} style={{ marginLeft: 12, background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>Refresh</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {spaces.map((s) => (
          <div key={s.spaceKey} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text1 }}>{s.displayName}</div>
              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600 }}>{s.spaceKey}</div>
            </div>
            <div style={{ fontSize: 10, color: C.text3, marginBottom: 12 }}>
              {s.ownerName ? `${s.ownerName} · ` : ''}{s.isJiraSpace ? 'Jira-computed' : 'Manual / non-Jira'}
            </div>
            {!s.hasData ? (
              <div style={{ fontSize: 12, color: C.text3, fontStyle: 'italic', padding: '8px 0' }}>{s.note ?? 'No data.'}</div>
            ) : (
              <div>
                {s.metrics.map((m) => (
                  <div key={m.metricKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 12, color: C.text2 }}>{m.displayName}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {m.unwired
                        ? <span title="No data source wired yet" style={{ fontSize: 11, fontWeight: 600, color: C.text3, fontStyle: 'italic' }}>not wired</span>
                        : <span style={{ fontSize: 16, fontWeight: 700, color: ragColor(m.rag) }}>{fmtValue(m.valueType, m.value)}</span>}
                      {!m.unwired && m.target !== null && <span style={{ fontSize: 10, color: C.text3 }}>/ {fmtValue(m.valueType, m.target)}</span>}
                    </span>
                  </div>
                ))}
                {s.metrics.length === 0 && <div style={{ fontSize: 12, color: C.text3, fontStyle: 'italic' }}>No SLT metrics configured.</div>}
              </div>
            )}
          </div>
        ))}
        {spaces.length === 0 && <div style={{ color: C.text2, padding: 24 }}>No spaces configured.</div>}
      </div>
      <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
        Source: clean-sheet <code>kpi_*</code> tables (NOVA). Runs in parallel with the legacy KPI dashboards. Empty Jira spaces indicate sparse sync coverage; manual teams are captured via manual entry (a later phase).
      </div>
    </div>
  );
}
