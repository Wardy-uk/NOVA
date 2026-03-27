import { useState, useEffect, useCallback } from 'react';

interface WallboardLogEntry {
  id: number;
  timestamp: string;
  route: string;
  level: 'info' | 'warn' | 'error';
  durationMs: number;
  status: number;
  message: string;
  sqlServer?: string;
  error?: string;
  stack?: string;
}

const LEVEL_STYLES: Record<string, { color: string; bg: string }> = {
  info:  { color: '#60a5fa', bg: '#60a5fa20' },
  warn:  { color: '#f59e0b', bg: '#f59e0b20' },
  error: { color: '#ef4444', bg: '#ef444420' },
};

const ROUTE_LABELS: Record<string, string> = {
  '/wallboard/breached': 'SLA Breach Board',
  '/wallboard/team-kpis': 'KPI Breach Board',
  '/wallboard/cc': 'Customer Care',
  '/wallboard/tech-support': 'Tech Support',
};

export function WallboardLogPanel() {
  const [entries, setEntries] = useState<WallboardLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [filterRoute, setFilterRoute] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/wallboard-logs');
      const json = await res.json();
      if (json.ok) setEntries(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const clearLogs = async () => {
    try {
      await fetch('/api/admin/wallboard-logs', { method: 'DELETE' });
      setEntries([]);
    } catch { /* ignore */ }
  };

  const filtered = entries.filter(e =>
    (!filterLevel || e.level === filterLevel) &&
    (!filterRoute || e.route === filterRoute)
  );

  const errorCount = entries.filter(e => e.level === 'error').length;
  const avgDuration = entries.length > 0
    ? Math.round(entries.reduce((s, e) => s + e.durationMs, 0) / entries.length)
    : 0;
  const slowest = entries.length > 0 ? Math.max(...entries.map(e => e.durationMs)) : 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {entries.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-500 uppercase tracking-wider font-semibold">Total Requests</div>
            <div className="text-lg font-bold text-neutral-200">{entries.length}</div>
          </div>
          <div className="bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-500 uppercase tracking-wider font-semibold">Errors</div>
            <div className={`text-lg font-bold ${errorCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{errorCount}</div>
          </div>
          <div className="bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-500 uppercase tracking-wider font-semibold">Avg Duration</div>
            <div className={`text-lg font-bold ${avgDuration > 5000 ? 'text-red-400' : avgDuration > 2000 ? 'text-amber-400' : 'text-neutral-200'}`}>{avgDuration}ms</div>
          </div>
          <div className="bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-500 uppercase tracking-wider font-semibold">Slowest</div>
            <div className={`text-lg font-bold ${slowest > 10000 ? 'text-red-400' : slowest > 5000 ? 'text-amber-400' : 'text-neutral-200'}`}>{slowest}ms</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-neutral-400">Level:</span>
        {['', 'info', 'warn', 'error'].map(level => (
          <button
            key={level || 'all'}
            onClick={() => setFilterLevel(level)}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              filterLevel === level
                ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
            }`}
          >
            {level || 'All'}
          </button>
        ))}

        <span className="text-xs text-neutral-400 ml-2">Route:</span>
        <button
          onClick={() => setFilterRoute('')}
          className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
            !filterRoute
              ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
              : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
          }`}
        >
          All
        </button>
        {Object.entries(ROUTE_LABELS).map(([route, label]) => (
          <button
            key={route}
            onClick={() => setFilterRoute(filterRoute === route ? '' : route)}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              filterRoute === route
                ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
            }`}
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-[#5ec1ca]"
            />
            Auto-refresh (10s)
          </label>
          <button
            onClick={fetchLogs}
            className="px-2 py-0.5 text-[10px] bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] rounded transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={clearLogs}
            className="px-2 py-0.5 text-[10px] bg-[#2f353d] text-red-400 hover:bg-[#363d47] rounded transition-colors"
          >
            Clear
          </button>
          <span className="text-[10px] text-neutral-600">{filtered.length} entries</span>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-neutral-500 py-4 text-center">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-neutral-600 py-8 text-center">
          No wallboard log entries{filterLevel ? ` at level "${filterLevel}"` : ''}{filterRoute ? ` for ${ROUTE_LABELS[filterRoute]}` : ''}. Wallboard requests will appear here automatically.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#3a424d]">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#2f353d] text-neutral-500 uppercase tracking-wider text-left">
                <th className="px-3 py-2 font-medium w-[130px]">Time</th>
                <th className="px-3 py-2 font-medium w-[50px]">Level</th>
                <th className="px-3 py-2 font-medium w-[130px]">Route</th>
                <th className="px-3 py-2 font-medium w-[70px] text-right">Duration</th>
                <th className="px-3 py-2 font-medium w-[50px] text-center">Status</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {filtered.map(e => {
                const style = LEVEL_STYLES[e.level] || LEVEL_STYLES.info;
                const hasDetails = !!(e.error || e.stack || e.sqlServer);
                const isExpanded = expandedId === e.id;
                const durationColor = e.durationMs > 10000 ? 'text-red-400' : e.durationMs > 5000 ? 'text-amber-400' : 'text-neutral-400';

                return (
                  <tr
                    key={e.id}
                    className={`hover:bg-[#363d47]/50 transition-colors ${hasDetails ? 'cursor-pointer' : ''} ${e.level === 'error' ? 'bg-red-950/20' : ''}`}
                    onClick={() => hasDetails && setExpandedId(isExpanded ? null : e.id)}
                  >
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap font-mono">
                      {new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      <span className="text-neutral-600 ml-1">
                        {new Date(e.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase"
                        style={{ color: style.color, backgroundColor: style.bg }}
                      >
                        {e.level}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#5ec1ca] whitespace-nowrap">
                      {ROUTE_LABELS[e.route] || e.route}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${durationColor}`}>
                      {e.durationMs.toLocaleString()}ms
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-semibold ${e.status >= 500 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-300">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-md">{e.message}</span>
                        {hasDetails && (
                          <span className="text-neutral-600 text-[9px] shrink-0">{isExpanded ? '[-]' : '[+]'}</span>
                        )}
                      </div>
                      {isExpanded && hasDetails && (
                        <div className="mt-2 p-2 bg-[#1a1f26] rounded text-[10px] font-mono space-y-1 border border-[#3a424d]" onClick={ev => ev.stopPropagation()}>
                          {e.sqlServer && (
                            <div><span className="text-neutral-500">SQL Server:</span> <span className="text-neutral-300">{e.sqlServer}</span></div>
                          )}
                          {e.error && (
                            <div><span className="text-red-500">Error:</span> <span className="text-red-300">{e.error}</span></div>
                          )}
                          {e.stack && (
                            <pre className="text-neutral-500 whitespace-pre-wrap text-[9px] mt-1 max-h-32 overflow-auto">{e.stack}</pre>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
