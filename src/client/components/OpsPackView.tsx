import { useState, useEffect } from 'react';

interface OpsPack {
  id: number; period_start: string | null; period_end: string | null;
  content: OpsPackContent; generated_at: string;
}

interface OpsPackContent {
  headline: string;
  queue_health: { total_volume: number; resolved: number; resolution_rate: number; avg_handle_hours: number | null; queue_depth: number; trend_vs_last_week: string };
  sla_compliance: { frt_rate: number | null; resolution_rate: number | null };
  shift_left: { cc_resolved_pct: number; trend: string };
  ai_impact: { autonomous_rate: number | null; decisions_count: number };
  decisions_needed: Array<{ title: string; context: string; recommendation: string; ticket_keys: string[] }>;
  team_performance: Array<{ agent_name: string; volume: number; qa_avg: number | null; status: string }>;
  incidents_this_week: Array<{ summary: string; ticket_count: number; status: string }>;
  next_week_outlook: string;
}

const api = async (path: string, method = 'GET') => {
  const r = await fetch(`/api/ops-pack${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` },
  });
  return r.json();
};

export function OpsPackView() {
  const [pack, setPack] = useState<OpsPack | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; period_start: string; period_end: string; generated_at: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [l, h] = await Promise.all([api('/latest'), api('/history')]);
    if (l.ok) setPack(l.data);
    if (h.ok) setHistory(h.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await api('/generate', 'POST');
      if (r.ok) {
        setPack(r.data);
      } else {
        setError(r.error ?? 'Failed to generate ops pack');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    }
    setGenerating(false);
    load();
  };

  const loadById = async (id: number) => {
    const r = await api(`/${id}`);
    if (r.ok) setPack(r.data);
  };

  const pct = (v: number | null) => v !== null ? `${(v * 100).toFixed(0)}%` : 'N/A';
  const statusColor = (s: string) => s === 'ahead' ? 'text-green-400' : s === 'needs_support' ? 'text-red-400' : 'text-neutral-300';

  const c = pack?.content;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          {history.length > 0 && (
            <select onChange={e => loadById(parseInt(e.target.value, 10))} value={pack?.id ?? ''}
              className="bg-[#2f353d] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d]">
              {history.map(h => (
                <option key={h.id} value={h.id}>{h.period_start} to {h.period_end}</option>
              ))}
            </select>
          )}
        </div>
        <button onClick={generate} disabled={generating}
          className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
          {generating ? 'Generating...' : 'Generate Pack'}
        </button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/40 rounded-lg px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {c ? (
        <>
          <div className="bg-[#2f353d] rounded-lg p-4">
            <h2 className="text-lg font-medium text-neutral-200">{c.headline}</h2>
            <span className="text-xs text-neutral-500">{pack!.period_start} to {pack!.period_end}</span>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-neutral-200">{c.queue_health.total_volume}</div>
              <div className="text-xs text-neutral-400">Total Volume</div>
              <div className="text-xs text-neutral-500">{c.queue_health.trend_vs_last_week}</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{pct(c.queue_health.resolution_rate)}</div>
              <div className="text-xs text-neutral-400">Resolution Rate</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-[#5ec1ca]">{pct(c.shift_left.cc_resolved_pct)}</div>
              <div className="text-xs text-neutral-400">Shift-Left</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">{c.queue_health.queue_depth}</div>
              <div className="text-xs text-neutral-400">Queue Depth</div>
            </div>
          </div>

          {/* Decisions Needed */}
          {c.decisions_needed.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-200 mb-3">Decisions Needed</h3>
              <div className="space-y-2">
                {c.decisions_needed.map((d, i) => (
                  <div key={i} className="bg-[#2f353d] rounded-lg p-4">
                    <div className="text-sm font-medium text-neutral-200">{d.title}</div>
                    <p className="text-xs text-neutral-400 mt-1">{d.context}</p>
                    <p className="text-xs text-[#5ec1ca] mt-1">{d.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Team Performance */}
          <div>
            <h3 className="text-sm font-medium text-neutral-200 mb-3">Team Performance</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#3a424d]">
                    <th className="text-left py-2 px-2 text-neutral-400 font-medium">Agent</th>
                    <th className="text-right py-2 px-2 text-neutral-400 font-medium">Volume</th>
                    <th className="text-right py-2 px-2 text-neutral-400 font-medium">QA Avg</th>
                    <th className="text-center py-2 px-2 text-neutral-400 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {c.team_performance.map(a => (
                    <tr key={a.agent_name} className="border-b border-[#3a424d]/50">
                      <td className="py-2 px-2 text-neutral-200">{a.agent_name}</td>
                      <td className="py-2 px-2 text-right text-neutral-300">{a.volume}</td>
                      <td className="py-2 px-2 text-right text-neutral-300">{a.qa_avg?.toFixed(0) ?? '-'}</td>
                      <td className={`py-2 px-2 text-center ${statusColor(a.status)}`}>{a.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Incidents */}
          {c.incidents_this_week.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-200 mb-3">Incidents This Week</h3>
              <div className="space-y-2">
                {c.incidents_this_week.map((inc, i) => (
                  <div key={i} className="bg-[#2f353d] rounded-lg p-3 flex items-center justify-between">
                    <span className="text-xs text-neutral-200">{inc.summary}</span>
                    <div className="flex gap-2 text-xs">
                      <span className="text-neutral-400">{inc.ticket_count} tickets</span>
                      <span className={inc.status === 'open' ? 'text-red-400' : 'text-green-400'}>{inc.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outlook */}
          <div className="bg-[#2f353d] rounded-lg p-4">
            <h3 className="text-sm font-medium text-neutral-200 mb-2">Next Week Outlook</h3>
            <p className="text-xs text-neutral-300">{c.next_week_outlook}</p>
          </div>
        </>
      ) : (
        <div className="text-center text-neutral-500 text-sm py-8">
          No ops pack available. Click "Generate Pack" to create a weekly operational meeting pack.
        </div>
      )}
    </div>
  );
}
