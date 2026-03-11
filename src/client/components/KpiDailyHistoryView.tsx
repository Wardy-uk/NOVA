import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DailyKpi {
  kpi: string;
  kpiGroup: string;
  count: number;
  target: number | null;
  direction: string | null;
  rag: number | null;
  CreatedAt: string;
}

interface AgentDaily {
  ReportDate: string;
  AgentName: string;
  AgentSurname?: string;
  TierCode: string;
  Team: string;
  OpenTickets_Total: number;
  OpenTickets_Over2Hours: number;
  OpenTickets_NoUpdateToday: number;
  SolvedTickets_Today: number;
  SolvedTickets_ThisWeek: number;
  AvailableHours?: number | null;
  TicketsPerHour?: number | null;
  CSATCount?: number | null;
  CSATAverage?: number | null;
  QATicketsScored?: number | null;
  QAOverallAvg?: number | null;
  QAAccuracyAvg?: number | null;
  QAClarityAvg?: number | null;
  QAToneAvg?: number | null;
  QARedCount?: number | null;
  QAAmberCount?: number | null;
  QAGreenCount?: number | null;
  QAConcerningCount?: number | null;
  GoldenRulesScored?: number | null;
  GoldenRulesAvg?: number | null;
  SLAResolvedCount?: number | null;
  SLABreachedCount?: number | null;
  SLACompliancePct?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  bg3: '#343a42',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
  glassHover: 'rgba(255,255,255,0.06)',
} as const;

const ragColor = (rag: number | null) => {
  if (rag === 1) return C.green;
  if (rag === 2) return C.amber;
  if (rag === 3) return C.red;
  return C.text3;
};

const ragBg = (rag: number | null) => {
  if (rag === 1) return 'rgba(5,150,105,0.08)';
  if (rag === 2) return 'rgba(217,119,6,0.08)';
  if (rag === 3) return 'rgba(239,68,68,0.08)';
  return 'transparent';
};

const ragLabel = (rag: number | null) => {
  if (rag === 1) return 'Green';
  if (rag === 2) return 'Amber';
  if (rag === 3) return 'Red';
  return '-';
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDateShort(s: string): string {
  try {
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return s; }
}

function fmtDateDisplay(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch { return s; }
}

function fmtNum(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined) return '';
  return Number.isFinite(v) ? v.toFixed(dp) : String(v);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return (v * 100).toFixed(2) + '%';
}

/* ---- RAG calculation ---- */
type Direction = 'higher' | 'lower';

function calcRag(
  value: number | null | undefined,
  target: number | null,
  threshold: number | null,
  dir: Direction,
): number | null {
  if (value === null || value === undefined || target === null) return null;
  const thr = threshold ?? target;
  if (dir === 'higher') {
    if (value >= target) return 1;     // green
    if (value >= thr) return 2;        // amber
    return 3;                          // red
  } else {
    if (value <= target) return 1;
    if (value <= thr) return 2;
    return 3;
  }
}

/* ---- Productivity targets per tier (from spreadsheet) ---- */
const PROD_TARGETS: Record<string, { target: number; threshold: number }> = {
  T1: { target: 2.00, threshold: 1.90 },
  T2: { target: 0.67, threshold: 0.63 },
  TL: { target: 1.00, threshold: 0.95 },
};

const QA_TARGET = 95;
const QA_THRESHOLD = 90;

/* ------------------------------------------------------------------ */
/*  Sub-tab types                                                      */
/* ------------------------------------------------------------------ */

type SubTab = 'departmental' | 'agents';

/* ------------------------------------------------------------------ */
/*  Metric Pivot Table                                                 */
/* ------------------------------------------------------------------ */

interface MetricDef {
  label: string;
  getValue: (row: AgentDaily) => number | null | undefined;
  format: (v: number | null | undefined) => string;
  target: (tier: string) => number | null;
  threshold: (tier: string) => number | null;
  direction: Direction;
}

