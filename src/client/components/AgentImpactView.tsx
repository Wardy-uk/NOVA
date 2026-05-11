import { useState, useEffect, useCallback } from 'react';

interface ImpactMetrics {
  period_start: string;
  period_end: string;
  autonomous_resolution_rate: number;
  deflection_rate: number;
  queue_hours_saved: number;
  approval_rate: number;
  reversal_rate: number;
  assignment_automation_rate: number;
  kb_coverage_delta: number;
  escalation_accuracy: number;
}

interface TimeSavedBucket {
  total_minutes: number;
  today_minutes: number;
  by_action: Array<{ action: string; minutes: number; count: number }>;
}

interface TimeSavedStats {
  total_minutes: number;
  today_minutes: number;
  by_action: Array<{ action: string; minutes: number; count: number }>;
  daily_trend: Array<{ day: string; minutes: number; count: number }>;
  actual?: TimeSavedBucket;
  potential?: TimeSavedBucket;
  daily_trend_split?: Array<{ day: string; actual_minutes: number; potential_minutes: number }>;
}

interface PolicyStats {
  total: number;
  blocked: number;
  allowed: number;
  override: number;
  avg_evidence_score: number;
}

const METRIC_CONFIG: Array<{
  key: keyof ImpactMetrics;
  label: string;
  format: 'pct' | 'num';
  invertRag?: boolean;
}> = [
  { key: 'autonomous_resolution_rate', label: 'Autonomous Resolution Rate', format: 'pct' },
  { key: 'deflection_rate', label: 'Deflection Rate', format: 'pct' },
  { key: 'queue_hours_saved', label: 'Queue Hours Saved', format: 'num' },
  { key: 'approval_rate', label: 'Approval Rate', format: 'pct' },
  { key: 'reversal_rate', label: 'Reversal Rate', format: 'pct', invertRag: true },
  { key: 'assignment_automation_rate', label: 'Assignment Automation Rate', format: 'pct' },
  { key: 'kb_coverage_delta', label: 'KB Coverage Delta', format: 'pct' },
  { key: 'escalation_accuracy', label: 'Escalation Accuracy', format: 'pct' },
];

function formatValue(val: number, format: 'pct' | 'num'): string {
  if (format === 'pct') return `${(val * 100).toFixed(1)}%`;
  return val.toFixed(1);
}

function ragColor(current: number, previous: number, invert?: boolean): string {
  const delta = current - previous;
  const effectiveDelta = invert ? -delta : delta;
  if (effectiveDelta > 0.02) return 'text-green-400';
  if (effectiveDelta < -0.02) return 'text-red-400';
  return 'text-yellow-400';
}

function trendArrow(current: number, previous: number): string {
  const delta = current - previous;
  if (delta > 0.005) return '↑';
  if (delta < -0.005) return '↓';
  return '→';
}

