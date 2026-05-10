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
  const [computing, setComputing] = useState(false);
  const [lastComputed, setLastComputed] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<keyof ImpactMetrics>('autonomous_resolution_rate');

  const fetchData = useCallback(async () => {
    try {
      const [mRes, hRes, pRes] = await Promise.all([
        fetch('/api/agent/impact'),
        fetch('/api/agent/impact/history'),
        fetch('/api/agent/escalation-policy/stats'),
      ]);
      const mData = await mRes.json();
      const hData = await hRes.json();
      const pData = await pRes.json();
      if (mData.ok) {
        setMetrics(mData.data);
        setLastComputed(mData.data?.period_end ?? null);
      }
      if (hData.ok) setHistory(hData.data ?? []);
      if (pData.ok) setPolicyStats(pData.data ?? null);
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
