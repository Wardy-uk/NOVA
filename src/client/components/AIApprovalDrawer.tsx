import { useState, useEffect } from 'react';

interface ApprovalItem {
  id: number;
  ticket_id: string;
  ticket_summary: string;
  reporter_name: string | null;
  reporter_email: string | null;
  ai_response_adf: string | null;
  conversation_json: string | null;
  kb_sources: string | null;
  resume_url: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  edited_response_adf: string | null;
  priority: string | null;
  created_at: string;
  expires_at: string;
}

interface AIApprovalDrawerProps {
  item: ApprovalItem;
  canInteract: boolean;
  onClose: () => void;
  onDecide: (id: number, action: 'approve' | 'decline', editedResponse?: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

function extractAdfText(adfJson: string | null): string {
  if (!adfJson) return '';
  try {
    const doc = JSON.parse(adfJson);
    if (!doc.content) return adfJson;
    return doc.content.map((block: any) => {
      if (block.type === 'paragraph' || block.type === 'heading') {
        return (block.content || []).map((inline: any) => {
          if (inline.type === 'text') return inline.text;
          if (inline.type === 'mention') return `@${inline.attrs?.text || 'user'}`;
          if (inline.type === 'hardBreak') return '\n';
          return '';
        }).join('');
      }
      if (block.type === 'bulletList' || block.type === 'orderedList') {
        return (block.content || []).map((li: any) => {
          const text = (li.content || []).map((p: any) =>
            (p.content || []).map((i: any) => i.text || '').join('')
          ).join('');
          return `\u2022 ${text}`;
        }).join('\n');
      }
      if (block.type === 'codeBlock') {
        return (block.content || []).map((i: any) => i.text || '').join('');
      }
      return '';
    }).filter(Boolean).join('\n\n');
  } catch {
    return adfJson;
  }
}

function parseConversation(json: string | null): Array<{ role: string; text: string; author?: string }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((msg: any) => ({
      role: msg.role || msg.actorType || 'unknown',
      text: msg.body || msg.text || msg.content || '',
      author: msg.authorName || msg.author || undefined,
    }));
  } catch {
    return [];
  }
}

function parseKbSources(json: string | null): Array<{ title: string; url: string }> {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

function textToAdf(text: string): string {
  return JSON.stringify({
    version: 1,
    type: 'doc',
    content: text.split('\n\n').filter(Boolean).map(para => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para }]
    }))
  });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function timeRemaining(expiresAt: string): { text: string; urgency: 'normal' | 'warning' | 'critical' | 'expired' } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { text: 'Expired', urgency: 'expired' };
  const mins = Math.floor(diff / 60000);
  if (mins < 10) return { text: `${mins}m`, urgency: 'critical' };
  if (mins < 30) return { text: `${mins}m`, urgency: 'warning' };
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return { text: `${hrs}h ${remMins}m`, urgency: 'normal' };
}

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  highest: 'bg-red-500/20 text-red-400 border-red-500/30',
  major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  minor: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  low: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  lowest: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

const URGENCY_COLORS: Record<string, string> = {
  normal: 'text-neutral-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
  expired: 'text-neutral-600',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-green-500/20 text-green-400',
  declined: 'bg-red-500/20 text-red-400',
  timed_out: 'bg-neutral-500/20 text-neutral-500',
};