export function AgentImpactView() {
  const [metrics, setMetrics] = useState<ImpactMetrics | null>(null);
  const [history, setHistory] = useState<ImpactMetrics[]>([]);
  const [policyStats, setPolicyStats] = useState<PolicyStats | null>(null);
  const [timeSaved, setTimeSaved] = useState<TimeSavedStats | null>(null);
  const [computing, setComputing] = useState(false);
  const [lastComputed, setLastComputed] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<keyof ImpactMetrics>('autonomous_resolution_rate');

  const fetchData = useCallback(async () => {
    try {
      const [mRes, hRes, pRes, tsRes] = await Promise.all([
        fetch('/api/agent/impact'),
        fetch('/api/agent/impact/history'),
        fetch('/api/agent/escalation-policy/stats'),
        fetch('/api/agent/impact/time-saved?days=30'),
      ]);
      const mData = await mRes.json();
      const hData = await hRes.json();
      const pData = await pRes.json();
      const tsData = await tsRes.json();
      if (mData.ok) {
        setMetrics(mData.data);
        setLastComputed(mData.data?.period_end ?? null);
      }
      if (hData.ok) setHistory(hData.data ?? []);
      if (pData.ok) setPolicyStats(pData.data ?? null);
      if (tsData.ok) setTimeSaved(tsData.data ?? null);
    } catch (err) {
      console.error('Failed to fetch impact data:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const computeNow = async () => {
    setComputing(true);
    try {
      const res = await fetch('/api/agent/impact/compute', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Compute failed:', err);
    } finally {
      setComputing(false);
    }
  };

  const previousMetrics = history.length > 1 ? history[1] : null;

  const kpiCards: Array<{ label: string; key: keyof ImpactMetrics; format: 'pct' | 'num' }> = [
    { label: 'Autonomous Resolution', key: 'autonomous_resolution_rate', format: 'pct' },
    { label: 'Approval Rate', key: 'approval_rate', format: 'pct' },
    { label: 'Queue Hours Saved', key: 'queue_hours_saved', format: 'num' },
    { label: 'Escalation Accuracy', key: 'escalation_accuracy', format: 'pct' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">AI Agent Impact</h2>
        <div className="flex items-center gap-3">
          {lastComputed && (
            <span className="text-xs text-zinc-500">
              Last computed: {new Date(lastComputed).toLocaleString()}
            </span>
          )}
          <button
            onClick={computeNow}
            disabled={computing}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white rounded transition-colors"
          >
            {computing ? 'Computing...' : 'Compute Now'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {kpiCards.map(card => {
          const current = metrics?.[card.key] as number | undefined;
          const prev = previousMetrics?.[card.key] as number | undefined;
          return (
            <div key={card.key} className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
              <div className="text-xs text-zinc-400 mb-1">{card.label}</div>
              <div className="text-2xl font-bold text-white">
                {current != null ? formatValue(current, card.format) : '—'}
              </div>
              {current != null && prev != null && (
                <div className={`text-sm mt-1 ${ragColor(current, prev)}`}>
                  {trendArrow(current, prev)} vs last week
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time Saved */}
      {timeSaved && (() => {
        const act = timeSaved.actual;
        const pot = timeSaved.potential;
        const hasSplit = !!(act && pot);
        const fmtMins = (m: number) => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`;

        // Merge by_action from actual + potential for dual-bar display
        const actionMap = new Map<string, { actual: number; actualCount: number; potential: number; potentialCount: number }>();
        if (hasSplit) {
          for (const a of act.by_action) actionMap.set(a.action, { actual: a.minutes, actualCount: a.count, potential: 0, potentialCount: 0 });
          for (const a of pot.by_action) {
            const existing = actionMap.get(a.action) ?? { actual: 0, actualCount: 0, potential: 0, potentialCount: 0 };
            existing.potential = a.minutes;
            existing.potentialCount = a.count;
            actionMap.set(a.action, existing);
          }
        }
        const mergedActions = [...actionMap.entries()].sort((a, b) => (b[1].actual + b[1].potential) - (a[1].actual + a[1].potential));
        const maxActionMins = mergedActions.length > 0 ? Math.max(...mergedActions.map(([, v]) => v.actual + v.potential), 1) : 1;

        const dailySplit = timeSaved.daily_trend_split;

        return (
        <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
          <h3 className="text-sm font-medium text-white mb-3">Time Saved by AI Agent</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-xs text-zinc-400">Today</div>
              <div className="text-2xl font-bold text-green-400">
                {fmtMins(hasSplit ? act.today_minutes : timeSaved.today_minutes)}
              </div>
              {hasSplit && pot.today_minutes > 0 && (
                <div className="text-xs text-amber-400/70 mt-0.5">+{fmtMins(pot.today_minutes)} potential</div>
              )}
            </div>
            <div>
              <div className="text-xs text-zinc-400">Last 30 Days</div>
              <div className="text-2xl font-bold text-white">
                {fmtMins(hasSplit ? act.total_minutes : timeSaved.total_minutes)}
              </div>
              {hasSplit && pot.total_minutes > 0 && (
                <div className="text-xs text-amber-400/70 mt-0.5">+{fmtMins(pot.total_minutes)} potential</div>
              )}
            </div>
            <div>
              <div className="text-xs text-zinc-400">Equivalent FTE Days</div>
              <div className="text-2xl font-bold text-white">
                {((hasSplit ? act.total_minutes : timeSaved.total_minutes) / 480).toFixed(1)}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">actual only</div>
            </div>
          </div>

          {/* By Action — dual bars when split available */}
          {hasSplit && mergedActions.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs text-zinc-400 mb-1">By Action Type</div>
              {mergedActions.map(([action, v]) => {
                const totalMins = v.actual + v.potential;
                const actualPct = (v.actual / maxActionMins) * 100;
                const potentialPct = (v.potential / maxActionMins) * 100;
                return (
                  <div key={action} className="flex items-center gap-2 text-xs">
                    <span className="w-28 text-zinc-300 truncate">{action}</span>
                    <div className="flex-1 h-3 bg-zinc-700 rounded overflow-hidden flex">
                      <div className="h-full bg-green-600" style={{ width: `${actualPct}%` }} />
                      <div className="h-full bg-amber-600/50" style={{ width: `${potentialPct}%` }} />
                    </div>
                    <span className="w-14 text-right text-zinc-400 font-mono">{fmtMins(totalMins)}</span>
                    <span className="w-20 text-right text-zinc-500 font-mono text-[10px]">
                      {v.actualCount + v.potentialCount}x ({v.actualCount} done)
                    </span>
                  </div>
                );
              })}
              <div className="flex gap-4 text-[10px] text-zinc-500 mt-2">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-600 inline-block" /> Executed</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-600/50 inline-block" /> Pending/Declined</span>
              </div>
            </div>
          ) : timeSaved.by_action.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-zinc-400 mb-1">By Action Type</div>
              {timeSaved.by_action.map(a => {
                const pct = timeSaved.total_minutes > 0 ? (a.minutes / timeSaved.total_minutes) * 100 : 0;
                return (
                  <div key={a.action} className="flex items-center gap-2 text-xs">
                    <span className="w-28 text-zinc-300 truncate">{a.action}</span>
                    <div className="flex-1 h-3 bg-zinc-700 rounded overflow-hidden">
                      <div className="h-full bg-green-600 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 text-right text-zinc-400 font-mono">{fmtMins(a.minutes)}</span>
                    <span className="w-12 text-right text-zinc-500 font-mono">{a.count}x</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Daily Trend — stacked when split available */}
          {dailySplit && dailySplit.length > 1 ? (
            <div className="mt-4">
              <div className="text-xs text-zinc-400 mb-2">Daily Trend (30d)</div>
              <div className="h-24 flex items-end gap-px">
                {dailySplit.map(d => {
                  const max = Math.max(...dailySplit.map(t => t.actual_minutes + t.potential_minutes), 1);
                  const actualH = (d.actual_minutes / max) * 100;
                  const potentialH = (d.potential_minutes / max) * 100;
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center justify-end"
                      title={`${d.day}: ${Math.round(d.actual_minutes)}min actual, ${Math.round(d.potential_minutes)}min potential`}>
                      <div className="w-full bg-amber-600/40 rounded-t min-h-0"
                        style={{ height: `${potentialH}%` }} />
                      <div className="w-full bg-green-600/70 min-h-[2px]"
                        style={{ height: `${Math.max(actualH, 2)}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-zinc-500 mt-1">
                <span>{dailySplit[0]?.day.slice(5)}</span>
                <span>{dailySplit[dailySplit.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          ) : timeSaved.daily_trend.length > 1 && (
            <div className="mt-4">
              <div className="text-xs text-zinc-400 mb-2">Daily Trend (30d)</div>
              <div className="h-24 flex items-end gap-px">
                {timeSaved.daily_trend.map(d => {
                  const max = Math.max(...timeSaved.daily_trend.map(t => t.minutes), 1);
                  const heightPct = (d.minutes / max) * 100;
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center justify-end"
                      title={`${d.day}: ${Math.round(d.minutes)}min (${d.count} actions)`}>
                      <div className="w-full bg-green-600/70 rounded-t min-h-[2px]"
                        style={{ height: `${Math.max(heightPct, 2)}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-zinc-500 mt-1">
                <span>{timeSaved.daily_trend[0]?.day.slice(5)}</span>
                <span>{timeSaved.daily_trend[timeSaved.daily_trend.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* Trend Chart */}
      {history.length > 1 && (
        <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white">Trend (Last {history.length} Weeks)</h3>
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value as keyof ImpactMetrics)}
              className="bg-zinc-700 text-white text-xs rounded px-2 py-1 border border-zinc-600"
            >
              {METRIC_CONFIG.map(m => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="h-40 flex items-end gap-1">
            {[...history].reverse().map((snap, i) => {
              const val = snap[selectedMetric] as number;
              const cfg = METRIC_CONFIG.find(m => m.key === selectedMetric);
              const maxVal = Math.max(...history.map(h => h[selectedMetric] as number), 0.01);
              const heightPct = (val / maxVal) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-zinc-400">{formatValue(val, cfg?.format ?? 'pct')}</div>
                  <div
                    className="w-full bg-indigo-500 rounded-t transition-all"
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                    title={`${snap.period_start?.slice(0, 10)} — ${formatValue(val, cfg?.format ?? 'pct')}`}
                  />
                  <div className="text-[9px] text-zinc-500 truncate w-full text-center">
                    {snap.period_start?.slice(5, 10)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Metrics Table */}
      <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-zinc-400">
              <th className="text-left px-4 py-2">Metric</th>
              <th className="text-right px-4 py-2">Current</th>
              <th className="text-right px-4 py-2">Previous</th>
              <th className="text-right px-4 py-2">Delta</th>
              <th className="text-center px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_CONFIG.map(cfg => {
              const current = metrics?.[cfg.key] as number | undefined;
              const prev = previousMetrics?.[cfg.key] as number | undefined;
              const delta = current != null && prev != null ? current - prev : null;
              const color = current != null && prev != null ? ragColor(current, prev, cfg.invertRag) : 'text-zinc-500';
              return (
                <tr key={cfg.key} className="border-b border-zinc-700/50 hover:bg-zinc-700/30">
                  <td className="px-4 py-2 text-white">{cfg.label}</td>
                  <td className="px-4 py-2 text-right text-white font-mono">
                    {current != null ? formatValue(current, cfg.format) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400 font-mono">
                    {prev != null ? formatValue(prev, cfg.format) : '—'}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${color}`}>
                    {delta != null ? `${delta >= 0 ? '+' : ''}${formatValue(delta, cfg.format)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {current != null && prev != null && (
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        color.includes('green') ? 'bg-green-400' :
                        color.includes('red') ? 'bg-red-400' : 'bg-yellow-400'
                      }`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Escalation Policy Summary */}
      {policyStats && (
        <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
          <h3 className="text-sm font-medium text-white mb-3">Escalation Policy (This Week)</h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-zinc-400">Total Evaluations</div>
              <div className="text-lg font-bold text-white">{policyStats.total}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">Blocked</div>
              <div className="text-lg font-bold text-red-400">{policyStats.blocked}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">Allowed</div>
              <div className="text-lg font-bold text-green-400">{policyStats.allowed}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">Avg Evidence Score</div>
              <div className="text-lg font-bold text-white">{(policyStats.avg_evidence_score * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
