import { useState, useEffect } from 'react';

interface TrainingSignal {
  id: number; agent_id: string; agent_name: string | null; signal_type: string;
  request_type: string | null; component: string | null; metric_value: number | null;
  team_average: number | null; recommendation: string | null; example_tickets: string | null;
  kb_article_link: string | null; actioned: boolean; generated_at: string;
}

interface HeatmapItem {
  request_type: string; agent_count: number; avg_metric: number; signal_count: number;
}

const api = async (path: string, method = 'GET') => {
  const r = await fetch(`/api/training-signals${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  return r.json();
};

export function TrainingSignalsView() {
  const [signals, setSignals] = useState<TrainingSignal[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapItem[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [showActioned, setShowActioned] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    const params = new URLSearchParams();
    if (agentFilter) params.set('agentId', agentFilter);
    params.set('actioned', String(showActioned));
    const [s, h] = await Promise.all([
      api(`/?${params}`), api('/heatmap'),
    ]);
    if (s.ok) setSignals(s.data);
    if (h.ok) setHeatmap(h.data);
  };

  useEffect(() => { load(); }, [agentFilter, showActioned]);

  const generate = async () => {
    setGenerating(true);
    await api('/generate', 'POST');
    await load();
    setGenerating(false);
  };

  const markActioned = async (id: number) => {
    await api(`/${id}/action`, 'POST');
    setSignals(prev => prev.map(s => s.id === id ? { ...s, actioned: true } : s));
  };

  const signalTypeLabel = (t: string) => {
    switch (t) {
      case 'high_escalation_rate': return 'High Escalation Rate';
      case 'low_qa_score': return 'Low QA Score';
      case 'slow_response': return 'Slow Response';
      case 'frequent_nudge': return 'Frequent Nudges';
      case 'missing_skill': return 'Missing Skill';
      default: return t;
    }
  };

  const signalColor = (t: string) => {
    switch (t) {
      case 'high_escalation_rate': return 'text-red-400 bg-red-900/20';
      case 'low_qa_score': return 'text-amber-400 bg-amber-900/20';
      case 'frequent_nudge': return 'text-orange-400 bg-orange-900/20';
      default: return 'text-neutral-400 bg-neutral-900/20';
    }
  };

  const agents = [...new Set(signals.map(s => s.agent_name).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
          className="bg-[#2f353d] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d]">
          <option value="">All agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-neutral-400">
          <input type="checkbox" checked={showActioned} onChange={e => setShowActioned(e.target.checked)}
            className="rounded bg-[#2f353d]" />
          Show actioned
        </label>
        <button onClick={generate} disabled={generating}
          className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
          {generating ? 'Generating...' : 'Generate Signals'}
        </button>
      </div>

      {/* Team Heatmap */}
      {heatmap.length > 0 && (
        <div className="bg-[#2f353d] rounded-lg p-4">
          <h3 className="text-sm font-medium text-neutral-200 mb-3">Team Weakness Heatmap</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {heatmap.map(h => (
              <div key={h.request_type} className="flex items-center justify-between bg-[#272C33] rounded px-3 py-2">
                <span className="text-xs text-neutral-300 truncate mr-2">{h.request_type}</span>
                <div className="flex gap-2 text-xs">
                  <span className="text-red-400">{h.signal_count} signals</span>
                  <span className="text-neutral-500">{h.agent_count} agents</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signals List */}
      <div className="space-y-3">
        {signals.map(s => (
          <div key={s.id} className={`bg-[#2f353d] rounded-lg p-4 ${s.actioned ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-sm font-medium text-neutral-200">{s.agent_name ?? s.agent_id}</span>
                <span className={`ml-2 px-2 py-0.5 rounded text-xs ${signalColor(s.signal_type)}`}>
                  {signalTypeLabel(s.signal_type)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">
                  {new Date(s.generated_at).toLocaleDateString()}
                </span>
                {!s.actioned && (
                  <button onClick={() => markActioned(s.id)}
                    className="px-2 py-0.5 bg-green-900/30 text-green-400 text-xs rounded hover:bg-green-900/40">
                    Mark Actioned
                  </button>
                )}
              </div>
            </div>
            {s.request_type && (
              <div className="text-xs text-neutral-400 mb-1">
                Request type: <span className="text-neutral-300">{s.request_type}</span>
                {s.metric_value !== null && s.team_average !== null && (
                  <span className="ml-2">
                    Agent: <span className="text-red-400">{typeof s.metric_value === 'number' && s.metric_value < 1 ? (s.metric_value * 100).toFixed(0) + '%' : s.metric_value?.toFixed(1)}</span>
                    {' vs team: '}
                    <span className="text-green-400">{typeof s.team_average === 'number' && s.team_average < 1 ? (s.team_average * 100).toFixed(0) + '%' : s.team_average?.toFixed(1)}</span>
                  </span>
                )}
              </div>
            )}
            {s.recommendation && (
              <p className="text-xs text-neutral-300 mt-1">{s.recommendation}</p>
            )}
            <div className="flex gap-3 mt-2">
              {s.example_tickets && (
                <span className="text-xs text-neutral-500">
                  Examples: {JSON.parse(s.example_tickets).join(', ')}
                </span>
              )}
              {s.kb_article_link && (
                <a href={s.kb_article_link} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[#5ec1ca] hover:underline">KB Article</a>
              )}
            </div>
          </div>
        ))}
        {signals.length === 0 && (
          <div className="text-center text-neutral-500 text-sm py-8">
            No training signals found. Run generation to analyse agent performance.
          </div>
        )}
      </div>
    </div>
  );
}
