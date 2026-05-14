import React, { useEffect, useState } from 'react';
import type { PortalTicketDetail as TicketDetail, PortalTicketComment, PortalTicketAttachment, PortalSlaStatus, PortalStatusChange } from '../../../shared/portal-types.js';

interface Props {
  ticketKey: string;
  onBack: () => void;
}

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimeRemaining(remaining: string | null, breached: boolean): { text: string; color: string } {
  if (breached) return { text: 'Breached', color: 'text-red-700 bg-red-100' };
  if (!remaining) return { text: 'N/A', color: 'text-gray-500 bg-gray-100' };

  const match = remaining.match(/(\d+)h\s*(\d+)?m?/i) || remaining.match(/(\d+)\s*min/i);
  let totalMinutes = 0;
  if (match) {
    if (match[2] !== undefined) {
      totalMinutes = parseInt(match[1]) * 60 + parseInt(match[2]);
    } else {
      totalMinutes = parseInt(match[1]);
      if (remaining.toLowerCase().includes('h')) totalMinutes *= 60;
    }
  }

  if (totalMinutes <= 0) return { text: remaining, color: 'text-red-700 bg-red-100' };
  if (totalMinutes < 30) return { text: remaining, color: 'text-red-600 bg-red-50' };
  if (totalMinutes < 120) return { text: remaining, color: 'text-amber-700 bg-amber-50' };
  return { text: remaining, color: 'text-green-700 bg-green-50' };
}

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
        <button onClick={onBack} className="mt-4 text-brand hover:text-brand-dark">Back to tickets</button>
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

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main content */}
        <div className="flex-1 space-y-6">
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
              {ticket.bcAccountNumber && (
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">BC Account</div>
                  <div className="text-sm text-gray-900">{ticket.bcAccountNumber}</div>
                </div>
              )}
            </div>

            {/* Description */}
            {ticket.description && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
                <div className="text-sm text-gray-600 whitespace-pre-wrap">{ticket.description}</div>
              </div>
            )}
          </div>

          {/* Attachments */}
          {ticket.attachments && ticket.attachments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                Attachments ({ticket.attachments.length})
              </h2>
              <div className="space-y-2">
                {ticket.attachments.map(att => (
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded bg-brand/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate group-hover:text-brand">{att.filename}</div>
                      <div className="text-xs text-gray-400">{formatFileSize(att.size)}</div>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}

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
                      <div className="w-7 h-7 rounded-full bg-brand/15 flex items-center justify-center text-brand text-xs font-medium">
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand resize-none"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || submitting}
                  className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Posting...' : 'Add Comment'}
                </button>
              </div>
            </div>
          </div>

          {/* Status Timeline */}
          {ticket.statusHistory && ticket.statusHistory.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-medium text-gray-700 mb-4">Status Timeline</h2>
              <div className="relative">
                <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gray-200" />
                <div className="space-y-4">
                  {ticket.statusHistory.map((change, i) => (
                    <div key={i} className="flex gap-4 relative">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                        i === 0 ? 'bg-brand' : 'bg-gray-300'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-white' : 'bg-white'}`} />
                      </div>
                      <div className="flex-1 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {change.from && (
                            <>
                              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{change.from}</span>
                              <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            </>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor(change.to)}`}>{change.to}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {new Date(change.changedAt).toLocaleString()}
                          {change.changedBy && ` by ${change.changedBy}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — SLA Status */}
        {ticket.slaStatus && (
          <div className="lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">SLA Status</h3>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">{ticket.slaStatus.name}</div>
                  {(() => {
                    const { text, color } = formatTimeRemaining(ticket.slaStatus.remaining, ticket.slaStatus.breached);
                    return (
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${color}`}>
                        {ticket.slaStatus.breached && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                        )}
                        {text}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
