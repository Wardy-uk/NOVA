import React, { useEffect, useState, useCallback } from 'react';

const API = '/api/errors';

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem('nova_auth_token') || sessionStorage.getItem('nova_auth_token')
    || localStorage.getItem('token') || '';
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface ErrorRow {
  id: number;
  occurred_at: string;
  source: string;
  severity: 'error' | 'critical';
  message: string;
  stack: string | null;
  context: string | null;
  entity_ref: string | null;
  resolved: boolean;
}
interface SummaryRow { source: string; severity: string; count: number; }

export function ErrorLogView() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [source, setSource] = useState('');
  const [severity, setSeverity] = useState('');
  const [sinceHours, setSinceHours] = useState('24');
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (source) qs.set('source', source);
      if (severity) qs.set('severity', severity);
      if (sinceHours) qs.set('sinceHours', sinceHours);
      if (unresolvedOnly) qs.set('resolved', 'false');
      qs.set('limit', '200');
      const [r, s] = await Promise.all([
        fetch(`${API}?${qs}`, { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/summary?sinceHours=${sinceHours || 24}`, { headers: authHeaders() }).then(x => x.json()),
      ]);
      if (r.ok) setRows(r.data); else setError(r.error || 'Failed to load errors');
      if (s.ok) setSummary(s.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [source, severity, sinceHours, unresolvedOnly]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: number) => {
    await fetch(`${API}/${id}/resolve`, { method: 'POST', headers: authHeaders() });
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const selCls = 'px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100';

  return (
    <div className="max-w-6xl mx-auto space-y-4 p-1">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Error Log</h1>
        <button onClick={load} className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-100">Refresh</button>
      </div>

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.map((s, i) => (
            <span key={i} className={`text-xs px-2.5 py-1 rounded-full ${s.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/40 text-amber-300'}`}>
              {s.source} · {s.severity} · <strong>{s.count}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={source} onChange={e => setSource(e.target.value)} placeholder="source (e.g. llm, agent, jira-sync)" className={`${selCls} w-56`} />
        <select value={severity} onChange={e => setSeverity(e.target.value)} className={selCls}>
          <option value="">any severity</option>
          <option value="critical">critical</option>
          <option value="error">error</option>
        </select>
        <select value={sinceHours} onChange={e => setSinceHours(e.target.value)} className={selCls}>
          <option value="1">last 1h</option>
          <option value="24">last 24h</option>
          <option value="168">last 7d</option>
          <option value="720">last 30d</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={unresolvedOnly} onChange={e => setUnresolvedOnly(e.target.checked)} className="rounded border-gray-600 bg-gray-900" />
          Unresolved only
        </label>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-800 rounded text-sm text-red-300">{error}</div>}

      {loading ? (
        <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-gray-500 bg-gray-800 rounded-lg">No errors in this window. 🎉</div>
      ) : (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Sev</th>
                <th className="px-3 py-2 font-medium">Message</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/60">
              {rows.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="text-gray-300 hover:bg-gray-700/30 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">{new Date(r.occurred_at).toLocaleString()}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.source}</td>
                    <td className="px-3 py-2"><span className={`text-xs px-1.5 py-0.5 rounded ${r.severity === 'critical' ? 'bg-red-900/60 text-red-200' : 'bg-amber-900/50 text-amber-200'}`}>{r.severity}</span></td>
                    <td className="px-3 py-2"><span className="line-clamp-1">{r.message}</span>{r.entity_ref && <span className="ml-2 text-xs text-gray-500 font-mono">{r.entity_ref}</span>}</td>
                    <td className="px-3 py-2 text-right"><button onClick={e => { e.stopPropagation(); resolve(r.id); }} className="text-xs text-gray-400 hover:text-emerald-400">Resolve</button></td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-gray-900/50">
                      <td colSpan={5} className="px-4 py-3 space-y-2">
                        <div className="text-sm text-gray-200">{r.message}</div>
                        {r.context && <pre className="text-xs text-gray-400 bg-gray-950/50 rounded p-2 overflow-x-auto">{r.context}</pre>}
                        {r.stack && <pre className="text-xs text-gray-500 bg-gray-950/50 rounded p-2 overflow-x-auto max-h-64">{r.stack}</pre>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
