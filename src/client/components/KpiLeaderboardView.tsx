import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Agent {
  AgentName: string;
  AgentSurname: string;
  TierCode: string;
  Team: string;
  Department: string;
  IsAvailable: boolean;
  OpenTickets_Total: number;
  OpenTickets_Over2Hours: number;
  OpenTickets_NoUpdateToday: number;
  SolvedTickets_Today: number;
  SolvedTickets_ThisWeek: number;
  TicketsSnapshotAt: string;
}

/* ------------------------------------------------------------------ */
/*  Colours & Tokens                                                   */
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rankSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function rankColor(n: number): string {
  if (n === 1) return '#fbbf24';
  if (n === 2) return '#9ca3af';
  if (n === 3) return '#d97706';
  return C.text3;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Pulse({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      backgroundColor: color,
      boxShadow: `0 0 6px ${color}`,
      animation: 'kpiLbPulse 2s ease-in-out infinite',
    }} />
  );
}

function StatPill({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
      padding: '12px 24px', borderRadius: 12,
      background: `${color}10`, border: `1px solid ${color}25`,
      minWidth: 120,
    }}>
      <span style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: C.text3, marginTop: 4, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
        {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function KpiLeaderboardView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [env, setEnv] = useState<'live' | 'uat'>('live');

  const token = localStorage.getItem('nova_token');

  const fetchAgents = useCallback(async () => {
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/kpi-data/agents?env=${env}`, { headers });
      const data = await res.json();

      if (!data.ok) throw new Error(data.error || 'Failed to load agents');

      setAgents(data.data || []);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [token, env]);

  useEffect(() => { setLoading(true); fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAgents, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchAgents]);

  /* ---- Keyframe injection (once) ---- */
  useEffect(() => {
    const id = 'kpi-leaderboard-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes kpiLbPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.85); }
      }
      @keyframes kpiLbShimmer {
        0% { opacity: 0.3; }
        100% { opacity: 0.6; }
      }
      @keyframes kpiLbFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes kpiLbGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  /* ---- Derived data ---- */
  const sorted = [...agents].sort((a, b) => {
    const diff = b.SolvedTickets_Today - a.SolvedTickets_Today;
    if (diff !== 0) return diff;
    return b.SolvedTickets_ThisWeek - a.SolvedTickets_ThisWeek;
  });

  const totalAgents = agents.length;
  const availableCount = agents.filter(a => a.IsAvailable).length;
  const totalSolvedToday = agents.reduce((s, a) => s + a.SolvedTickets_Today, 0);
  const totalOpenTickets = agents.reduce((s, a) => s + a.OpenTickets_Total, 0);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        <div style={{
          height: 56, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 32,
          animation: 'kpiLbShimmer 1.5s ease-in-out infinite alternate',
        }} />
        <div style={{
          display: 'flex', gap: 16, marginBottom: 32,
        }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 80, background: C.glass, border: `1px solid ${C.border}`,
              borderRadius: 12, animation: 'kpiLbShimmer 1.5s ease-in-out infinite alternate',
            }} />
          ))}
        </div>
        <div style={{
          height: 400, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, animation: 'kpiLbShimmer 1.5s ease-in-out infinite alternate',
        }} />
      </div>
    );
  }

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', 'Plus Jakarta Sans', system-ui, sans-serif",
      color: C.text1,
    }}>
      {/* ---- Top Bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 32,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative' as const, overflow: 'hidden' as const,
      }}>
        {/* Animated gradient top border */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%',
          animation: 'kpiLbGradient 4s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Logo */}
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.teal}, ${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
            boxShadow: `0 0 20px ${C.teal}40`,
          }}>L</div>
          <div>
            <h1 style={{
              fontSize: 20, fontWeight: 800, margin: 0, color: C.text1,
              letterSpacing: '-0.3px',
            }}>Agent Leaderboard</h1>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
              {env === 'live' ? 'Live' : 'UAT'} agent performance
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Last refreshed */}
          {lastRefresh && (
            <span style={{ fontSize: 11, color: C.text3 }}>
              Updated {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

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
                  background: env === e
                    ? e === 'live' ? `${C.red}25` : `${C.teal}20`
                    : 'transparent',
                  color: env === e
                    ? e === 'live' ? C.red : C.teal
                    : C.text3,
                }}
              >
                {e}
              </button>
            ))}
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: autoRefresh ? `${C.teal}20` : `rgba(255,255,255,0.05)`,
              color: autoRefresh ? C.teal : C.text3,
              transition: 'all 0.2s',
            }}
          >
            <Pulse color={autoRefresh ? C.teal : C.text3} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>

          {/* Manual refresh */}
          <button
            onClick={fetchAgents}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.glass, cursor: 'pointer', color: C.text2,
              fontSize: 16, transition: 'all 0.2s',
            }}
            title="Refresh now"
          >
            &#x21bb;
          </button>
        </div>
      </div>

      {/* ---- Error Banner ---- */}
      {error && (
        <div style={{
          padding: '12px 20px', marginBottom: 24, borderRadius: 10,
          background: `${C.red}15`, border: `1px solid ${C.red}30`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {/* ---- Summary Stats Row ---- */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 32,
        animation: 'kpiLbFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
        <StatPill value={totalAgents} label="Total Agents" color={C.teal} />
        <StatPill value={availableCount} label="Available" color={C.green} />
        <StatPill value={totalSolvedToday} label="Solved Today" color={C.purple} />
        <StatPill value={totalOpenTickets} label="Open Tickets" color={C.amber} />
      </div>

      {/* ---- Agent Table ---- */}
      <div style={{
        animation: 'kpiLbFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s forwards',
        opacity: 0,
      }}>
        <div style={{
          background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Rank', 'Agent', 'Team', 'Department', 'Tier', 'Solved Today', 'Solved Week', 'Open', '>2h Overdue', 'Stale'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px',
                    textAlign: h === 'Agent' || h === 'Team' || h === 'Department' || h === 'Tier' ? 'left' : 'center',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.5px', color: C.text3,
                    background: C.bg1, borderBottom: `1px solid ${C.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} style={{
                    padding: '40px 16px', textAlign: 'center',
                    color: C.text3, fontSize: 13, fontWeight: 500,
                  }}>
                    No agent data available
                  </td>
                </tr>
              )}
              {sorted.map((agent, i) => {
                const rank = i + 1;
                const isTop3 = rank <= 3;
                const isZero = agent.SolvedTickets_Today === 0;

                return (
                  <tr key={i} style={{
                    background: isTop3 ? `${rankColor(rank)}08` : 'transparent',
                    opacity: isZero ? 0.5 : 1,
                    transition: 'background 0.15s',
                  }}>
                    {/* Rank */}
                    <td style={{
                      padding: '10px 16px', textAlign: 'center',
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: '50%',
                        background: isTop3 ? `${rankColor(rank)}20` : 'transparent',
                        border: isTop3 ? `1px solid ${rankColor(rank)}40` : 'none',
                        fontSize: 12, fontWeight: 800,
                        color: isTop3 ? rankColor(rank) : C.text3,
                      }}>
                        {rank}{rankSuffix(rank)}
                      </span>
                    </td>

                    {/* Agent Name + Availability */}
                    <td style={{
                      padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: agent.IsAvailable ? C.green : '#4b5563',
                          boxShadow: agent.IsAvailable ? `0 0 6px ${C.green}` : 'none',
                          flexShrink: 0,
                        }} />
                        <span style={{
                          fontSize: 13, fontWeight: isTop3 ? 700 : 500,
                          color: isTop3 ? C.text1 : (isZero ? C.text3 : C.text1),
                        }}>
                          {agent.AgentName} {agent.AgentSurname}
                        </span>
                      </div>
                    </td>

                    {/* Team */}
                    <td style={{
                      padding: '10px 16px', fontSize: 12, color: C.text2,
                      borderBottom: `1px solid ${C.border}`,
                    }}>{agent.Team}</td>

                    {/* Department */}
                    <td style={{
                      padding: '10px 16px', fontSize: 12, color: C.text2,
                      borderBottom: `1px solid ${C.border}`,
                    }}>{agent.Department}</td>

                    {/* Tier */}
                    <td style={{
                      padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: C.purple,
                        padding: '2px 8px', borderRadius: 8,
                        background: `${C.purple}15`,
                      }}>{agent.TierCode}</span>
                    </td>

                    {/* Solved Today */}
                    <td style={{
                      padding: '10px 16px', textAlign: 'center',
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{
                        fontSize: 18, fontWeight: 800,
                        color: agent.SolvedTickets_Today > 0 ? C.teal : C.text3,
                      }}>
                        {agent.SolvedTickets_Today}
                      </span>
                    </td>

                    {/* Solved Week */}
                    <td style={{
                      padding: '10px 16px', textAlign: 'center', fontSize: 14, fontWeight: 600,
                      color: C.text2, borderBottom: `1px solid ${C.border}`,
                    }}>{agent.SolvedTickets_ThisWeek}</td>

                    {/* Open */}
                    <td style={{
                      padding: '10px 16px', textAlign: 'center', fontSize: 13, fontWeight: 500,
                      color: C.text2, borderBottom: `1px solid ${C.border}`,
                    }}>{agent.OpenTickets_Total}</td>

                    {/* >2h Overdue */}
                    <td style={{
                      padding: '10px 16px', textAlign: 'center',
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600,
                        color: agent.OpenTickets_Over2Hours > 0 ? C.red : C.text3,
                      }}>
                        {agent.OpenTickets_Over2Hours}
                      </span>
                    </td>

                    {/* Stale */}
                    <td style={{
                      padding: '10px 16px', textAlign: 'center',
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600,
                        color: agent.OpenTickets_NoUpdateToday > 0 ? C.amber : C.text3,
                      }}>
                        {agent.OpenTickets_NoUpdateToday}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Snapshot timestamp */}
        {agents.length > 0 && agents[0].TicketsSnapshotAt && (
          <div style={{
            marginTop: 12, fontSize: 11, color: C.text3, textAlign: 'right',
          }}>
            Ticket data as of {(() => {
              try {
                return new Date(agents[0].TicketsSnapshotAt).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                });
              } catch { return agents[0].TicketsSnapshotAt; }
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
