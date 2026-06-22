import { useState, useEffect, useCallback, useRef } from 'react';

function apiJson(path: string, method: string, body?: unknown) {
  return fetch(`/api/agent${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json());
}

interface ColumnDrift {
  column: string;
  matchCount: number;
  diffCount: number;
  driftPct: number;
}

interface ComparisonResult {
  table: string;
  days: number;
  liveRowCount: number;
  uatRowCount: number;
  matchedRows: number;
  matchPct: number;
  onlyInLive: any[];
  onlyInUat: any[];
  valueDiffs: any[];
  columnDrift: ColumnDrift[];
  sampleDiffs: any[];
  fetchedAt: string;
}

const TABLES = [
  { value: 'jira_kpi_daily', label: 'KPI Daily', keyCol: 'kpi + ReportDate' },
  { value: 'jira_agent_kpi_daily', label: 'Agent KPI Daily', keyCol: 'AgentName + ReportDate' },
  { value: 'KpiSnapshot', label: 'KPI Snapshot', keyCol: 'KPI + CreatedAt' },
  { value: 'jira_qa_results', label: 'QA Results', keyCol: 'issueKey' },
  { value: 'Jira_QA_GoldenRules', label: 'QA Golden Rules', keyCol: 'IssueKey' },
  { value: 'jira_kpi_digest', label: 'KPI Digest', keyCol: 'period + CreatedAt' },
];

const PIPELINES: { key: string; label: string; default: 'live' | 'uat' }[] = [
  { key: 'kpi', label: 'KPI', default: 'live' },
  { key: 'qa', label: 'QA Scoring', default: 'uat' },
  { key: 'gr', label: 'Golden Rules', default: 'uat' },
];

const DATE_RANGES = [
  { value: 1, label: 'Today' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
];

function MatchBadge({ pct }: { pct: number }) {
  const color = pct >= 99 ? 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30'
    : pct >= 90 ? 'text-amber-400 bg-amber-500/20 border-amber-500/30'
    : 'text-red-400 bg-red-500/20 border-red-500/30';
  return <span className={`px-2 py-0.5 text-xs font-mono font-bold border rounded ${color}`}>{pct.toFixed(1)}%</span>;
}

function DriftBar({ pct }: { pct: number }) {
  const color = pct === 0 ? 'bg-emerald-500' : pct < 5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-neutral-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-mono text-neutral-400">{pct.toFixed(1)}%</span>
    </div>
  );
}

export function UatComparisonView() {
  const [selectedTable, setSelectedTable] = useState(TABLES[0].value);
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [countdown, setCountdown] = useState(0);
  const [allResults, setAllResults] = useState<ComparisonResult[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [targets, setTargets] = useState<Record<string, 'live' | 'uat'>>({});
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTargets = useCallback(async () => {
    try {
      const res = await apiJson('/pipeline/targets', 'GET');
      if (res.ok) setTargets(res.data);
    } catch { /* ignore */ }
  }, []);

  const setTarget = useCallback(async (pipeline: string, target: 'live' | 'uat') => {
    setSavingTarget(pipeline);
    const prev = targets[pipeline];
    setTargets(t => ({ ...t, [pipeline]: target })); // optimistic
    try {
      const res = await apiJson('/pipeline/target', 'POST', { pipeline, target });
      if (!res.ok) setTargets(t => ({ ...t, [pipeline]: prev })); // revert on failure
    } catch {
      setTargets(t => ({ ...t, [pipeline]: prev }));
    }
    setSavingTarget(null);
  }, [targets]);

  const fetchComparison = useCallback(async (table: string, numDays: number) => {
    setLoading(true);
    try {
      const res = await apiJson(`/pipeline/uat-compare?table=${table}&days=${numDays}`, 'GET');
      if (res.ok) {
        setResult(res.data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoadingAll(true);
    const results: ComparisonResult[] = [];
    for (const t of TABLES) {
      try {
        const res = await apiJson(`/pipeline/uat-compare?table=${t.value}&days=${days}`, 'GET');
        if (res.ok) results.push(res.data);
      } catch { /* ignore */ }
    }
    setAllResults(results);
    setLoadingAll(false);
  }, [days]);

  useEffect(() => {
    fetchComparison(selectedTable, days);
  }, [selectedTable, days, fetchComparison]);

  useEffect(() => { fetchTargets(); }, [fetchTargets]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      setCountdown(0);
      return;
    }
    setCountdown(refreshInterval);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchComparison(selectedTable, days);
          return refreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshInterval, selectedTable, days, fetchComparison]);

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">UAT vs Live Comparison</h2>
          <p className="text-sm text-neutral-400">Side-by-side validation of NOVA pipeline output against n8n production data</p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loadingAll}
          className="px-3 py-1.5 text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/30 disabled:opacity-50"
        >
          {loadingAll ? 'Comparing all...' : 'Compare All Tables'}
        </button>
      </div>

      {/* Pipeline source toggles — where each pipeline writes: UAT shadow tables or live n8n tables */}
      <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-white">Pipeline Source</h3>
          <span className="text-xs text-neutral-500">Live = writes to the production tables n8n uses. Switching takes effect on the next scheduled run.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PIPELINES.map(p => {
            const current = targets[p.key] ?? p.default;
            return (
              <div key={p.key} className="flex items-center gap-2 bg-neutral-900/50 border border-neutral-700/40 rounded px-2.5 py-1.5">
                <span className="text-xs font-medium text-neutral-300 w-28">{p.label}</span>
                <div className="flex">
                  {(['uat', 'live'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => current !== t && setTarget(p.key, t)}
                      disabled={savingTarget === p.key}
                      className={`px-2.5 py-1 text-xs font-medium border first:rounded-l last:rounded-r -ml-px first:ml-0 disabled:opacity-50 ${
                        current === t
                          ? t === 'live'
                            ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40 z-10'
                            : 'bg-blue-500/25 text-blue-300 border-blue-500/40 z-10'
                          : 'bg-neutral-800 text-neutral-500 border-neutral-700 hover:text-neutral-300'
                      }`}
                    >
                      {t === 'live' ? 'Live' : 'UAT'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">Table:</label>
          <select
            value={selectedTable}
            onChange={e => setSelectedTable(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 text-neutral-300 text-xs rounded px-2 py-1.5"
          >
            {TABLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs text-neutral-500">Range:</label>
          {DATE_RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`px-2 py-1 text-xs rounded ${days === r.value
                ? 'bg-blue-500/30 text-blue-400 border border-blue-500/40'
                : 'bg-neutral-800 text-neutral-500 border border-neutral-700 hover:text-neutral-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded bg-neutral-800 border-neutral-600"
            />
            Auto-refresh
          </label>
          {autoRefresh && (
            <>
              <select
                value={refreshInterval}
                onChange={e => { setRefreshInterval(Number(e.target.value)); setCountdown(Number(e.target.value)); }}
                className="bg-neutral-900 border border-neutral-700 text-neutral-400 text-xs rounded px-1 py-0.5"
              >
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={120}>2m</option>
                <option value={300}>5m</option>
              </select>
              <span className="text-xs font-mono text-neutral-600">{countdown}s</span>
            </>
          )}
        </div>

        <button
          onClick={() => fetchComparison(selectedTable, days)}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 disabled:opacity-50"
        >
          {loading ? 'Comparing...' : 'Refresh'}
        </button>
      </div>

      {/* All-Tables Summary (when Compare All clicked) */}
      {allResults.length > 0 && (
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-white mb-3">All Tables Summary — {days}d window</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {allResults.map(r => (
              <div
                key={r.table}
                onClick={() => { setSelectedTable(r.table); setAllResults([]); }}
                className="bg-neutral-900/50 border border-neutral-700/30 rounded p-3 cursor-pointer hover:border-blue-500/40 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-white">{r.table}</span>
                  <MatchBadge pct={r.matchPct} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-neutral-500">Live:</span> <span className="font-mono text-neutral-300">{r.liveRowCount}</span></div>
                  <div><span className="text-neutral-500">UAT:</span> <span className="font-mono text-neutral-300">{r.uatRowCount}</span></div>
                  <div><span className="text-neutral-500">Diffs:</span> <span className="font-mono text-amber-400">{r.valueDiffs.length}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Single Table Detail */}
      {result && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Live Rows" value={result.liveRowCount} />
            <StatCard label="UAT Rows" value={result.uatRowCount} />
            <StatCard label="Matched" value={result.matchedRows} accent={result.matchPct >= 99 ? 'green' : result.matchPct >= 90 ? 'amber' : 'red'} />
            <StatCard label="Match %" value={`${result.matchPct.toFixed(1)}%`} accent={result.matchPct >= 99 ? 'green' : result.matchPct >= 90 ? 'amber' : 'red'} />
            <StatCard label="Value Diffs" value={result.valueDiffs.length} accent={result.valueDiffs.length === 0 ? 'green' : 'amber'} />
          </div>

          {/* Column Drift */}
          {result.columnDrift.length > 0 && (
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-white mb-3">Column-Level Drift</h3>
              <div className="space-y-2">
                {result.columnDrift.map(c => (
                  <div key={c.column} className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 w-40 truncate font-mono">{c.column}</span>
                    <DriftBar pct={c.driftPct} />
                    <span className="text-xs text-neutral-500">{c.diffCount}/{c.matchCount + c.diffCount} rows differ</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing Rows */}
          {(result.onlyInLive.length > 0 || result.onlyInUat.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.onlyInLive.length > 0 && (
                <div className="bg-neutral-800/50 border border-red-500/20 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-red-400 mb-2">Only in Live ({result.onlyInLive.length})</h3>
                  <p className="text-xs text-neutral-500 mb-2">Rows in live data not yet produced by NOVA pipeline</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {result.onlyInLive.slice(0, 50).map((key, i) => (
                      <div key={i} className="text-xs font-mono text-red-400/80">{typeof key === 'string' ? key : JSON.stringify(key)}</div>
                    ))}
                    {result.onlyInLive.length > 50 && <div className="text-xs text-neutral-600">...and {result.onlyInLive.length - 50} more</div>}
                  </div>
                </div>
              )}
              {result.onlyInUat.length > 0 && (
                <div className="bg-neutral-800/50 border border-blue-500/20 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-blue-400 mb-2">Only in UAT ({result.onlyInUat.length})</h3>
                  <p className="text-xs text-neutral-500 mb-2">Rows produced by NOVA but not in n8n live data</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {result.onlyInUat.slice(0, 50).map((key, i) => (
                      <div key={i} className="text-xs font-mono text-blue-400/80">{typeof key === 'string' ? key : JSON.stringify(key)}</div>
                    ))}
                    {result.onlyInUat.length > 50 && <div className="text-xs text-neutral-600">...and {result.onlyInUat.length - 50} more</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Value Differences Table */}
          {result.sampleDiffs.length > 0 && (
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-white mb-3">Value Differences (sample of {Math.min(result.sampleDiffs.length, 50)})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-neutral-500 border-b border-neutral-700/50">
                      <th className="text-left py-2 pr-3">Row Key</th>
                      <th className="text-left py-2 pr-3">Column</th>
                      <th className="text-left py-2 pr-3">Live Value</th>
                      <th className="text-left py-2 pr-3">UAT Value</th>
                      <th className="text-right py-2">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sampleDiffs.slice(0, 50).map((d, i) => (
                      <tr key={i} className="border-b border-neutral-800/30 hover:bg-neutral-700/20">
                        <td className="py-1.5 pr-3 text-neutral-300 font-mono">{d.key}</td>
                        <td className="py-1.5 pr-3 text-neutral-400">{d.column}</td>
                        <td className="py-1.5 pr-3 text-red-400 font-mono">{String(d.liveValue)}</td>
                        <td className="py-1.5 pr-3 text-blue-400 font-mono">{String(d.uatValue)}</td>
                        <td className="py-1.5 text-right font-mono text-amber-400">{d.delta != null ? d.delta : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Perfect Match Banner */}
          {result.matchPct === 100 && result.liveRowCount > 0 && result.uatRowCount > 0 && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
              <div className="text-emerald-400 font-semibold">100% Match</div>
              <div className="text-xs text-emerald-400/70 mt-1">
                NOVA pipeline output is identical to n8n live data for {result.table} over the last {result.days} days.
                Safe to cut over.
              </div>
            </div>
          )}

          <div className="text-xs text-neutral-600 text-right">Last fetched: {result.fetchedAt}</div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: 'green' | 'amber' | 'red' }) {
  const valueColor = accent === 'green' ? 'text-emerald-400'
    : accent === 'amber' ? 'text-amber-400'
    : accent === 'red' ? 'text-red-400'
    : 'text-white';
  return (
    <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-3">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}
