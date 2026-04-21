import { useState, useEffect, useCallback } from 'react';

function apiJson(path: string, method: string, body?: unknown) {
  return fetch(`/api/agent${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json());
}

interface PipelineStat {
  pipeline_name: string;
  total_runs: number;
  successes: number;
  failures: number;
  success_rate: number;
  last_success: string | null;
  last_failure: string | null;
  last_error: string | null;
  avg_duration_ms: number | null;
}

interface PipelineRun {
  id: number;
  pipeline_name: string;
  started_at: string;
  completed_at: string | null;
  status: 'success' | 'error';
  rows_affected: number;
  error_message: string | null;
  duration_ms: number;
}

interface CompareResult {
  pipeline: string;
  days: number;
  liveRowCount: number;
  uatRowCount: number;
  valueDifferences: any[];
  onlyInLive: string[];
  onlyInUat: string[];
  match: boolean;
  error?: string;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const colors = status === 'success'
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : 'bg-red-500/20 text-red-400 border-red-500/30';
  return <span className={`px-2 py-0.5 text-xs font-medium border rounded ${colors}`}>{status}</span>;
}

function SuccessRate({ rate }: { rate: number }) {
  const color = rate >= 95 ? 'text-emerald-400' : rate >= 80 ? 'text-amber-400' : 'text-red-400';
  return <span className={`font-mono font-bold ${color}`}>{rate}%</span>;
}

function MatchBadge({ match }: { match: boolean }) {
  return match
    ? <span className="px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">MATCH</span>
    : <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded">DIFF</span>;
}

export function AgentPipelinesView() {
  const [stats, setStats] = useState<PipelineStat[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | undefined>();
  const [compareResult, setCompareResult] = useState<Record<string, CompareResult>>({});
  const [compareLoading, setCompareLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [truncating, setTruncating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, runsRes] = await Promise.all([
        apiJson('/pipeline/stats', 'GET'),
        apiJson(`/pipeline/runs${selectedPipeline ? `?pipeline=${selectedPipeline}` : ''}`, 'GET'),
      ]);
      if (statsRes.ok) setStats(statsRes.data);
      if (runsRes.ok) setRuns(runsRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedPipeline]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const runCompare = async (pipeline: string) => {
    setCompareLoading(prev => ({ ...prev, [pipeline]: true }));
    try {
      const res = await apiJson(`/pipeline/compare/${pipeline}?days=7`, 'GET');
      if (res.ok) {
        setCompareResult(prev => ({ ...prev, [pipeline]: res.data }));
      }
    } catch { /* ignore */ }
    setCompareLoading(prev => ({ ...prev, [pipeline]: false }));
  };

  const truncateUat = async () => {
    setTruncating(true);
    try {
      await apiJson('/pipeline/truncate-uat', 'POST');
      await loadData();
    } catch { /* ignore */ }
    setTruncating(false);
  };

  const COMPARE_PIPELINES = ['kpi-daily', 'kpi-agent', 'qa-results'];

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-neutral-500">Loading pipeline data...</div>;
  }

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Pipeline Monitor</h2>
          <p className="text-sm text-neutral-400">KPI and QA pipeline execution status, UAT comparison</p>
        </div>
        <button
          onClick={truncateUat}
          disabled={truncating}
          className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 disabled:opacity-50"
        >
          {truncating ? 'Truncating...' : 'Truncate UAT Tables'}
        </button>
      </div>

      {/* Pipeline Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {stats.map(s => (
          <div
            key={s.pipeline_name}
            className={`bg-neutral-800/50 border rounded-lg p-4 cursor-pointer transition hover:border-blue-500/50 ${
              selectedPipeline === s.pipeline_name ? 'border-blue-500/50 ring-1 ring-blue-500/20' : 'border-neutral-700/50'
            }`}
            onClick={() => setSelectedPipeline(prev => prev === s.pipeline_name ? undefined : s.pipeline_name)}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-white text-sm">{s.pipeline_name}</h3>
              <SuccessRate rate={s.success_rate} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-neutral-400 mb-3">
              <div>
                <div className="text-neutral-500">Total</div>
                <div className="font-mono text-white">{s.total_runs}</div>
              </div>
              <div>
                <div className="text-neutral-500">Pass</div>
                <div className="font-mono text-emerald-400">{s.successes}</div>
              </div>
              <div>
                <div className="text-neutral-500">Fail</div>
                <div className="font-mono text-red-400">{s.failures}</div>
              </div>
            </div>
            <div className="text-xs text-neutral-500 space-y-1">
              <div>Last success: <span className="text-neutral-300">{timeAgo(s.last_success)}</span></div>
              {s.avg_duration_ms != null && (
                <div>Avg duration: <span className="text-neutral-300">{Math.round(s.avg_duration_ms)}ms</span></div>
              )}
              {s.last_error && (
                <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 truncate" title={s.last_error}>
                  {s.last_error}
                </div>
              )}
            </div>
          </div>
        ))}
        {stats.length === 0 && (
          <div className="col-span-full text-center text-neutral-500 py-8">
            No pipeline runs recorded yet. Pipelines will appear here once they start executing.
          </div>
        )}
      </div>

      {/* Compare vs Live */}
      <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
        <h3 className="font-medium text-white text-sm mb-3">Compare UAT vs Live</h3>
        <div className="flex gap-2 mb-4">
          {COMPARE_PIPELINES.map(p => (
            <button
              key={p}
              onClick={() => runCompare(p)}
              disabled={compareLoading[p]}
              className="px-3 py-1.5 text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 disabled:opacity-50"
            >
              {compareLoading[p] ? 'Comparing...' : `Compare ${p}`}
            </button>
          ))}
          <button
            onClick={() => runCompare('all')}
            disabled={Object.values(compareLoading).some(v => v)}
            className="px-3 py-1.5 text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/30 disabled:opacity-50"
          >
            Compare All
          </button>
        </div>

        {Object.entries(compareResult).map(([key, result]) => {
          if ('kpi-daily' in result || 'kpi-agent' in result || 'qa-results' in result) {
            const allResults = result as unknown as Record<string, CompareResult>;
            return Object.entries(allResults).map(([subKey, subResult]) => (
              <CompareCard key={subKey} result={subResult} />
            ));
          }
          return <CompareCard key={key} result={result} />;
        })}
      </div>

      {/* Run History */}
      <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-white text-sm">
            Run History {selectedPipeline ? `— ${selectedPipeline}` : '— All Pipelines'}
          </h3>
          {selectedPipeline && (
            <button
              onClick={() => setSelectedPipeline(undefined)}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              Show all
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-700/50">
                <th className="text-left py-2 pr-4">Pipeline</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-right py-2 pr-4">Rows</th>
                <th className="text-right py-2 pr-4">Duration</th>
                <th className="text-left py-2 pr-4">Started</th>
                <th className="text-left py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} className="border-b border-neutral-800/50 hover:bg-neutral-700/20">
                  <td className="py-1.5 pr-4 text-neutral-300">{r.pipeline_name}</td>
                  <td className="py-1.5 pr-4"><StatusBadge status={r.status} /></td>
                  <td className="py-1.5 pr-4 text-right font-mono text-neutral-400">{r.rows_affected}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-neutral-400">{r.duration_ms}ms</td>
                  <td className="py-1.5 pr-4 text-neutral-500">{timeAgo(r.started_at)}</td>
                  <td className="py-1.5 text-red-400 truncate max-w-xs" title={r.error_message ?? ''}>{r.error_message ?? ''}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-neutral-500">No runs recorded</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompareCard({ result }: { result: CompareResult }) {
  const [expanded, setExpanded] = useState(false);

  if (result.error) {
    return (
      <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded">
        <span className="text-red-400 text-xs">{result.pipeline}: {result.error}</span>
      </div>
    );
  }

  return (
    <div className="mb-3 p-3 bg-neutral-900/50 border border-neutral-700/30 rounded">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{result.pipeline}</span>
          <MatchBadge match={result.match} />
          <span className="text-xs text-neutral-500">{result.days}d window</span>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-neutral-500 hover:text-neutral-300">
          {expanded ? 'Collapse' : 'Details'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <span className="text-neutral-500">Live rows:</span>{' '}
          <span className="font-mono text-neutral-300">{result.liveRowCount}</span>
        </div>
        <div>
          <span className="text-neutral-500">UAT rows:</span>{' '}
          <span className="font-mono text-neutral-300">{result.uatRowCount}</span>
        </div>
        <div>
          <span className="text-neutral-500">Diffs:</span>{' '}
          <span className={`font-mono ${result.valueDifferences.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {result.valueDifferences.length}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 text-xs">
          {result.onlyInLive.length > 0 && (
            <div>
              <span className="text-neutral-500">Only in Live ({result.onlyInLive.length}):</span>
              <div className="mt-1 max-h-32 overflow-y-auto text-red-400 font-mono">
                {result.onlyInLive.slice(0, 20).map((k, i) => <div key={i}>{k}</div>)}
                {result.onlyInLive.length > 20 && <div className="text-neutral-500">...and {result.onlyInLive.length - 20} more</div>}
              </div>
            </div>
          )}
          {result.onlyInUat.length > 0 && (
            <div>
              <span className="text-neutral-500">Only in UAT ({result.onlyInUat.length}):</span>
              <div className="mt-1 max-h-32 overflow-y-auto text-blue-400 font-mono">
                {result.onlyInUat.slice(0, 20).map((k, i) => <div key={i}>{k}</div>)}
                {result.onlyInUat.length > 20 && <div className="text-neutral-500">...and {result.onlyInUat.length - 20} more</div>}
              </div>
            </div>
          )}
          {result.valueDifferences.length > 0 && (
            <div>
              <span className="text-neutral-500">Value Differences ({result.valueDifferences.length}):</span>
              <div className="mt-1 max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="text-left py-1">Key</th>
                      <th className="text-left py-1">Live</th>
                      <th className="text-left py-1">UAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.valueDifferences.slice(0, 30).map((d, i) => (
                      <tr key={i} className="border-t border-neutral-800/30">
                        <td className="py-1 text-neutral-300 font-mono">{d.key || d.issueKey}</td>
                        <td className="py-1 text-red-400 font-mono">{JSON.stringify(d.live)}</td>
                        <td className="py-1 text-blue-400 font-mono">{JSON.stringify(d.uat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {result.match && (
            <div className="text-emerald-400">All rows match between Live and UAT</div>
          )}
        </div>
      )}
    </div>
  );
}
