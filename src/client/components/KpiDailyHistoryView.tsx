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
  QaAvgScore?: number | null;
  GoldenRuleFails?: number | null;
  CsatAvg?: number | null;
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

function fmtDateDisplay(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch { return s; }
}

function fmtNum(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined) return '-';
  return Number.isFinite(v) ? v.toFixed(dp) : String(v);
}

/* ------------------------------------------------------------------ */
/*  Sub-tab types                                                      */
/* ------------------------------------------------------------------ */

type SubTab = 'departmental' | 'agents';

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function KpiDailyHistoryView() {
  const today = new Date();
  const monday = getMonday(today);

  const [fromDate, setFromDate] = useState(fmtDate(monday));
  const [toDate, setToDate] = useState(fmtDate(today));
  const [env, setEnv] = useState<'live' | 'uat'>('live');
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
    ls.setDate(ls.getDate() + 4); // Friday
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
  const deptGroups = [...new Set(deptData.map(d => d.kpiGroup))].sort();

  /* ---- Agent: pivot by date ---- */
  const agentDates = [...new Set(agentData.map(d => (d.ReportDate || '').slice(0, 10)))].sort().reverse();

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

      {/* ---- Departmental KPIs Tab ---- */}
      {!loading && subTab === 'departmental' && (
        <div>
          {deptDates.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>
              No departmental KPI data for this date range.
            </div>
          ) : (
            deptDates.map(date => {
              const dayRows = deptData.filter(d => d.CreatedAt.slice(0, 10) === date);
              const greenCount = dayRows.filter(d => d.rag === 1).length;
              const amberCount = dayRows.filter(d => d.rag === 2).length;
              const redCount = dayRows.filter(d => d.rag === 3).length;

              return (
                <div key={date} style={{ marginBottom: 24 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 8,
                  }}>
                    <h3 style={{
                      fontSize: 14, fontWeight: 700, color: C.text1, margin: 0,
                    }}>{fmtDateDisplay(date)}</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[
                        { c: greenCount, color: C.green, label: 'G' },
                        { c: amberCount, color: C.amber, label: 'A' },
                        { c: redCount, color: C.red, label: 'R' },
                      ].map(s => (
                        <span key={s.label} style={{
                          fontSize: 11, fontWeight: 700, color: s.color,
                          padding: '2px 10px', borderRadius: 10,
                          background: `${s.color}15`,
                        }}>{s.c} {s.label}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{
                    background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                    overflow: 'hidden',
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>KPI</th>
                          <th style={thStyle}>Group</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>Count</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>Target</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>RAG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayRows.map((row, i) => (
                          <tr key={i} style={{
                            background: row.rag === 3 ? 'rgba(239,68,68,0.04)' : 'transparent',
                          }}>
                            <td style={{ ...tdStyle, fontWeight: 500 }}>{row.kpi}</td>
                            <td style={{ ...tdStyle, fontSize: 11, color: C.text3 }}>{row.kpiGroup}</td>
                            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>
                              {fmtNum(row.count)}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center', color: C.text3 }}>
                              {row.target !== null ? fmtNum(row.target) : '-'}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              <span style={{
                                fontSize: 10, fontWeight: 600, color: ragColor(row.rag),
                                padding: '2px 8px', borderRadius: 10,
                                background: ragBg(row.rag),
                              }}>{ragLabel(row.rag)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ---- Agent KPIs Tab ---- */}
      {!loading && subTab === 'agents' && (
        <div>
          {agentDates.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>
              No agent KPI data for this date range.
            </div>
          ) : (
            agentDates.map(date => {
              const dayRows = agentData
                .filter(d => (d.ReportDate || '').slice(0, 10) === date)
                .sort((a, b) => b.SolvedTickets_Today - a.SolvedTickets_Today);
              const totalSolved = dayRows.reduce((s, r) => s + r.SolvedTickets_Today, 0);

              return (
                <div key={date} style={{ marginBottom: 24 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 8,
                  }}>
                    <h3 style={{
                      fontSize: 14, fontWeight: 700, color: C.text1, margin: 0,
                    }}>{fmtDateDisplay(date)}</h3>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: C.teal,
                      padding: '2px 10px', borderRadius: 10,
                      background: `${C.teal}15`,
                    }}>{totalSolved} solved &middot; {dayRows.length} agents</span>
                  </div>
                  <div style={{
                    background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                    overflow: 'auto',
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Agent</th>
                          <th style={thStyle}>Tier</th>
                          <th style={thStyle}>Team</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>Solved</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>Open</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>&gt;2h</th>
                          <th style={{ ...thStyle, textAlign: 'center' }}>Stale</th>
                          {agentData.some(r => r.QaAvgScore != null) && (
                            <th style={{ ...thStyle, textAlign: 'center' }}>QA Avg</th>
                          )}
                          {agentData.some(r => r.GoldenRuleFails != null) && (
                            <th style={{ ...thStyle, textAlign: 'center' }}>GR Fails</th>
                          )}
                          {agentData.some(r => r.CsatAvg != null) && (
                            <th style={{ ...thStyle, textAlign: 'center' }}>CSAT</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {dayRows.map((row, i) => (
                          <tr key={i}>
                            <td style={{ ...tdStyle, fontWeight: 500 }}>
                              {row.AgentName} {row.AgentSurname || ''}
                            </td>
                            <td style={tdStyle}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, color: C.purple,
                                padding: '2px 8px', borderRadius: 8,
                                background: `${C.purple}15`,
                              }}>{row.TierCode}</span>
                            </td>
                            <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{row.Team}</td>
                            <td style={{
                              ...tdStyle, textAlign: 'center', fontWeight: 700,
                              color: row.SolvedTickets_Today > 0 ? C.teal : C.text3,
                            }}>{row.SolvedTickets_Today}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{row.OpenTickets_Total}</td>
                            <td style={{
                              ...tdStyle, textAlign: 'center',
                              color: row.OpenTickets_Over2Hours > 0 ? C.red : C.text3,
                              fontWeight: row.OpenTickets_Over2Hours > 0 ? 600 : 400,
                            }}>{row.OpenTickets_Over2Hours}</td>
                            <td style={{
                              ...tdStyle, textAlign: 'center',
                              color: row.OpenTickets_NoUpdateToday > 0 ? C.amber : C.text3,
                              fontWeight: row.OpenTickets_NoUpdateToday > 0 ? 600 : 400,
                            }}>{row.OpenTickets_NoUpdateToday}</td>
                            {agentData.some(r => r.QaAvgScore != null) && (
                              <td style={{ ...tdStyle, textAlign: 'center' }}>
                                {fmtNum(row.QaAvgScore, 1)}
                              </td>
                            )}
                            {agentData.some(r => r.GoldenRuleFails != null) && (
                              <td style={{
                                ...tdStyle, textAlign: 'center',
                                color: (row.GoldenRuleFails ?? 0) > 0 ? C.red : C.text3,
                              }}>{fmtNum(row.GoldenRuleFails)}</td>
                            )}
                            {agentData.some(r => r.CsatAvg != null) && (
                              <td style={{ ...tdStyle, textAlign: 'center' }}>
                                {fmtNum(row.CsatAvg, 1)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
