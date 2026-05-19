import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { PortalTicketDetail as TicketDetail, PortalTicketComment, PortalTicketAttachment, PortalSlaStatus, PortalStatusChange, PortalStatus } from '../../../shared/portal-types.js';
import { portalStatusDescriptions, portalStatusOrder } from '../../../shared/portal-types.js';

interface Props {
  ticketKey: string;
  onBack: () => void;
  onRefreshRef?: React.MutableRefObject<(() => void) | null>;
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

export default function PortalTicketDetail({ ticketKey, onBack, onRefreshRef }: Props) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);
  const commentFileRef = useRef<HTMLInputElement>(null);

  const fetchTicket = useCallback(() => {
    pf(`/api/portal/tickets/${ticketKey}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setTicket(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticketKey]);

  useEffect(() => {
    if (onRefreshRef) onRefreshRef.current = fetchTicket;
    return () => { if (onRefreshRef) onRefreshRef.current = null; };
  }, [fetchTicket, onRefreshRef]);

  useEffect(() => {
    fetchTicket();
  }, [ticketKey]);

  const handleAddComment = async () => {
    const body = editorRef.current?.innerText?.trim() || commentText.trim();
    if (!body && commentFiles.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // Upload attachments first
      for (const file of commentFiles) {
        const formData = new FormData();
        formData.append('file', file);
        await fetch(`/api/portal/tickets/${ticketKey}/attachments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('portal_token') || localStorage.getItem('token') || ''}`,
          },
          body: formData,
        });
      }

      if (body) {
        const res = await pf(`/api/portal/tickets/${ticketKey}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error || 'Failed to add comment');
          setSubmitting(false);
          return;
        }
      }

      setCommentText('');
      setCommentFiles([]);
      if (editorRef.current) editorRef.current.innerHTML = '';
      fetchTicket();
    } catch {
      setError('Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const execCommand = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  const handleInsertLink = () => {
    const url = prompt('Enter URL:');
    if (url) execCommand('createLink', url);
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'Submitted': return 'bg-gray-100 text-gray-800';
      case 'Reviewed': return 'bg-blue-100 text-blue-800';
      case 'In Progress': return 'bg-amber-100 text-amber-800';
      case 'Awaiting Your Response': return 'bg-red-100 text-red-800';
      case 'Awaiting Third Party': return 'bg-purple-100 text-purple-800';
      case 'Resolved': return 'bg-green-100 text-green-800';
      case 'Closed': return 'bg-slate-100 text-slate-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const isBranchStatus = (s: string) => s === 'Awaiting Your Response' || s === 'Awaiting Third Party';
  const currentStatusDescription = portalStatusDescriptions[ticket?.status as PortalStatus] ?? null;

  const renderStepper = (currentStatus: string) => {
    const currentIdx = portalStatusOrder.indexOf(currentStatus as PortalStatus);
    const branch = isBranchStatus(currentStatus);
    const activeIdx = branch ? portalStatusOrder.indexOf('In Progress') : currentIdx;

    return (
      <div className="flex items-center gap-0 w-full" role="group" aria-label="Ticket progress">
        {portalStatusOrder.map((step, i) => {
          const reached = i <= activeIdx;
          const isCurrent = !branch && step === currentStatus;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center relative">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${
                  isCurrent ? 'border-brand bg-brand text-white' :
                  reached ? 'border-brand bg-brand/10 text-brand' :
                  'border-gray-300 bg-white text-gray-400'
                }`}>
                  {reached && !isCurrent ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  ) : (i + 1)}
                </div>
                <span className={`text-[10px] mt-1 whitespace-nowrap ${isCurrent ? 'text-brand font-semibold' : reached ? 'text-gray-700' : 'text-gray-400'}`}>
                  {step}
                </span>
                {branch && step === 'In Progress' && (
                  <span className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-medium whitespace-nowrap">
                    {currentStatus}
                  </span>
                )}
              </div>
              {i < portalStatusOrder.length - 1 && (
                <div className={`flex-1 h-0.5 min-w-[16px] ${i < activeIdx ? 'bg-brand' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
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
      <button onClick={onBack} aria-label="Back to ticket list" className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none rounded">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to tickets
      </button>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main content */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <div role="region" aria-label="Ticket information" className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-mono text-gray-600">{ticket.key}</span>
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
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Reporter</div>
                <div className="text-sm text-gray-900">{ticket.reporter || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Assignee</div>
                <div className="text-sm text-gray-900">{ticket.assignee || 'Unassigned'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Created</div>
                <div className="text-sm text-gray-900">{new Date(ticket.created).toLocaleDateString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Updated</div>
                <div className="text-sm text-gray-900">{new Date(ticket.updated).toLocaleDateString()}</div>
              </div>
              {ticket.bcAccountNumber && (
                <div>
                  <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">BC Account</div>
                  <div className="text-sm text-gray-900">{ticket.bcAccountNumber}</div>
                </div>
              )}
            </div>

            {/* Progress stepper */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              {renderStepper(ticket.status)}
              {currentStatusDescription && (
                <p className="mt-3 text-sm text-gray-600">{currentStatusDescription}</p>
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
                      <div className="text-xs text-gray-600">{formatFileSize(att.size)}</div>
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
          <div role="region" aria-label="Comments" className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                      <span className="text-xs text-gray-600">{new Date(comment.created).toLocaleString()}</span>
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
              {/* Toolbar */}
              <div className="flex items-center gap-1 mb-1 border border-gray-300 border-b-0 rounded-t-lg bg-white px-2 py-1">
                <button
                  type="button"
                  onClick={() => execCommand('bold')}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600 font-bold text-sm focus-visible:ring-2 focus-visible:ring-brand outline-none"
                  aria-label="Bold"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => execCommand('italic')}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600 italic text-sm focus-visible:ring-2 focus-visible:ring-brand outline-none"
                  aria-label="Italic"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={handleInsertLink}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600 text-sm focus-visible:ring-2 focus-visible:ring-brand outline-none"
                  aria-label="Insert link"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </button>
                <div className="w-px h-5 bg-gray-200 mx-1" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => commentFileRef.current?.click()}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-600 text-sm focus-visible:ring-2 focus-visible:ring-brand outline-none"
                  aria-label="Attach file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  ref={commentFileRef}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xlsx,.csv,.txt,.zip,.log"
                  onChange={e => { if (e.target.files) setCommentFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }}
                  className="hidden"
                />
              </div>
              {/* Editable area */}
              <div
                ref={editorRef}
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label="Add a comment"
                onInput={() => setCommentText(editorRef.current?.innerText || '')}
                data-placeholder="Add a comment..."
                className="w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-b-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand bg-white empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
              />
              {/* Attached files */}
              {commentFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {commentFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full px-2.5 py-1 text-gray-700">
                      {f.name}
                      <button onClick={() => setCommentFiles(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove file ${f.name}`} className="text-gray-400 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-brand outline-none rounded">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleAddComment}
                  disabled={(!commentText.trim() && commentFiles.length === 0) || submitting}
                  className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
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
                        <div className="text-xs text-gray-600 mt-1">
                          {new Date(change.changedAt).toLocaleString()}
                          {change.changedBy && ` by ${change.changedBy}`}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {portalStatusDescriptions[change.to]}
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
                  <div className="text-xs text-gray-600 mb-1">{ticket.slaStatus.name}</div>
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
