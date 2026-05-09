import React, { useEffect, useState } from 'react';
import type { PortalTicketDetail as TicketDetail, PortalTicketComment } from '../../../shared/portal-types.js';

interface Props {
  ticketKey: string;
  onBack: () => void;
}

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

export default function PortalTicketDetail({ ticketKey, onBack }: Props) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pf(`/api/portal/tickets/${ticketKey}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setTicket(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticketKey]);

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await pf(`/api/portal/tickets/${ticketKey}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentText }),
      });
      const data = await res.json();
      if (data.ok) {
        setCommentText('');
        // Refresh ticket
        const refreshRes = await pf(`/api/portal/tickets/${ticketKey}`);
        const refreshData = await refreshRes.json();
        if (refreshData.ok) setTicket(refreshData.data);
      } else {
        setError(data.error || 'Failed to add comment');
      }
    } catch {
      setError('Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (s: string) => {
    const lower = s.toLowerCase();
    if (lower.includes('closed') || lower.includes('resolved') || lower.includes('done')) return 'bg-green-100 text-green-800';
    if (lower.includes('progress') || lower.includes('waiting')) return 'bg-blue-100 text-blue-800';
    if (lower.includes('escalat')) return 'bg-red-100 text-red-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded" />
        <div className="bg-white rounded-xl p-6">
          <div className="h-6 w-full bg-gray-100 rounded mb-4" />
          <div className="h-4 w-3/4 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-16">
        <p className="text-lg text-gray-600">Ticket not found</p>
        <button onClick={onBack} className="mt-4 text-blue-600 hover:text-blue-700">Back to tickets</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to tickets
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-mono text-gray-500">{ticket.key}</span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor(ticket.status)}`}>
                {ticket.status}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
                {ticket.priority}
              </span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">{ticket.summary}</h1>
          </div>
        </div>

        {/* Info grid */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Reporter</div>
            <div className="text-sm text-gray-900">{ticket.reporter || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Assignee</div>
            <div className="text-sm text-gray-900">{ticket.assignee || 'Unassigned'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Created</div>
            <div className="text-sm text-gray-900">{new Date(ticket.created).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Updated</div>
            <div className="text-sm text-gray-900">{new Date(ticket.updated).toLocaleDateString()}</div>
          </div>
        </div>

        {/* Description */}
        {ticket.description && (
          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
            <div className="text-sm text-gray-600 whitespace-pre-wrap">{ticket.description}</div>
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Comments ({ticket.comments.length})</h2>
        </div>

        {ticket.comments.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 text-sm">
            No comments yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {ticket.comments.map(comment => (
              <div key={comment.id} className="px-6 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-medium">
                    {comment.author.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{comment.author}</span>
                  <span className="text-xs text-gray-400">{new Date(comment.created).toLocaleString()}</span>
                </div>
                <div className="text-sm text-gray-600 whitespace-pre-wrap ml-9">{comment.body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Add comment */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
          )}
          <textarea
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleAddComment}
              disabled={!commentText.trim() || submitting}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Posting...' : 'Add Comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
