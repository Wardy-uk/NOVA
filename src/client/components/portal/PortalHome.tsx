import React, { useEffect, useState } from 'react';

type PortalView = 'home' | 'tickets' | 'ticket-detail' | 'new-request' | 'kb' | 'chat';

interface Props {
  onNavigate: (view: PortalView) => void;
  onViewTicket: (key: string) => void;
}

interface TicketSummary {
  key: string;
  summary: string;
  status: string;
  updated: string;
}

interface KbArticle {
  id: number;
  title: string;
  view_count: number;
  category: string | null;
}

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

export default function PortalHome({ onNavigate, onViewTicket }: Props) {
  const [recentTickets, setRecentTickets] = useState<TicketSummary[]>([]);
  const [popularArticles, setPopularArticles] = useState<KbArticle[]>([]);
  const [ticketCount, setTicketCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      pf('/api/portal/tickets?status=open&pageSize=3').then(r => r.json()),
      pf('/api/portal/kb/popular').then(r => r.json()),
    ]).then(([ticketsRes, kbRes]) => {
      if (ticketsRes.ok) {
        setRecentTickets(ticketsRes.data.tickets || []);
        setTicketCount(ticketsRes.data.total || 0);
      }
      if (kbRes.ok) setPopularArticles(kbRes.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const statusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('closed') || s.includes('resolved') || s.includes('done')) return 'bg-green-100 text-green-700';
    if (s.includes('progress') || s.includes('waiting')) return 'bg-blue-100 text-blue-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-6 animate-pulse">
            <div className="h-5 w-48 bg-gray-200 rounded mb-4" />
            <div className="h-4 w-full bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => onNavigate('new-request')}
          className="bg-brand text-white rounded-xl p-6 text-left hover:bg-brand-dark transition-colors group"
        >
          <div className="text-lg font-semibold mb-1">Report an issue</div>
          <div className="text-white/60 text-sm">Submit a new support request</div>
        </button>
        <button
          onClick={() => onNavigate('chat')}
          className="bg-white border border-gray-200 rounded-xl p-6 text-left hover:border-brand/40 hover:shadow-sm transition-all"
        >
          <div className="text-lg font-semibold text-gray-900 mb-1">Ask a question</div>
          <div className="text-gray-500 text-sm">Chat with our AI assistant</div>
        </button>
        <button
          onClick={() => onNavigate('tickets')}
          className="bg-white border border-gray-200 rounded-xl p-6 text-left hover:border-brand/40 hover:shadow-sm transition-all"
        >
          <div className="text-lg font-semibold text-gray-900 mb-1">Check ticket status</div>
          <div className="text-gray-500 text-sm">{ticketCount} open ticket{ticketCount !== 1 ? 's' : ''}</div>
        </button>
      </div>

      {/* Recent Tickets */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Tickets</h2>
          <button onClick={() => onNavigate('tickets')} className="text-sm text-brand hover:text-brand-dark">
            View all
          </button>
        </div>
        {recentTickets.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <p className="text-lg mb-2">No open tickets</p>
            <p className="text-sm">When you submit a request, it will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentTickets.map(t => (
              <button
                key={t.key}
                onClick={() => onViewTicket(t.key)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-gray-500">{t.key}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(t.status)}`}>
                      {t.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-900 mt-1 truncate">{t.summary}</div>
                </div>
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Popular KB Articles */}
      {popularArticles.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Popular Articles</h2>
            <button onClick={() => onNavigate('kb')} className="text-sm text-brand hover:text-brand-dark">
              Browse all
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {popularArticles.map(a => (
              <button
                key={a.id}
                onClick={() => onNavigate('kb')}
                className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
              >
                <div className="text-sm text-gray-900">{a.title}</div>
                {a.category && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full ml-4 flex-shrink-0">{a.category}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
