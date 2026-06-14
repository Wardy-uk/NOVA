import { useState, useEffect } from 'react';

interface HealthStats {
  total: number; current: number; stale: number; unused: number; drifted: number;
  gap_closure_rate: number;
}

interface ArticleHealth {
  id: number; article_id: string; article_title: string | null; article_url: string | null;
  status: string; usage_count_30d: number | null; usage_count_90d: number | null;
  drift_score: number | null; checked_at: string;
}

interface ClosureStats {
  total_gaps: number; articles_published: number; loops_closed: number; closure_rate: number;
}

interface CoverageItem {
  request_type: string; gap_count: number; article_count: number;
}

const api = async (path: string, method = 'GET') => {
  const r = await fetch(`/api/kb-health${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` },
  });
  return r.json();
};

export function KbHealthView() {
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [articles, setArticles] = useState<ArticleHealth[]>([]);
  const [closure, setClosure] = useState<ClosureStats | null>(null);
  const [coverage, setCoverage] = useState<CoverageItem[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    const [s, a, c, cov] = await Promise.all([
      api('/stats'), api(`/articles${filter ? `?status=${filter}` : ''}`),
      api('/closure-stats'), api('/coverage'),
    ]);
    if (s.ok) setStats(s.data);
    if (a.ok) setArticles(a.data);
    if (c.ok) setClosure(c.data);
    if (cov.ok) setCoverage(cov.data);
  };

  useEffect(() => { load(); }, [filter]);

  const runScan = async () => {
    setScanning(true);
    await api('/scan', 'POST');
    await load();
    setScanning(false);
  };

  const draftUpdate = async (articleId: string) => {
    await api(`/draft-update/${articleId}`, 'POST');
    await load();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'current': return 'text-green-400';
      case 'stale': return 'text-amber-400';
      case 'unused': return 'text-neutral-500';
      case 'drifted': return 'text-red-400';
      default: return 'text-neutral-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Articles', value: stats.total, color: 'text-neutral-200' },
            { label: 'Current', value: stats.current, color: 'text-green-400' },
            { label: 'Stale', value: stats.stale, color: 'text-amber-400' },
            { label: 'Unused', value: stats.unused, color: 'text-neutral-500' },
            { label: 'Drifted', value: stats.drifted, color: 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-neutral-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Gap Closure */}
      {closure && (
        <div className="bg-[#2f353d] rounded-lg p-4">
          <h3 className="text-sm font-medium text-neutral-200 mb-2">Gap Loop Closure</h3>
          <div className="flex gap-6 text-xs text-neutral-400">
            <span>Total gaps: <span className="text-neutral-200">{closure.total_gaps}</span></span>
            <span>Articles published: <span className="text-neutral-200">{closure.articles_published}</span></span>
            <span>Loops closed: <span className="text-green-400">{closure.loops_closed}</span></span>
            <span>Closure rate: <span className="text-[#5ec1ca]">{(closure.closure_rate * 100).toFixed(0)}%</span></span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="bg-[#2f353d] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d]">
          <option value="">All statuses</option>
          <option value="current">Current</option>
          <option value="stale">Stale</option>
          <option value="unused">Unused</option>
          <option value="drifted">Drifted</option>
        </select>
        <button onClick={runScan} disabled={scanning}
          className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
          {scanning ? 'Scanning...' : 'Run Staleness Scan'}
        </button>
      </div>

      {/* Articles Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#3a424d]">
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Article</th>
              <th className="text-center py-2 px-2 text-neutral-400 font-medium">Status</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">30d Uses</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">90d Uses</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Drift</th>
              <th className="text-center py-2 px-2 text-neutral-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {articles.map(a => (
              <tr key={a.id} className="border-b border-[#3a424d]/50 hover:bg-[#2f353d]/50">
                <td className="py-2 px-2">
                  {a.article_url ? (
                    <a href={a.article_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#5ec1ca] hover:underline">{a.article_title ?? a.article_id}</a>
                  ) : (
                    <span className="text-neutral-200">{a.article_title ?? a.article_id}</span>
                  )}
                </td>
                <td className={`py-2 px-2 text-center ${statusColor(a.status)}`}>{a.status}</td>
                <td className="py-2 px-2 text-right text-neutral-300">{a.usage_count_30d ?? 0}</td>
                <td className="py-2 px-2 text-right text-neutral-300">{a.usage_count_90d ?? 0}</td>
                <td className="py-2 px-2 text-right text-neutral-300">
                  {a.drift_score !== null ? (a.drift_score * 100).toFixed(0) + '%' : '-'}
                </td>
                <td className="py-2 px-2 text-center">
                  {(a.status === 'stale' || a.status === 'drifted') && (
                    <button onClick={() => draftUpdate(a.article_id)}
                      className="px-2 py-0.5 bg-amber-900/30 text-amber-400 text-xs rounded hover:bg-amber-900/40">
                      Draft Update
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Coverage Heatmap */}
      {coverage.length > 0 && (
        <div className="bg-[#2f353d] rounded-lg p-4">
          <h3 className="text-sm font-medium text-neutral-200 mb-3">Coverage by Request Type</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {coverage.slice(0, 12).map(c => (
              <div key={c.request_type} className="flex items-center justify-between bg-[#272C33] rounded px-3 py-2">
                <span className="text-xs text-neutral-300 truncate mr-2">{c.request_type}</span>
                <div className="flex gap-2 text-xs">
                  <span className="text-red-400">{c.gap_count} gaps</span>
                  <span className="text-green-400">{c.article_count} articles</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
