import { useState, useEffect, useCallback } from 'react';

interface SsoLogEntry {
  id: number;
  timestamp: string;
  event: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

const LEVEL_STYLES: Record<string, { color: string; bg: string }> = {
  info:  { color: '#60a5fa', bg: '#60a5fa20' },
  warn:  { color: '#f59e0b', bg: '#f59e0b20' },
  error: { color: '#ef4444', bg: '#ef444420' },
};

const EVENT_LABELS: Record<string, string> = {
  status_check: 'Status',
  login_start: 'Login Start',
  login_url: 'Login URL',
  callback: 'Callback',
  token_exchange: 'Token Exchange',
  user_resolved: 'User Lookup',
  user_linked: 'User Linked',
  user_created: 'User Created',
  login_success: 'Login OK',
  callback_error: 'Callback Error',
};

export function SsoLogPanel() {
  const [entries, setEntries] = useState<SsoLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // /api/auth/* is excluded from the global fetch interceptor, so we add the token manually
  function authHeaders(): HeadersInit {
    const token = localStorage.getItem('nova_auth_token') ?? sessionStorage.getItem('nova_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/sso/logs', { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) setEntries(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const clearLogs = async () => {
    try {
      await fetch('/api/auth/sso/logs', { method: 'DELETE', headers: authHeaders() });
      setEntries([]);
    } catch { /* ignore */ }
  };

  const filtered = filterLevel ? entries.filter(e => e.level === filterLevel) : entries;

  return (
    <div className="space-y-4">
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

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-[#5ec1ca]"
            />
            Auto-refresh (5s)
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
          No SSO log entries{filterLevel ? ` at level "${filterLevel}"` : ''}. Trigger an SSO login to generate logs.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#3a424d]">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#2f353d] text-neutral-500 uppercase tracking-wider text-left">
                <th className="px-3 py-2 font-medium w-[130px]">Time</th>
                <th className="px-3 py-2 font-medium w-[50px]">Level</th>
                <th className="px-3 py-2 font-medium w-[120px]">Event</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {filtered.map(e => {
                const style = LEVEL_STYLES[e.level] || LEVEL_STYLES.info;
                const hasDetails = e.details && Object.keys(e.details).length > 0;
                const isExpanded = expandedId === e.id;

                return (
                  <tr
                    key={e.id}
                    className={`hover:bg-[#363d47]/50 transition-colors ${hasDetails ? 'cursor-pointer' : ''}`}
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
                      {EVENT_LABELS[e.event] || e.event}
                    </td>
                    <td className="px-3 py-2 text-neutral-300">
                      <div>{e.message}</div>
                      {isExpanded && hasDetails && (
                        <pre className="mt-1.5 p-2 bg-[#1e2228] rounded text-[10px] text-neutral-400 overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      )}
                      {hasDetails && !isExpanded && (
                        <span className="text-[9px] text-neutral-600 ml-1">(click to expand details)</span>
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
