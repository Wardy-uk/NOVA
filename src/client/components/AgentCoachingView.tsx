import { useState, useEffect, useCallback } from 'react';

interface TeamScore {
  agent_user_id: number;
  assessments: number;
  avg_clarity: number;
  avg_empathy: number;
  avg_action: number;
  avg_ownership: number;
  avg_overall: number;
}

interface AgentScores {
  averages: {
    clarity: number;
    empathy: number;
    action: number;
    ownership: number;
    overall: number;
  } | null;
  trend: Array<{ day: string; avg_score: number; count: number }>;
  totalAssessments: number;
  nudgeBreakdown: Record<string, number>;
}

interface NudgeEntry {
  id: number;
  ticket_id: string;
  agent_user_id: number;
  nudge_type: string;
  golden_rule_scores: string | null;
  message: string | null;
  delivered: boolean;
  created_at: string;
}

interface RosterAgent {
  id: number;
  display_name: string;
  pool: string;
  active: boolean;
}

function api(path: string) {
  return fetch(`/api/agent${path}`).then(r => r.json());
}

function apiJson(path: string, method: string, body: unknown) {
  return fetch(`/api/agent${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function scoreColor(score: number): string {
  if (score >= 4) return 'text-green-400';
  if (score >= 3) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 4) return 'bg-green-900/30 border-green-800/40';
  if (score >= 3) return 'bg-amber-900/30 border-amber-800/40';
  return 'bg-red-900/30 border-red-800/40';
}

function ScoreBar({ label, value, max = 5 }: { label: string; value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-neutral-400">{label}</span>
      <div className="flex-1 h-2 bg-[#23272e] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${value >= 4 ? 'bg-green-500' : value >= 3 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-8 text-right font-mono ${scoreColor(value)}`}>{value.toFixed(1)}</span>
    </div>
  );
}

function NudgeTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    missing_next_update: 'bg-amber-900/40 text-amber-300',
    weak_reply: 'bg-red-900/40 text-red-300',
    unaddressed_question: 'bg-orange-900/40 text-orange-300',
    no_troubleshooting: 'bg-purple-900/40 text-purple-300',
    idle_ticket: 'bg-blue-900/40 text-blue-300',
    golden_rules: 'bg-pink-900/40 text-pink-300',
    escalation_without_docs: 'bg-rose-900/40 text-rose-300',
  };
  const label = type.replace(/_/g, ' ');
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[type] ?? 'bg-neutral-800 text-neutral-400'}`}>
      {label}
    </span>
  );
}

export function AgentCoachingView() {
  const [days, setDays] = useState(30);
  const [teamScores, setTeamScores] = useState<TeamScore[]>([]);
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentScores, setAgentScores] = useState<AgentScores | null>(null);
  const [nudges, setNudges] = useState<NudgeEntry[]>([]);
  const [visibility, setVisibility] = useState<string>('manager');
  const [loading, setLoading] = useState(true);

  const loadTeamData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, rosterRes, nudgeRes] = await Promise.all([
        api(`/coaching/team?days=${days}`),
        api('/roster'),
        api('/coaching/nudges?limit=100'),
      ]);
      if (teamRes.ok) setTeamScores(teamRes.data ?? []);
      if (rosterRes.ok) setRoster(rosterRes.data ?? []);
      if (nudgeRes.ok) setNudges(nudgeRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { loadTeamData(); }, [loadTeamData]);

  const loadAgentDetail = useCallback(async (agentId: number) => {
    setSelectedAgent(agentId);
    const res = await api(`/coaching/agent/${agentId}?days=${days}`);
    if (res.ok) setAgentScores(res.data);
  }, [days]);

  const agentName = (id: number) => {
    const match = roster.find(r => r.id === id);
    return match?.display_name ?? `Agent #${id}`;
  };

  const handleVisibilityChange = async (v: string) => {
    const res = await apiJson('/coaching/visibility', 'PUT', { visibility: v });
    if (res.ok) setVisibility(v);
  };

  const teamAvgOverall = teamScores.length > 0
    ? teamScores.reduce((s, t) => s + (t.avg_overall ?? 0), 0) / teamScores.length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#2f353d] bg-[#1a1d23]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-200">Coaching Dashboard</h2>
          <span className="text-[10px] text-neutral-500">Golden Rules QA</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-xs bg-[#23272e] border border-[#3a424d] rounded px-2 py-1 text-neutral-300"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
          </select>
          <select
            value={visibility}
            onChange={e => handleVisibilityChange(e.target.value)}
            className="text-xs bg-[#23272e] border border-[#3a424d] rounded px-2 py-1 text-neutral-300"
          >
            <option value="off">Nudges: Off</option>
            <option value="agent">Nudges: Agent</option>
            <option value="manager">Nudges: Manager</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-xs text-neutral-500 py-8 text-center">Loading coaching data...</div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Team Avg</div>
                <div className={`text-2xl font-bold ${scoreColor(teamAvgOverall)}`}>
                  {teamAvgOverall > 0 ? teamAvgOverall.toFixed(1) : '—'}
                </div>
                <div className="text-[10px] text-neutral-500">/ 5.0</div>
              </div>
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Agents Scored</div>
                <div className="text-2xl font-bold text-neutral-200">{teamScores.length}</div>
                <div className="text-[10px] text-neutral-500">active</div>
              </div>
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Total Assessments</div>
                <div className="text-2xl font-bold text-neutral-200">
                  {teamScores.reduce((s, t) => s + t.assessments, 0)}
                </div>
                <div className="text-[10px] text-neutral-500">{days}d period</div>
              </div>
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Total Nudges</div>
                <div className="text-2xl font-bold text-amber-400">{nudges.length}</div>
                <div className="text-[10px] text-neutral-500">coaching tips</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Team Leaderboard */}
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-[#2f353d]">
                  <span className="text-xs font-semibold text-neutral-300">Team Scores</span>
                </div>
                <div className="divide-y divide-[#2f353d]">
                  {teamScores.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-neutral-500 text-center">No coaching data yet</div>
                  ) : teamScores.map((agent, i) => (
                    <button
                      key={agent.agent_user_id}
                      onClick={() => loadAgentDetail(agent.agent_user_id)}
                      className={`w-full text-left px-3 py-2 hover:bg-[#23272e] transition-colors flex items-center gap-3
                        ${selectedAgent === agent.agent_user_id ? 'bg-[#23272e] ring-1 ring-inset ring-blue-800/50' : ''}`}
                    >
                      <span className="text-[10px] text-neutral-500 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-neutral-200 truncate">
                          {agentName(agent.agent_user_id)}
                        </div>
                        <div className="text-[10px] text-neutral-500">{agent.assessments} assessments</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {['avg_clarity', 'avg_empathy', 'avg_action', 'avg_ownership'].map(key => {
                          const val = agent[key as keyof TeamScore] as number;
                          return (
                            <div key={key} className={`text-[10px] font-mono ${scoreColor(val)}`}>
                              {val?.toFixed(1) ?? '—'}
                            </div>
                          );
                        })}
                        <div className={`text-xs font-bold px-1.5 py-0.5 rounded border ${scoreBg(agent.avg_overall)} ${scoreColor(agent.avg_overall)}`}>
                          {agent.avg_overall?.toFixed(1) ?? '—'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="px-3 py-1.5 bg-[#1a1d23] text-[10px] text-neutral-500 flex gap-4 justify-end">
                  <span>C = Clarity</span>
                  <span>E = Empathy</span>
                  <span>A = Action</span>
                  <span>O = Ownership</span>
                </div>
              </div>

              {/* Agent Detail */}
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-[#2f353d]">
                  <span className="text-xs font-semibold text-neutral-300">
                    {selectedAgent ? agentName(selectedAgent) : 'Select an agent'}
                  </span>
                </div>
                {!selectedAgent || !agentScores ? (
                  <div className="px-3 py-8 text-xs text-neutral-500 text-center">
                    Click an agent to view their Golden Rules breakdown
                  </div>
                ) : (
                  <div className="p-3 space-y-3">
                    {agentScores.averages ? (
                      <div className="space-y-2">
                        <ScoreBar label="Clarity" value={agentScores.averages.clarity} />
                        <ScoreBar label="Empathy" value={agentScores.averages.empathy} />
                        <ScoreBar label="Action" value={agentScores.averages.action} />
                        <ScoreBar label="Ownership" value={agentScores.averages.ownership} />
                        <div className="pt-1 border-t border-[#2f353d]">
                          <ScoreBar label="Overall" value={agentScores.averages.overall} />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-500">No scored assessments</div>
                    )}

                    {agentScores.trend.length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Daily Trend</div>
                        <div className="flex items-end gap-px h-16">
                          {agentScores.trend.slice(-30).map((d, i) => {
                            const pct = (d.avg_score / 5) * 100;
                            return (
                              <div
                                key={i}
                                className={`flex-1 min-w-[3px] rounded-t ${d.avg_score >= 4 ? 'bg-green-500/60' : d.avg_score >= 3 ? 'bg-amber-500/60' : 'bg-red-500/60'}`}
                                style={{ height: `${pct}%` }}
                                title={`${d.day}: ${d.avg_score.toFixed(1)} (${d.count} reviews)`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {Object.keys(agentScores.nudgeBreakdown).length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Nudge Types</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(agentScores.nudgeBreakdown).map(([type, count]) => (
                            <span key={type} className="flex items-center gap-1">
                              <NudgeTypeBadge type={type} />
                              <span className="text-[10px] text-neutral-500">{count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Nudges */}
            <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-[#2f353d]">
                <span className="text-xs font-semibold text-neutral-300">Recent Coaching Nudges</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[#2f353d]">
                {nudges.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-neutral-500 text-center">No nudges recorded yet</div>
                ) : nudges.slice(0, 50).map(n => (
                  <div key={n.id} className="px-3 py-2 flex items-start gap-2">
                    <NudgeTypeBadge type={n.nudge_type} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-neutral-300 truncate">{n.message ?? n.nudge_type}</div>
                      <div className="text-[10px] text-neutral-500">
                        {n.ticket_id} · {agentName(n.agent_user_id)} · {new Date(n.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {n.delivered && (
                      <span className="text-[10px] text-green-500">delivered</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
