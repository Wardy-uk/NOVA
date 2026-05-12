import { useState, useEffect } from 'react';
import { TicketBriefCard, type BriefFields } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';

interface ApprovalItem {
  id: number;
  ticket_id: string;
  ticket_summary: string;
  reporter_name: string | null;
  reporter_email: string | null;
  assignee_name: string | null;
  bc_account_number: string | null;
  ai_response_adf: string | null;
  conversation_json: string | null;
  kb_sources: string | null;
  resume_url: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  edited_response_adf: string | null;
  decline_reason: string | null;
  priority: string | null;
  created_at: string;
  expires_at: string;
  source: string | null;
  action_type: string | null;
  confidence: number | null;
  reasoning: string | null;
  shadow_mode: boolean;
  decision_id: number | null;
}

interface AIApprovalDrawerProps {
  item: ApprovalItem;
  canInteract: boolean;
  onClose: () => void;
  onDecide: (id: number, action: 'approve' | 'decline' | 'cancel' | 'confirm' | 'execute', editedResponse?: string, declineReason?: string) => void;
  onReReview?: (id: number) => Promise<{ ok: boolean; error?: string }>;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

function extractAdfText(adfJson: string | null): string {
  if (!adfJson) return '';
  try {
    const doc = JSON.parse(adfJson);
    // NOVA agent_decisions output — extract the useful text fields
    if (doc.draft_response || doc.reasoning_trace || doc.reasoning || doc.internal_note) {
      const parts: string[] = [];
      if (doc.draft_response) parts.push(doc.draft_response);
      else if (doc.internal_note) parts.push(doc.internal_note);
      if (doc.reasoning_trace) parts.push(`\nReasoning: ${doc.reasoning_trace}`);
      else if (doc.reasoning) parts.push(`\nReasoning: ${doc.reasoning}`);
      return parts.join('\n');
    }
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
    const parsed = JSON.parse(json);
    // NOVA agent_decisions inputs — flat object with ticket context
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      const msgs: Array<{ role: string; text: string; author?: string }> = [];
      if (parsed.summary || parsed.description) {
        msgs.push({
          role: 'customer',
          text: [parsed.summary, parsed.description].filter(Boolean).join('\n\n'),
          author: parsed.reporter ?? parsed.reporter_name ?? undefined,
        });
      }
      if (parsed.comments && Array.isArray(parsed.comments)) {
        for (const c of parsed.comments) {
          msgs.push({
            role: c.isInternal ? 'agent' : 'customer',
            text: c.body || c.text || '',
            author: c.author || c.authorName || undefined,
          });
        }
      }
      if (msgs.length > 0) return msgs;
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map((msg: any) => ({
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
  if (!expiresAt) return { text: 'No expiry', urgency: 'normal' };
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (isNaN(diff) || diff <= 0) return { text: 'Expired', urgency: 'expired' };
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

const ACTION_LABELS: Record<string, { label: string; summary: string; icon: string; color: string }> = {
  draft_response: { label: 'Send Reply', summary: 'Send the draft response below to the customer', icon: 'fa-reply', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  plugin_to_tpj: { label: 'Route to TPJ', summary: 'Move this ticket to the TPJ project for third-party processing', icon: 'fa-share', color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  escalate: { label: 'Escalate', summary: 'Escalate to Customer Care for human triage', icon: 'fa-arrow-up', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  abuse_report: { label: 'Abuse Report', summary: 'Process this abuse report (disable instance)', icon: 'fa-shield-halved', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  auto_close: { label: 'Auto-close', summary: 'Close this ticket as resolved (no action needed)', icon: 'fa-check-circle', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  quick_win_close: { label: 'Quick Close', summary: 'Close this ticket — detected as spam, thank-you, or already resolved', icon: 'fa-check-circle', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  close: { label: 'Close Ticket', summary: 'Close this ticket as resolved', icon: 'fa-check-circle', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  transition: { label: 'Change Status', summary: 'Transition this ticket to a new workflow status', icon: 'fa-exchange-alt', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  respond: { label: 'Send Reply', summary: 'Send a response to the customer', icon: 'fa-reply', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  assign: { label: 'Assign', summary: 'Assign this ticket to an agent via round-robin', icon: 'fa-user-plus', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  chase: { label: 'Chase Customer', summary: 'Send a follow-up message to the customer', icon: 'fa-clock', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  request_info: { label: 'Request Info', summary: 'Ask the customer for more information', icon: 'fa-question-circle', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  no_action: { label: 'No Action', summary: 'No action required — this decision is informational only', icon: 'fa-minus-circle', color: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30' },
};

function getActionInfo(action: string | null) {
  if (!action) return null;
  return ACTION_LABELS[action] || { label: action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), summary: '', icon: 'fa-bolt', color: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30' };
}

function confidenceStyle(c: number): { color: string; bg: string; label: string } {
  const pct = Math.round(c * 100);
  if (c >= 0.9) return { color: 'text-green-400', bg: 'bg-green-500', label: `${pct}%` };
  if (c >= 0.7) return { color: 'text-amber-400', bg: 'bg-amber-500', label: `${pct}%` };
  return { color: 'text-red-400', bg: 'bg-red-500', label: `${pct}%` };
}

function parseDraftResponse(outputJson: string | null): string | null {
  if (!outputJson) return null;
  try {
    const parsed = JSON.parse(outputJson);
    return parsed.draft_response || null;
  } catch {
    return null;
  }
}

function parseAbuseClassification(outputJson: string | null): string | null {
  if (!outputJson) return null;
  try {
    const parsed = JSON.parse(outputJson);
    return parsed.abuse_type || parsed.abuse_classification || parsed.classification || null;
  } catch {
    return null;
  }
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-green-500/20 text-green-400',
  declined: 'bg-red-500/20 text-red-400',
  timed_out: 'bg-neutral-500/20 text-neutral-500',
  cancelled: 'bg-neutral-500/20 text-neutral-400',
};

export function AIApprovalDrawer({ item, canInteract, onClose, onDecide, onReReview, onPrev, onNext, hasPrev, hasNext }: AIApprovalDrawerProps) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [expiryDisplay, setExpiryDisplay] = useState(timeRemaining(item.expires_at));
  const [reReviewLoading, setReReviewLoading] = useState(false);
  const [reReviewError, setReReviewError] = useState<string | null>(null);

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

  const [briefFields, setBriefFields] = useState<BriefFields | null>(null);
  useEffect(() => {
    if (!item.ticket_id) return;
    const token = localStorage.getItem('nova_auth_token') || '';
    fetch(`/api/jira/issues/${item.ticket_id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data) {
          const f = json.data.fields ?? json.data;
          setBriefFields(f as BriefFields);
        }
      })
      .catch(() => {});
  }, [item.ticket_id]);

  const conversation = parseConversation(item.conversation_json);
  const kbSources = parseKbSources(item.kb_sources);
  const originalText = extractAdfText(item.ai_response_adf);
  const hasEdits = editing && editedText !== originalText;
  const isPending = item.status === 'pending';
  const priStyle = PRIORITY_STYLES[(item.priority || 'normal').toLowerCase()] || PRIORITY_STYLES.normal;
  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.pending;

  const isShadow = item.shadow_mode && item.source === 'nova_ai';

  function handleApprove() {
    if (isShadow) {
      if (hasEdits) {
        onDecide(item.id, 'execute', editedText);
      } else {
        onDecide(item.id, 'execute');
      }
    } else if (hasEdits) {
      onDecide(item.id, 'approve', textToAdf(editedText));
    } else {
      onDecide(item.id, 'approve');
    }
  }

  function handleConfirm() {
    onDecide(item.id, 'confirm');
  }

  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  function handleDecline() {
    if (!showDeclineForm) {
      setShowDeclineForm(true);
      return;
    }
    if (!declineReason.trim()) return;
    onDecide(item.id, 'decline', undefined, declineReason.trim());
  }

  function handleExecute() {
    onDecide(item.id, 'execute');
  }

  function handleCancel() {
    onDecide(item.id, 'cancel');
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
              <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${item.source === 'nova_ai' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca]' : 'bg-violet-500/15 text-violet-400'}`}>
                {item.source === 'nova_ai' ? 'NOVA AI' : 'n8n AI'}
              </span>
              {isShadow && (
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-purple-500/15 text-purple-400">
                  SHADOW
                </span>
              )}
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
          {/* Brief card */}
          {briefFields && (
            <TicketBriefCard
              ticketKey={item.ticket_id}
              fields={briefFields}
              tier={(briefFields.customfield_12981 as any)?.value ?? null}
              compact
            />
          )}
          {item.ticket_id && <AINextActionCard ticketKey={item.ticket_id} compact />}

          {/* NOVA AI Decision Context */}
          {item.source === 'nova_ai' && (
            <div className="border border-[#5ec1ca]/30 rounded-lg bg-[#5ec1ca]/5 p-4 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#5ec1ca] mb-1">AI Decision</div>

              {/* Action + Confidence row */}
              <div className="flex items-center gap-2 flex-wrap">
                {item.action_type && (() => {
                  const info = getActionInfo(item.action_type);
                  if (!info) return null;
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded border ${info.color}`}>
                      <i className={`fas ${info.icon} text-[10px]`} />
                      {info.label}
                    </span>
                  );
                })()}

                {item.confidence != null && (() => {
                  const cs = confidenceStyle(item.confidence);
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-[12px] font-semibold rounded ${cs.color}`}>
                      <span className="relative w-12 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                        <span className={`absolute inset-y-0 left-0 rounded-full ${cs.bg}`} style={{ width: `${Math.round(item.confidence! * 100)}%` }} />
                      </span>
                      {cs.label}
                    </span>
                  );
                })()}

                {item.confidence === 1.0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded bg-neutral-500/20 text-neutral-300 border border-neutral-500/30">
                    <i className="fas fa-microchip text-[9px]" />
                    Deterministic Rule
                  </span>
                )}
              </div>

              {/* Action summary — tells the reviewer what will happen */}
              {item.action_type && (() => {
                const info = getActionInfo(item.action_type);
                if (!info?.summary) return null;
                return (
                  <div className="text-[13px] text-neutral-300 bg-[#1f242b] rounded px-3 py-2 border border-[#3a424d]">
                    <i className="fas fa-arrow-right text-[10px] text-neutral-500 mr-2" />
                    <span className="font-medium">If approved:</span> {info.summary}
                  </div>
                );
              })()}

              {/* Low confidence warning */}
              {item.confidence != null && item.confidence < 0.6 && (
                <div className="text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                  <i className="fas fa-exclamation-triangle mr-1.5" />
                  Low confidence ({Math.round(item.confidence * 100)}%) — review carefully before approving
                </div>
              )}

              {/* No action info banner */}
              {item.action_type === 'no_action' && (
                <div className="text-[12px] text-neutral-400 bg-neutral-500/10 border border-neutral-500/20 rounded px-3 py-2">
                  <i className="fas fa-info-circle mr-1.5" />
                  NOVA determined no action is needed. This is informational only — there is nothing to approve or execute.
                </div>
              )}

              {/* Action-specific context */}
              {item.action_type === 'plugin_to_tpj' && (
                <div className="text-[12px] text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded px-3 py-2">
                  <i className="fas fa-share mr-1.5" />
                  Routing ticket to <span className="font-semibold">TPJ project</span> (third-party Jira)
                </div>
              )}

              {item.action_type === 'abuse_report' && (() => {
                const classification = parseAbuseClassification(item.ai_response_adf);
                return (
                  <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                    <i className="fas fa-shield-halved mr-1.5" />
                    Abuse detected{classification ? `: ${classification}` : ''}
                  </div>
                );
              })()}

              {/* Reasoning (collapsible) */}
              {item.reasoning && (
                <details className="group">
                  <summary className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 cursor-pointer select-none hover:text-neutral-400 list-none flex items-center gap-1.5">
                    <i className="fas fa-chevron-right text-[8px] transition-transform group-open:rotate-90" />
                    AI Reasoning
                  </summary>
                  <div className="text-[13px] text-neutral-300 whitespace-pre-wrap bg-[#1f242b] rounded px-3 py-2 border border-[#3a424d] mt-1">
                    {item.reasoning}
                  </div>
                </details>
              )}

              {/* Draft response preview */}
              {item.action_type === 'draft_response' && (() => {
                const draft = parseDraftResponse(item.ai_response_adf);
                if (!draft) return null;
                return (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Draft Response (will be sent to customer)</div>
                    <div className="text-[13px] text-neutral-200 whitespace-pre-wrap bg-[#272C33] rounded-lg px-4 py-3 border-2 border-blue-500/30">
                      {draft}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

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
                <span className="text-neutral-500 text-[11px]">Assignee</span>
                <div className="text-neutral-300">{item.assignee_name || <span className="text-neutral-600 italic">Unassigned</span>}</div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">BC Account</span>
                <div>{item.bc_account_number ? <span className="text-amber-300 font-mono font-semibold">{item.bc_account_number}</span> : <span className="text-red-400 italic text-[11px]">Not set</span>}</div>
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
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-2">
                AI Proposed Resolution
                <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded normal-case tracking-normal ${item.source === 'nova_ai' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca]' : 'bg-violet-500/15 text-violet-400'}`}>
                  {item.source === 'nova_ai' ? 'NOVA AI' : 'n8n AI'}
                </span>
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
        {isPending && (
          <div className="px-5 py-4 border-t border-[#3a424d] bg-[#1f242b]">
            {showDeclineForm && (
              <div className="mb-3">
                <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5 block">Decline Reason (required)</label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Why is this resolution being declined?"
                  className="w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 placeholder-neutral-600 focus:border-red-500/50 focus:outline-none resize-none"
                  rows={3}
                  autoFocus
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className={`text-[12px] ${URGENCY_COLORS[expiryDisplay.urgency]}`}>
                <i className="fas fa-clock mr-1" />
                Expires: {expiryDisplay.text}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { if (showDeclineForm) { setShowDeclineForm(false); setDeclineReason(''); } else { handleCancel(); } }}
                  className="border border-[#3a424d] text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
                >
                  {showDeclineForm ? 'Cancel' : 'Dismiss'}
                </button>
                {canInteract && item.action_type !== 'no_action' && (
                  <>
                    <button
                      onClick={handleDecline}
                      disabled={showDeclineForm && !declineReason.trim()}
                      className={`bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors ${showDeclineForm && !declineReason.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {showDeclineForm ? 'Confirm Decline' : 'Decline'}
                    </button>
                    {!showDeclineForm && isShadow && (
                      <>
                        <button
                          onClick={handleConfirm}
                          className="bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
                          title="AI was correct — record as learning, no Jira action"
                        >
                          Confirm Correct
                        </button>
                        {hasEdits ? (
                          <button
                            onClick={handleApprove}
                            className="bg-[#5ec1ca] hover:bg-[#4db0ba] text-[#272C33] px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
                            title="Execute the edited response on Jira"
                          >
                            Edit & Execute
                          </button>
                        ) : (
                          <button
                            onClick={handleApprove}
                            className="bg-[#5ec1ca] hover:bg-[#4db0ba] text-[#272C33] px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors"
                            title="Execute the action on Jira now"
                          >
                            Execute Action
                          </button>
                        )}
                      </>
                    )}
                    {!showDeclineForm && !isShadow && (
                      hasEdits ? (
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
                      )
                    )}
                  </>
                )}
              </div>
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
              {item.status === 'cancelled' && <span className="text-neutral-400">Cancelled</span>}
              {item.decided_by && <span> by {item.decided_by}</span>}
              {item.decided_at && <span> {timeAgo(item.decided_at)}</span>}
            </div>
            {item.status === 'declined' && item.decline_reason && (
              <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-[12px] text-red-300">
                <span className="font-semibold text-red-400">Reason: </span>{item.decline_reason}
              </div>
            )}
            {item.status === 'declined' && canInteract && onReReview && (
              <div className="mt-3 flex flex-col gap-2">
                <button
                  onClick={async () => {
                    setReReviewLoading(true);
                    setReReviewError(null);
                    const result = await onReReview(item.id);
                    setReReviewLoading(false);
                    if (!result.ok) setReReviewError(result.error ?? 'Re-review failed');
                  }}
                  disabled={reReviewLoading}
                  className="w-full bg-[#5ec1ca]/15 hover:bg-[#5ec1ca]/25 text-[#5ec1ca] border border-[#5ec1ca]/30 px-4 py-2 rounded-lg font-semibold text-[13px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {reReviewLoading ? (
                    <>
                      <i className="fas fa-spinner fa-spin text-[11px]" />
                      AI is re-reviewing...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-rotate text-[11px]" />
                      Re-review with AI feedback
                    </>
                  )}
                </button>
                <p className="text-[11px] text-neutral-500 text-center">
                  The AI will re-analyse this ticket using your decline reason as guidance
                </p>
                {reReviewError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded px-3 py-2 text-[12px] text-red-300">
                    {reReviewError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
