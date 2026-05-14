import React, { useEffect, useState, useCallback } from 'react';
import type { PortalTicketSummary } from '../../../shared/portal-types.js';

interface Props {
  onViewTicket: (key: string) => void;
}

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

export default function PortalTicketList({ onViewTicket }: Props) {
  const [tickets, setTickets] = useState<PortalTicketSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | 'open' | 'resolved'>('all');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [priority, setPriority] = useState('all');
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
        ...(mine ? { mine: 'true' } : {}),
        ...(priority !== 'all' ? { priority } : {}),
        ...(dateRange !== 'all' ? { dateRange } : {}),
      });
      const res = await pf(`/api/portal/tickets?${params}`);
      const data = await res.json();
      if (data.ok) {
        setTickets(data.data.tickets || []);
        setTotal(data.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [page, status, search, mine, priority, dateRange]);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string) => {
    const lower = s.toLowerCase();
    if (lower.includes('closed') || lower.includes('resolved') || lower.includes('done')) return 'bg-green-100 text-green-700';
    if (lower.includes('progress') || lower.includes('waiting')) return 'bg-blue-100 text-blue-700';
    if (lower.includes('escalat')) return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  const priorityColor = (p: string) => {
    const lower = p.toLowerCase();
    if (lower === 'highest' || lower === 'critical') return 'text-red-600';
    if (lower === 'high') return 'text-orange-600';
    return 'text-gray-500';
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['all', 'open', 'resolved'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                status === s ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={mine} onChange={e => { setMine(e.target.checked); setPage(1); }}
            className="rounded border-gray-300 text-brand focus:ring-brand" />
          My tickets only
        </label>

        <select
          value={priority}
          onChange={e => { setPriority(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="all">All priorities</option>
          <option value="Highest">Highest</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          value={dateRange}
          onChange={e => { setDateRange(e.target.value as typeof dateRange); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>

        <div className="flex-1" />

        <input
          type="text"
          placeholder="Search tickets..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-64 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-4 flex-1 bg-gray-100 rounded" />
                <div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <p className="text-lg mb-2">No tickets found</p>
            <p className="text-sm">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Key</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Summary</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Priority</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Assignee</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map(t => (
                  <tr
                    key={t.key}
                    onClick={() => onViewTicket(t.key)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-3 font-mono text-gray-500">{t.key}</td>
                    <td className="px-6 py-3 text-gray-900 max-w-md truncate">{t.summary}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className={`px-6 py-3 ${priorityColor(t.priority)}`}>{t.priority}</td>
                    <td className="px-6 py-3 text-gray-600">{t.assignee || '-'}</td>
                    <td className="px-6 py-3 text-gray-500">{new Date(t.updated).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