export function AIApprovalDrawer({ item, canInteract, onClose, onDecide, onPrev, onNext, hasPrev, hasNext }: AIApprovalDrawerProps) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [expiryDisplay, setExpiryDisplay] = useState(timeRemaining(item.expires_at));

  // Re-initialize when item changes
  useEffect(() => {
    setEditedText(extractAdfText(item.ai_response_adf));
    setEditing(false);
  }, [item]);

  // Tick the countdown every second
  useEffect(() => {
    setExpiryDisplay(timeRemaining(item.expires_at));
    const interval = setInterval(() => {
      setExpiryDisplay(timeRemaining(item.expires_at));
    }, 1000);
    return () => clearInterval(interval);
  }, [item.expires_at]);

  const conversation = parseConversation(item.conversation_json);
  const kbSources = parseKbSources(item.kb_sources);
  const originalText = extractAdfText(item.ai_response_adf);
  const hasEdits = editing && editedText !== originalText;
  const isPending = item.status === 'pending';
  const priStyle = PRIORITY_STYLES[(item.priority || 'normal').toLowerCase()] || PRIORITY_STYLES.normal;
  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.pending;

  function handleApprove() {
    if (hasEdits) {
      onDecide(item.id, 'approve', textToAdf(editedText));
    } else {
      onDecide(item.id, 'approve');
    }
  }

  function handleDecline() {
    onDecide(item.id, 'decline');
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-[#1f242b] border-l border-[#3a424d] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#3a424d] flex items-center gap-3">
          <div className="flex items-center gap-2">
            {hasPrev && onPrev && (
              <button
                onClick={onPrev}
                className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-neutral-100 transition-colors"
                title="Previous (k)"
              >
                <i className="fas fa-chevron-left" />
              </button>
            )}
            {hasNext && onNext && (
              <button
                onClick={onNext}
                className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-neutral-100 transition-colors"
                title="Next (j)"
              >
                <i className="fas fa-chevron-right" />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[#5ec1ca] text-xs font-mono font-semibold">{item.ticket_id}</span>
              <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${statusStyle}`}>
                {item.status.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <div className="text-sm text-neutral-100 font-semibold truncate">{item.ticket_summary}</div>
          </div>
          {item.resume_url && (
            <a
              href={item.resume_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-[#5ec1ca] transition-colors shrink-0"
            >
              Open in Jira
            </a>
          )}
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-neutral-100 transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Ticket Info */}
          <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-3">Ticket Details</div>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <span className="text-neutral-500 text-[11px]">Reporter</span>
                <div className="text-neutral-300">
                  {item.reporter_name || 'Unknown'}
                  {item.reporter_email && (
                    <span className="text-neutral-500 text-[11px] ml-1">({item.reporter_email})</span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">Priority</span>
                <div>
                  <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${priStyle}`}>
                    {item.priority || 'Normal'}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">Created</span>
                <div className="text-neutral-300">{timeAgo(item.created_at)}</div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">Expires</span>
                <div className={URGENCY_COLORS[expiryDisplay.urgency]}>
                  {expiryDisplay.text}
                  {expiryDisplay.urgency === 'critical' && <i className="fas fa-exclamation-triangle ml-1 text-[10px]" />}
                </div>
              </div>
              {item.decided_by && (
                <>
                  <div>
                    <span className="text-neutral-500 text-[11px]">Decided By</span>
                    <div className="text-neutral-300">{item.decided_by}</div>
                  </div>
                  <div>
                    <span className="text-neutral-500 text-[11px]">Decided At</span>
                    <div className="text-neutral-300">{item.decided_at ? timeAgo(item.decided_at) : '-'}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Conversation History */}
          {conversation.length > 0 && (
            <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-3">
                Conversation History
              </div>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {conversation.map((msg, i) => {
                  const isAI = msg.role === 'ai' || msg.role === 'assistant' || msg.role === 'bot';
                  return (
                    <div key={i} className={`flex gap-3 ${isAI ? '' : ''}`}>
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{
                        background: isAI ? 'rgba(94, 193, 202, 0.15)' : 'rgba(124, 58, 237, 0.15)',
                      }}>
                        {isAI ? '\uD83E\uDD16' : '\uD83D\uDCAC'}
                      </div>
                      <div className="flex-1 min-w-0">
                        {msg.author && (
                          <div className="text-[11px] text-neutral-500 mb-0.5">{msg.author}</div>
                        )}
                        <div className="text-[13px] text-neutral-300 whitespace-pre-wrap break-words">{msg.text}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Proposed Resolution */}
          <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                AI Proposed Resolution
              </div>
              {canInteract && isPending && (
                <button
                  onClick={() => setEditing(!editing)}
                  className="text-[11px] px-2 py-1 rounded bg-[#2f353d] text-neutral-400 hover:text-[#5ec1ca] transition-colors"
                >
                  {editing ? 'Preview' : 'Edit'}
                </button>
              )}
            </div>
            {editing ? (
              <textarea
                value={editedText}
                onChange={e => setEditedText(e.target.value)}
                className="w-full h-48 bg-[#1f242b] border border-[#3a424d] rounded-lg p-3 text-[13px] text-neutral-300 resize-y focus:outline-none focus:border-[#5ec1ca]/40 focus:ring-1 focus:ring-[#5ec1ca]/20"
              />
            ) : (
              <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">
                {editedText || extractAdfText(item.ai_response_adf) || 'No response generated'}
              </div>
            )}
            {hasEdits && (
              <div className="mt-2 text-[11px] text-amber-400 flex items-center gap-1">
                <i className="fas fa-pen-to-square" />
                Response has been edited
              </div>
            )}
          </div>

          {/* KB Sources */}
          {kbSources.length > 0 && (
            <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-3">
                Knowledge Base Sources
              </div>
              <div className="space-y-2">
                {kbSources.map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[13px] text-[#5ec1ca] hover:underline"
                  >
                    <i className="fas fa-external-link-alt text-[10px] text-neutral-500" />
                    {src.title}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Bar (sticky bottom) */}
        {canInteract && isPending && (
          <div className="px-5 py-4 border-t border-[#3a424d] bg-[#1f242b] flex items-center justify-between">
            <div className={`text-[12px] ${URGENCY_COLORS[expiryDisplay.urgency]}`}>
              <i className="fas fa-clock mr-1" />
              Expires: {expiryDisplay.text}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDecline}
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
              >
                Decline
              </button>
              {hasEdits ? (
                <button
                  onClick={handleApprove}
                  className="bg-[#5ec1ca] hover:bg-[#4db0ba] text-[#272C33] px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
                >
                  Edit & Approve
                </button>
              ) : (
                <button
                  onClick={handleApprove}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
                >
                  Approve
                </button>
              )}
            </div>
          </div>
        )}

        {/* Decided info for non-pending items */}
        {!isPending && (
          <div className="px-5 py-3 border-t border-[#3a424d] bg-[#1f242b]">
            <div className="text-[12px] text-neutral-500 text-center">
              {item.status === 'approved' && <span className="text-green-400">Approved</span>}
              {item.status === 'declined' && <span className="text-red-400">Declined</span>}
              {item.status === 'timed_out' && <span className="text-neutral-500">Timed Out</span>}
              {item.decided_by && <span> by {item.decided_by}</span>}
              {item.decided_at && <span> {timeAgo(item.decided_at)}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
