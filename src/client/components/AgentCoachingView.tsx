import { useState, useEffect, useCallback } from 'react';

interface TeamScore {
  agent_name: string;
  assessments: number;
  avg_qa_overall: number | null;
  avg_ownership: number | null;
  avg_next_action: number | null;
  avg_timeframe: number | null;
  avg_gr_overall: number | null;
  green_count: number;
  amber_count: number;
  red_count: number;
  concerning_count: number;
}

interface AgentDetail {
  averages: {
    qa_overall: number | null;
    clarity: number | null;
    tone: number | null;
    ownership: number | null;
    next_action: number | null;
    timeframe: number | null;
    gr_overall: number | null;
  } | null;
  trend: Array<{ day: string; avg_score: number; count: number }>;
  totalAssessments: number;
  gradeBreakdown: { green: number; amber: number; red: number };
  concerningTickets: Array<{
    issue_key: string;
    grade: string;
    overall_score: number;
    coaching_points: string;
    category: string;
    processed_at: string;
  }>;
}

interface SynthesisEntry {
  id: number;
  nudge_type: string | null;
  message: string | null;
  agent_name: string | null;
  created_at: string;
}

interface ConcernEntry {
  issue_key: string;
  agent_name: string;
  grade: string;
  overall_score: number;
  coaching_points: string;
  category: string;
  processed_at: string;
}

function api(path: string) {
  return fetch(`/api/agent${path}`).then(r => r.json());
}

function gradeColor(grade: string): string {
  if (grade === 'GREEN') return 'text-green-400';
  if (grade === 'AMBER') return 'text-amber-400';
  return 'text-red-400';
}

function gradeBg(grade: string): string {
  if (grade === 'GREEN') return 'bg-green-900/30 border-green-800/40';
  if (grade === 'AMBER') return 'bg-amber-900/30 border-amber-800/40';
  return 'bg-red-900/30 border-red-800/40';
}

function scoreColor(score: number | null, max: number): string {
  if (score == null) return 'text-neutral-500';
  const pct = score / max;
  if (pct >= 0.75) return 'text-green-400';
  if (pct >= 0.5) return 'text-amber-400';
  return 'text-red-400';
}

function ScoreBar({ label, value, max }: { label: string; value: number | null; max: number }) {
  if (value == null) return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-neutral-400">{label}</span>
      <div className="flex-1 h-2 bg-[#23272e] rounded-full" />
      <span className="w-8 text-right font-mono text-neutral-500">—</span>
    </div>
  );
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-neutral-400">{label}</span>
      <div className="flex-1 h-2 bg-[#23272e] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-8 text-right font-mono ${scoreColor(value, max)}`}>{value.toFixed(1)}</span>
    </div>
  );
}