const AGENT_METRICS: MetricDef[] = [
  {
    label: 'Productivity',
    getValue: (r) => r.SolvedTickets_Today,
    format: (v) => fmtNum(v, 2),
    target: (tier) => PROD_TARGETS[tier]?.target ?? null,
    threshold: (tier) => PROD_TARGETS[tier]?.threshold ?? null,
    direction: 'higher',
  },
  {
    label: 'Solve Time SLA',
    getValue: (r) => r.SLACompliancePct,
    format: (v) => v != null ? fmtNum(v, 2) + '%' : '',
    target: () => 95,
    threshold: () => 90,
    direction: 'higher',
  },
  {
    label: 'QA',
    getValue: (r) => r.QAOverallAvg,
    format: (v) => v != null ? fmtNum(v, 2) + '%' : '',
    target: () => QA_TARGET,
    threshold: () => QA_THRESHOLD,
    direction: 'higher',
  },
];

function AgentMetricGrid({ metric, agents, dates, dataMap }: {
  metric: MetricDef;
  agents: { name: string; tier: string }[];
  dates: string[];
  dataMap: Map<string, AgentDaily>;
}) {
  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'center',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', color: C.text3,
    background: C.bg1, borderBottom: `1px solid ${C.border}`,
    position: 'sticky', top: 0, zIndex: 2,
    whiteSpace: 'nowrap',
  };
  const tdBase: React.CSSProperties = {
    padding: '6px 10px', fontSize: 12, textAlign: 'center',
    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  };

  return (
    <div style={{ marginBottom: 32 }}>
      {/* Section header */}
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '1px', color: C.teal, marginBottom: 8,
        paddingBottom: 6, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {metric.label}
      </div>

      <div style={{
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: dates.length * 120 + 300 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 120, position: 'sticky', left: 0, zIndex: 3, background: C.bg1 }}>
                {metric.label}
              </th>
              <th style={{ ...thStyle, minWidth: 40 }}>Tier</th>
              <th style={{ ...thStyle, minWidth: 60 }}>Target</th>
              <th style={{ ...thStyle, minWidth: 60 }}>Threshold</th>
              {dates.map(d => (
                <th key={d} style={thStyle}>{fmtDateShort(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => {
              const tgt = metric.target(agent.tier);
              const thr = metric.threshold(agent.tier);
              return (
                <tr key={i}>
                  <td style={{
                    ...tdBase, textAlign: 'left', fontWeight: 500, color: C.text1,
                    position: 'sticky', left: 0, zIndex: 1,
                    background: i % 2 === 0 ? C.bg0 : C.bg2,
                  }}>{agent.name}</td>
                  <td style={{
                    ...tdBase,
                    background: i % 2 === 0 ? C.bg0 : C.bg2,
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: C.purple,
                      padding: '1px 6px', borderRadius: 6,
                      background: `${C.purple}15`,
                    }}>{agent.tier}</span>
                  </td>
                  <td style={{
                    ...tdBase, color: C.text3, fontWeight: 600,
                    background: i % 2 === 0 ? C.bg0 : C.bg2,
                  }}>{tgt !== null ? metric.format(tgt) : '-'}</td>
                  <td style={{
                    ...tdBase, color: C.text3, fontWeight: 600,
                    background: i % 2 === 0 ? C.bg0 : C.bg2,
                  }}>{thr !== null ? metric.format(thr) : '-'}</td>
                  {dates.map(d => {
                    const key = `${agent.name}|${d}`;
                    const row = dataMap.get(key);
                    const val = row ? metric.getValue(row) : null;
                    const rag = calcRag(val, tgt, thr, metric.direction);
                    const formatted = val != null ? metric.format(val) : '';
                    const bgBase = i % 2 === 0 ? C.bg0 : C.bg2;
                    return (
                      <td key={d} style={{
                        ...tdBase,
                        background: bgBase,
                      }}>
                        {formatted ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                          }}>
                            <span style={{ fontWeight: 600, color: C.text1 }}>{formatted}</span>
                            {rag !== null && (
                              <span style={{
                                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                background: ragColor(rag),
                                boxShadow: `0 0 4px ${ragColor(rag)}`,
                                flexShrink: 0,
                              }} />
                            )}
                          </span>
                        ) : (
                          <span style={{ color: C.text3 }}></span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function KpiDailyHistoryView() {
  const today = new Date();
  const monday = getMonday(today);

  const [fromDate, setFromDate] = useState(fmtDate(monday));
  const [toDate, setToDate] = useState(fmtDate(today));
  const [env, setEnv] = useState<'live' | 'uat'>('uat');
  const [subTab, setSubTab] = useState<SubTab>('departmental');

  const [deptData, setDeptData] = useState<DailyKpi[]>([]);
  const [agentData, setAgentData] = useState<AgentDaily[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = `env=${env}&from=${fromDate}&to=${toDate}`;
      const [deptRes, agentRes] = await Promise.all([
        fetch(`/api/kpi-data/daily-history?${params}`),
        fetch(`/api/kpi-data/agent-daily?${params}`),
      ]);
      const deptJson = await deptRes.json();
      const agentJson = await agentRes.json();
      if (!deptJson.ok) throw new Error(deptJson.error || 'Failed to load departmental data');
      if (!agentJson.ok) throw new Error(agentJson.error || 'Failed to load agent data');
      setDeptData(deptJson.data || []);
      setAgentData(agentJson.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [env, fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Inject keyframes
  useEffect(() => {
    const id = 'kpi-daily-history-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes kpiGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  /* ---- Quick date presets ---- */
  const setThisWeek = () => { setFromDate(fmtDate(getMonday(today))); setToDate(fmtDate(today)); };
  const setLastWeek = () => {
    const lm = getMonday(today);
    lm.setDate(lm.getDate() - 7);
    const ls = new Date(lm);
    ls.setDate(ls.getDate() + 4);
    setFromDate(fmtDate(lm));
    setToDate(fmtDate(ls));
  };
  const setLast30 = () => {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    setFromDate(fmtDate(d));
    setToDate(fmtDate(today));
  };

  /* ---- Departmental: pivot by date ---- */
  const deptDates = [...new Set(deptData.map(d => d.CreatedAt.slice(0, 10)))].sort().reverse();

  /* ---- Agent: build pivot structures ---- */
  const agentDates = [...new Set(agentData.map(d => (d.ReportDate || '').slice(0, 10)).filter(Boolean))].sort();
  const agentNames = [...new Set(agentData.map(d => d.AgentName))].sort();
  const agentTiers = new Map<string, string>();
  agentData.forEach(d => { if (d.TierCode) agentTiers.set(d.AgentName, d.TierCode); });
  const agents = agentNames.map(name => ({ name, tier: agentTiers.get(name) || '' }));
  // Build lookup map: "AgentName|YYYY-MM-DD" => row
  const agentDataMap = new Map<string, AgentDaily>();
  agentData.forEach(d => {
    const dateKey = (d.ReportDate || '').slice(0, 10);
    if (dateKey) agentDataMap.set(`${d.AgentName}|${dateKey}`, d);
  });

  /* ---- Styles ---- */
  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', color: C.text3,
    background: C.bg1, borderBottom: `1px solid ${C.border}`,
    position: 'sticky', top: 0, zIndex: 2,
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 14px', fontSize: 13, color: C.text1,
    borderBottom: `1px solid ${C.border}`,
  };
  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, borderRadius: 20,
    transition: 'all 0.2s',
    background: active ? `${C.teal}20` : 'transparent',
    color: active ? C.teal : C.text3,
  });

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', 'Plus Jakarta Sans', system-ui, sans-serif",
      color: C.text1,
    }}>
      {/* ---- Top Bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%',
          animation: 'kpiGradient 4s ease-in-out infinite',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.teal}, ${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
            boxShadow: `0 0 20px ${C.teal}40`,
          }}>H</div>
          <div>
            <h1 style={{
              fontSize: 20, fontWeight: 800, margin: 0, color: C.text1,
              letterSpacing: '-0.3px',
            }}>Daily History</h1>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
              {env === 'live' ? 'Live' : 'UAT'} &middot; {fromDate} to {toDate}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Env toggle */}
          <div style={{
            display: 'flex', borderRadius: 20, overflow: 'hidden',
            border: `1px solid ${C.border}`,
          }}>
            {(['live', 'uat'] as const).map(e => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                style={{
                  padding: '6px 14px', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.5px', transition: 'all 0.2s',
                  background: env === e ? (e === 'live' ? `${C.red}25` : `${C.teal}20`) : 'transparent',
                  color: env === e ? (e === 'live' ? C.red : C.teal) : C.text3,
                }}
              >{e}</button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={fetchData}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.glass, cursor: 'pointer', color: C.text2,
              fontSize: 16, transition: 'all 0.2s',
            }}
            title="Refresh"
          >&#x21bb;</button>
        </div>
      </div>

      {/* ---- Date Range Controls ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24,
        padding: '12px 20px',
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase' }}>From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{
              padding: '6px 12px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: C.bg2,
              color: C.text1, fontSize: 12, fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase' }}>To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            style={{
              padding: '6px 12px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: C.bg2,
              color: C.text1, fontSize: 12, fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ width: 1, height: 24, background: C.border }} />
        <button onClick={setThisWeek} style={pillBtn(false)}>This Week</button>
        <button onClick={setLastWeek} style={pillBtn(false)}>Last Week</button>
        <button onClick={setLast30} style={pillBtn(false)}>Last 30 Days</button>
      </div>

      {/* ---- Sub-tabs ---- */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 4, width: 'fit-content',
      }}>
        {([
          { id: 'departmental' as SubTab, label: 'Departmental KPIs' },
          { id: 'agents' as SubTab, label: 'Agent KPIs' },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, borderRadius: 10,
              transition: 'all 0.2s',
              background: subTab === t.id ? `${C.teal}20` : 'transparent',
              color: subTab === t.id ? C.teal : C.text3,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ---- Error ---- */}
      {error && (
        <div style={{
          padding: '12px 20px', marginBottom: 24, borderRadius: 10,
          background: `${C.red}15`, border: `1px solid ${C.red}30`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>{error}</div>
      )}

      {/* ---- Loading ---- */}
      {loading && (
        <div style={{
          padding: 40, textAlign: 'center', color: C.text3, fontSize: 13,
        }}>Loading...</div>
      )}

      {/* ---- Departmental KPIs Tab: Grid with days across, KPIs down ---- */}
      {!loading && subTab === 'departmental' && (() => {
        const sortedDates = [...new Set(deptData.map(d => d.CreatedAt.slice(0, 10)))].sort();
        // Build lookup: "kpi|date" => DailyKpi
        const deptMap = new Map<string, DailyKpi>();
        deptData.forEach(d => deptMap.set(`${d.kpi}|${d.CreatedAt.slice(0, 10)}`, d));
        // Fixed KPI display order
        const KPI_ORDER: string[] = [
          "WTD percentage KPI's Green",
          "WTD percentage KPI's Red",
          'Number of Tickets in CC - Incidents',
          'Number of Tickets in CC - Service Requests',
          'Number of Tickets in CC - TPJ',
          'Number of Tickets in Production',
          'Number of Tickets in Tier 2',
          'Number of Tickets in Tier 3',
          'Number of Tickets in Development',
          'Number of Tickets With No Reply in CC - Incidents',
          'Number of Tickets With No Reply in CC - Production',
          'Number of Tickets With No Reply in CC - TPJ',
          'Number of Tickets With No Reply in Tier 2',
          'Number of Tickets With No Reply in Tier 3',
          'Number of CC tickets over SLA (actionable) (Incidents)',
          'Number of CC tickets over SLA (actionable) (Production)',
          'Number of CC tickets over SLA (actionable) (TPJ)',
          'Number of Tier 2 tickets over SLA (actionable)',
          'Number of Tier 3 tickets over SLA (actionable)',
          'Number of CC tickets over SLA (Not actionable) (Incidents)',
          'Number of CC tickets over SLA (Not actionable) (Production)',
          'Number of CC tickets over SLA (Not actionable) (TPJ)',
          'Number of Tier 2 tickets over SLA (not actionable)',
          'Number of Tier 3 tickets over SLA (not actionable)',
          'Tickets escalated to Tier 2',
          'Tickets escalated to Tier 3',
          'Tickets escalated to Development',
          'Tickets rejected by Tier 2',
          'Tickets rejected by Tier 3',
          'Tickets rejected by Development',
          'Oldest actionable ticket (days) in CC (Incident)',
          'Oldest actionable ticket (days) in CC (Production)',
          'Oldest actionable ticket (days) in CC (TPJ)',
          'Oldest actionable ticket (days) in Production',
          'Oldest actionable ticket (days) in Tier 2',
          'Oldest actionable ticket (days) in Tier 3',
        ];
        // Group KPIs by their kpiGroup from the data
        const groupMap = new Map<string, string>();
        deptData.forEach(d => groupMap.set(d.kpi, d.kpiGroup));
        // Order all KPIs: known ones first in fixed order, then any unknown ones at the end
        const allKpiNames = [...new Set(deptData.map(d => d.kpi))];
        const orderedKpis = [
          ...KPI_ORDER.filter(k => allKpiNames.includes(k)),
          ...allKpiNames.filter(k => !KPI_ORDER.includes(k)),
        ];
        // Build grouped structure preserving the fixed order
        const seenGroups: string[] = [];
        for (const kpi of orderedKpis) {
          const g = groupMap.get(kpi) || 'Other';
          if (!seenGroups.includes(g)) seenGroups.push(g);
        }
        const kpisByGroup = seenGroups.map(g => ({
          group: g,
          kpis: orderedKpis.filter(k => (groupMap.get(k) || 'Other') === g),
        }));

        return (
          <div>
            {sortedDates.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>
                No departmental KPI data for this date range.
              </div>
            ) : (
              <div style={{
                background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                overflow: 'auto',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: sortedDates.length * 100 + 300 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: 'left', minWidth: 200, position: 'sticky', left: 0, zIndex: 3, background: C.bg1 }}>KPI</th>
                      <th style={{ ...thStyle, textAlign: 'center', minWidth: 60 }}>Target</th>
                      {sortedDates.map(d => (
                        <th key={d} style={{ ...thStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>{fmtDateShort(d)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {kpisByGroup.map(({ group, kpis }) => (
                      <>
                        <tr key={`group-${group}`}>
                          <td colSpan={2 + sortedDates.length} style={{
                            padding: '10px 14px', fontSize: 10, fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: '1px',
                            color: C.teal, background: C.bg2,
                            borderBottom: `1px solid ${C.border}`,
                            position: 'sticky', left: 0,
                          }}>{group}</td>
                        </tr>
                        {kpis.map((kpi, ki) => {
                          const firstRow = deptMap.get(`${kpi}|${sortedDates[0]}`);
                          return (
                            <tr key={kpi}>
                              <td style={{
                                ...tdStyle, fontWeight: 500, position: 'sticky', left: 0, zIndex: 1,
                                background: ki % 2 === 0 ? C.bg0 : C.bg2,
                              }}>{kpi}</td>
                              <td style={{
                                ...tdStyle, textAlign: 'center', color: C.text3, fontWeight: 600,
                                background: ki % 2 === 0 ? C.bg0 : C.bg2,
                              }}>{firstRow?.target != null ? fmtNum(firstRow.target) : '-'}</td>
                              {sortedDates.map(date => {
                                const row = deptMap.get(`${kpi}|${date}`);
                                const bg = ki % 2 === 0 ? C.bg0 : C.bg2;
                                if (!row) return <td key={date} style={{ ...tdStyle, textAlign: 'center', background: bg, color: C.text3 }}></td>;
                                return (
                                  <td key={date} style={{ ...tdStyle, textAlign: 'center', background: bg }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      <span style={{ fontWeight: 600, color: C.text1 }}>{fmtNum(row.count)}</span>
                                      <span style={{
                                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                        background: ragColor(row.rag),
                                        boxShadow: `0 0 4px ${ragColor(row.rag)}`,
                                        flexShrink: 0,
                                      }} />
                                    </span>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ---- Agent KPIs Tab: Pivoted spreadsheet style ---- */}
      {!loading && subTab === 'agents' && (
        <div>
          {agents.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>
              No agent KPI data for this date range.
            </div>
          ) : (
            AGENT_METRICS.map(metric => (
              <AgentMetricGrid
                key={metric.label}
                metric={metric}
                agents={agents}
                dates={agentDates}
                dataMap={agentDataMap}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
