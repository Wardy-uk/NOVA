import { useState, useEffect } from 'react';

interface Brief {
  id: number; agent_name: string | null; period_start: string | null;
  period_end: string | null; content: BriefContent; generated_at: string;
}

interface BriefContent {
  headline: string;
  ticket_performance: { volume: number; mttr_hours: number | null; first_response_hours: number | null; qa_average: number | null };
  trends: Array<{ metric: string; direction: string; detail: string }>;
  escalation_analysis: { count: number; appropriate_rate: number | null; detail: string };
  coaching_signals: Array<{ signal_type: string; detail: string; request_type: string | null }>;
  qa_highlights: { best: Array<{ ticket_key: string; score: number; summary: string }>; worst: Array<{ ticket_key: string; score: number; summary: string }> };
  autonomy_interaction: { approvals: number; rejections: number; detail: string } | null;
  talking_points: string[];
}

const api = async (path: string, method = 'GET') => {
  const r = await fetch(`/api/briefing/121${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  return r.json();
};

export function Briefing121View({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; period_start: string; period_end: string; generated_at: string }>>([]);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    const h = await api(`/${agentId}/history`);
    if (h.ok) setHistory(h.data ?? []);
    if (h.data?.length > 0) {
      const latest = await api(`/detail/${h.data[0].id}`);
      if (latest.ok) setBrief(latest.data);
    }
  };

  useEffect(() => { load(); }, [agentId]);

  const generate = async () => {
    setGenerating(true);
    const r = await api(`/${agentId}?name=${encodeURIComponent(agentName)}`, 'POST');
    if (r.ok) setBrief(r.data);
    setGenerating(false);
    load();
  };

  const loadById = async (id: number) => {
    const r = await api(`/detail/${id}`);
    if (r.ok) setBrief(r.data);
  };

  const trendIcon = (d: string) => {
    switch (d) {
      case 'improving': return { symbol: '↑', color: 'text-green-400' };
      case 'declining': return { symbol: '↓', color: 'text-red-400' };
      default: return { symbol: '→', color: 'text-neutral-400' };
    }
  };

  const c = brief?.content;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          <h3 className="text-sm font-medium text-neutral-200">1-2-1 Brief: {agentName}</h3>
          {history.length > 0 && (
            <select onChange={e => loadById(parseInt(e.target.value, 10))} value={brief?.id ?? ''}
              className="bg-[#2f353d] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d]">
              {history.map(h => (
                <option key={h.id} value={h.id}>{h.period_start} — {h.period_end}</option>
              ))}
            </select>
          )}
        </div>
        <button onClick={generate} disabled={generating}
          className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
          {generating ? 'Generating...' : 'Prepare 1-2-1 Brief'}
        </button>
      </div>

      {c ? (
        <>
          <div className="bg-[#2f353d] rounded-lg p-4">
            <h2 className="text-base font-medium text-neutral-200">{c.headline}</h2>
            <span className="text-xs text-neutral-500">{brief!.period_start} to {brief!.period_end}</span>
          </div>

          {/* Performance */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-neutral-200">{c.ticket_performance.volume}</div>
              <div className="text-xs text-neutral-400">Tickets</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-neutral-200">{c.ticket_performance.mttr_hours?.toFixed(1) ?? '-'}h</div>
              <div className="text-xs text-neutral-400">MTTR</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-neutral-200">{c.escalation_analysis.count}</div>
              <div className="text-xs text-neutral-400">Escalations</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-neutral-200">{c.ticket_performance.qa_average?.toFixed(0) ?? '-'}</div>
              <div className="text-xs text-neutral-400">QA Average</div>
            </div>
          </div>

          {/* Trends */}
          {c.trends.length > 0 && (
            <div className="bg-[#2f353d] rounded-lg p-4">
              <h4 className="text-xs font-medium text-neutral-400 mb-2">Trends</h4>
              {c.trends.map((t, i) => {
                const icon = trendIcon(t.direction);
                return (
                  <div key={i} className="flex items-center gap-2 text-xs mb-1">
                    <span className={icon.color}>{icon.symbol}</span>
                    <span className="text-neutral-300">{t.metric}:</span>
                    <span className="text-neutral-400">{t.detail}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Coaching Signals */}
          {c.coaching_signals.length > 0 && (
            <div className="bg-amber-900/20 rounded-lg p-4">
              <h4 className="text-xs font-medium text-amber-400 mb-2">Coaching Signals</h4>
              {c.coaching_signals.map((s, i) => (
                <div key={i} className="text-xs text-neutral-300 mb-1">
                  <span className="text-amber-400">{s.signal_type}</span>
                  {s.request_type && <span className="text-neutral-500"> ({s.request_type})</span>}
                  : {s.detail}
                </div>
              ))}
            </div>
          )}

          {/* QA Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#2f353d] rounded-lg p-4">
              <h4 className="text-xs font-medium text-green-400 mb-2">Best QA Tickets</h4>
              {c.qa_highlights.best.map(t => (
                <div key={t.ticket_key} className="text-xs mb-1">
                  <span className="text-neutral-200">{t.ticket_key}</span>
                  <span className="text-green-400 ml-1">({t.score})</span>
                  <span className="text-neutral-500 ml-1 truncate">{t.summary}</span>
                </div>
              ))}
              {c.qa_highlights.best.length === 0 && <span className="text-xs text-neutral-500">No data</span>}
            </div>
            <div className="bg-[#2f353d] rounded-lg p-4">
              <h4 className="text-xs font-medium text-red-400 mb-2">Weakest QA Tickets</h4>
              {c.qa_highlights.worst.map(t => (
                <div key={t.ticket_key} className="text-xs mb-1">
                  <span className="text-neutral-200">{t.ticket_key}</span>
                  <span className="text-red-400 ml-1">({t.score})</span>
                  <span className="text-neutral-500 ml-1 truncate">{t.summary}</span>
                </div>
              ))}
              {c.qa_highlights.worst.length === 0 && <span className="text-xs text-neutral-500">No data</span>}
            </div>
          </div>

          {/* Talking Points */}
          <div className="bg-[#5ec1ca]/10 rounded-lg p-4">
            <h4 className="text-xs font-medium text-[#5ec1ca] mb-2">Suggested Talking Points</h4>
            <ul className="space-y-1">
              {c.talking_points.map((tp, i) => (
                <li key={i} className="text-xs text-neutral-300 flex items-start gap-2">
                  <span className="text-[#5ec1ca]">{i + 1}.</span> {tp}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="text-center text-neutral-500 text-sm py-8">
          Click "Prepare 1-2-1 Brief" to generate a meeting prep brief for {agentName}.
        </div>
      )}
    </div>
  );
}