function GradePill({ grade }: { grade: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${gradeBg(grade)} ${gradeColor(grade)}`}>
      {grade}
    </span>
  );
}

function GradeBar({ green, amber, red }: { green: number; amber: number; red: number }) {
  const total = green + amber + red;
  if (total === 0) return <span className="text-[10px] text-neutral-500">—</span>;
  return (
    <div className="flex h-3 rounded-full overflow-hidden w-20" title={`G:${green} A:${amber} R:${red}`}>
      {green > 0 && <div className="bg-green-500/70" style={{ width: `${(green / total) * 100}%` }} />}
      {amber > 0 && <div className="bg-amber-500/70" style={{ width: `${(amber / total) * 100}%` }} />}
      {red > 0 && <div className="bg-red-500/70" style={{ width: `${(red / total) * 100}%` }} />}
    </div>
  );
}

function severityColor(type: string | null): string {
  if (!type) return 'text-neutral-400';
  if (type.includes('critical') || type.includes('red')) return 'text-red-400';
  if (type.includes('warning') || type.includes('weak') || type.includes('missing')) return 'text-amber-400';
  return 'text-blue-400';
}

export function AgentCoachingView() {
  const [days, setDays] = useState(30);
  const [teamScores, setTeamScores] = useState<TeamScore[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);
  const [concerns, setConcerns] = useState<ConcernEntry[]>([]);
  const [synthesis, setSynthesis] = useState<SynthesisEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTeamData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, concernRes, synthRes] = await Promise.all([
        api(`/coaching/team?days=${days}`),
        api('/coaching/nudges?limit=100'),
        api(`/coaching/synthesis?days=${days}`),
      ]);
      if (teamRes.ok) setTeamScores(teamRes.data ?? []);
      if (concernRes.ok) setConcerns(concernRes.data ?? []);
      if (synthRes.ok) setSynthesis(synthRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { loadTeamData(); }, [loadTeamData]);

  const loadAgentDetail = useCallback(async (agentName: string) => {
    setSelectedAgent(agentName);
    const res = await api(`/coaching/agent/${encodeURIComponent(agentName)}?days=${days}`);
    if (res.ok) setAgentDetail(res.data);
  }, [days]);

  const teamAvgOverall = teamScores.length > 0
    ? teamScores.reduce((s, t) => s + (t.avg_qa_overall ?? 0), 0) / teamScores.length
    : 0;
  const totalAssessments = teamScores.reduce((s, t) => s + t.assessments, 0);
  const totalConcerning = teamScores.reduce((s, t) => s + t.concerning_count, 0);

  const agentSynthesis = selectedAgent
    ? synthesis.filter(s => s.agent_name?.toLowerCase() === selectedAgent.toLowerCase())
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#2f353d] bg-[#1a1d23]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-200">Coaching Dashboard</h2>
          <span className="text-[10px] text-neutral-500">Based on {totalAssessments} QA scores &amp; GR pipeline results</span>
        </div>
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
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-xs text-neutral-500 py-8 text-center">Loading coaching data...</div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">QA Avg Score</div>
                <div className={`text-2xl font-bold ${scoreColor(teamAvgOverall, 100)}`}>
                  {teamAvgOverall > 0 ? teamAvgOverall.toFixed(1) : '—'}
                </div>
                <div className="text-[10px] text-neutral-500">team average</div>
              </div>
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Agents Scored</div>
                <div className="text-2xl font-bold text-neutral-200">{teamScores.length}</div>
                <div className="text-[10px] text-neutral-500">active</div>
              </div>
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Coaching Nudges</div>
                <div className="text-2xl font-bold text-blue-400">{synthesis.length}</div>
                <div className="text-[10px] text-neutral-500">{days}d synthesis</div>
              </div>
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Concerning</div>
                <div className="text-2xl font-bold text-red-400">{totalConcerning}</div>
                <div className="text-[10px] text-neutral-500">tickets flagged</div>
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
                    <div className="px-3 py-4 text-xs text-neutral-500 text-center">No QA data in this period</div>
                  ) : teamScores.map((agent, i) => (
                    <button
                      key={agent.agent_name}
                      onClick={() => loadAgentDetail(agent.agent_name)}
                      className={`w-full text-left px-3 py-2 hover:bg-[#23272e] transition-colors flex items-center gap-3
                        ${selectedAgent === agent.agent_name ? 'bg-[#23272e] ring-1 ring-inset ring-blue-800/50' : ''}`}
                    >
                      <span className="text-[10px] text-neutral-500 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-neutral-200 truncate">{agent.agent_name}</div>
                        <div className="text-[10px] text-neutral-500">{agent.assessments} reviews</div>
                      </div>
                      <GradeBar green={agent.green_count} amber={agent.amber_count} red={agent.red_count} />
                      <div className={`text-xs font-bold px-1.5 py-0.5 rounded border
                        ${(agent.avg_qa_overall ?? 0) >= 75 ? 'bg-green-900/30 border-green-800/40 text-green-400'
                          : (agent.avg_qa_overall ?? 0) >= 50 ? 'bg-amber-900/30 border-amber-800/40 text-amber-400'
                          : 'bg-red-900/30 border-red-800/40 text-red-400'}`}>
                        {agent.avg_qa_overall?.toFixed(1) ?? '—'}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="px-3 py-1.5 bg-[#1a1d23] text-[10px] text-neutral-500 flex gap-4 justify-end">
                  <span>Grade bar: G/A/R distribution</span>
                  <span>Score: QA overall avg</span>
                </div>
              </div>

              {/* Agent Detail */}
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-[#2f353d]">
                  <span className="text-xs font-semibold text-neutral-300">
                    {selectedAgent ?? 'Select an agent'}
                  </span>
                </div>
                {!selectedAgent || !agentDetail ? (
                  <div className="px-3 py-8 text-xs text-neutral-500 text-center">
                    Click an agent to view their QA & Golden Rules breakdown
                  </div>
                ) : (
                  <div className="p-3 space-y-3">
                    {agentDetail.averages ? (
                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Golden Rules (0–3)</div>
                          <div className="space-y-1">
                            <ScoreBar label="Ownership" value={agentDetail.averages.ownership} max={3} />
                            <ScoreBar label="Next Action" value={agentDetail.averages.next_action} max={3} />
                            <ScoreBar label="Timeframe" value={agentDetail.averages.timeframe} max={3} />
                          </div>
                        </div>
                        <div className="pt-1 border-t border-[#2f353d]">
                          <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">QA Scores</div>
                          <div className="space-y-1">
                            <ScoreBar label="Overall" value={agentDetail.averages.qa_overall} max={100} />
                            <ScoreBar label="Clarity" value={agentDetail.averages.clarity} max={100} />
                            <ScoreBar label="Tone" value={agentDetail.averages.tone} max={100} />
                          </div>
                        </div>
                        <div className="pt-1 border-t border-[#2f353d] flex gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-neutral-400">{agentDetail.gradeBreakdown.green}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <span className="text-neutral-400">{agentDetail.gradeBreakdown.amber}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            <span className="text-neutral-400">{agentDetail.gradeBreakdown.red}</span>
                          </div>
                          <span className="text-[10px] text-neutral-500 ml-auto">
                            {agentDetail.totalAssessments} total
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-500">No QA assessments in this period</div>
                    )}

                    {/* Coaching Nudges for selected agent */}
                    {agentSynthesis.length > 0 && (
                      <div className="pt-1 border-t border-[#2f353d]">
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Coaching Nudges</div>
                        <div className="space-y-1.5 max-h-32 overflow-y-auto">
                          {agentSynthesis.map(s => (
                            <div key={s.id} className="flex items-start gap-2 text-xs">
                              <span className={`text-[10px] font-mono ${severityColor(s.nudge_type)}`}>
                                {s.nudge_type ?? 'synthesis'}
                              </span>
                              <div className="flex-1 min-w-0 text-neutral-300 text-[11px]">
                                {s.message?.slice(0, 200)}
                              </div>
                              <span className="text-[10px] text-neutral-500 shrink-0">
                                {new Date(s.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {agentDetail.trend.length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Daily Trend</div>
                        <div className="flex items-end gap-px h-16">
                          {agentDetail.trend.slice(-30).map((d, i) => {
                            const pct = (d.avg_score / 100) * 100;
                            return (
                              <div
                                key={i}
                                className={`flex-1 min-w-[3px] rounded-t ${pct >= 75 ? 'bg-green-500/60' : pct >= 50 ? 'bg-amber-500/60' : 'bg-red-500/60'}`}
                                style={{ height: `${Math.max(pct, 3)}%` }}
                                title={`${d.day}: ${d.avg_score.toFixed(1)} (${d.count} reviews)`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {agentDetail.concerningTickets.length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Concerning Tickets</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {agentDetail.concerningTickets.map(t => (
                            <div key={t.issue_key} className="flex items-start gap-2 text-xs">
                              <GradePill grade={t.grade} />
                              <div className="flex-1 min-w-0">
                                <span className="text-neutral-300 font-mono">{t.issue_key}</span>
                                {t.category && (
                                  <span className="text-[10px] text-neutral-500 ml-1">{t.category}</span>
                                )}
                              </div>
                              <span className="text-[10px] text-neutral-500">{new Date(t.processed_at).toLocaleDateString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Coaching Synthesis */}
            {synthesis.length > 0 && (
              <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-[#2f353d]">
                  <span className="text-xs font-semibold text-neutral-300">Recent Coaching Synthesis</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-[#2f353d]">
                  {synthesis.slice(0, 30).map((s) => (
                    <div key={s.id} className="px-3 py-2 flex items-start gap-2">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#3a424d] ${severityColor(s.nudge_type)}`}>
                        {s.nudge_type ?? 'coaching'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-neutral-300">{s.message?.slice(0, 300)}</div>
                        <div className="text-[10px] text-neutral-500">
                          {s.agent_name ?? 'Unknown'} · {new Date(s.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent QA Concerns */}
            <div className="bg-[#1e2228] border border-[#2f353d] rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-[#2f353d]">
                <span className="text-xs font-semibold text-neutral-300">Recent QA Concerns</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[#2f353d]">
                {concerns.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-neutral-500 text-center">No concerning tickets found</div>
                ) : concerns.slice(0, 50).map((c, i) => (
                  <div key={`${c.issue_key}-${i}`} className="px-3 py-2 flex items-start gap-2">
                    <GradePill grade={c.grade} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-neutral-300">
                        <span className="font-mono">{c.issue_key}</span>
                        {c.category && <span className="text-neutral-500"> — {c.category}</span>}
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        {c.agent_name} · {new Date(c.processed_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono ${scoreColor(c.overall_score, 100)}`}>
                      {c.overall_score?.toFixed(0) ?? '—'}
                    </span>
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
