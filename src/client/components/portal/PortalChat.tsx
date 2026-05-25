import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PortalChatSession,
  PortalChatMessage,
  ChatMessageMetadata,
  IntakeCollectedFields,
  PortalStatus,
} from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = '.png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xlsx,.csv,.txt,.zip,.log';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadedFile {
  file: File;
  preview?: string;
}

interface Props {
  onNavigateToTicket?: (ticketKey: string) => void;
  autoStart?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  website: 'My Website',
  account: 'My Account',
  email_marketing: 'Email Marketing',
  leadpro: 'LeadPro & CRM',
  data_feeds: 'Data Feeds & Integrations',
  listings: 'Property Listings',
  onboarding: 'Onboarding & Setup',
  billing: 'Billing & Contracts',
  security: 'Website Security',
  general_request: 'General Service Request',
  followup: 'Reopened / Follow-up',
  complaint: 'Complaint / Escalation',
  other: 'Something Else',
};

function getSessionStatusLabel(session: PortalChatSession): PortalStatus {
  if (session.jira_issue_key) {
    return 'Submitted';
  }

  switch (session.status) {
    case 'resolved':
      return 'Resolved';
    case 'abandoned':
      return 'Closed';
    case 'active':
    case 'escalated':
    case 'handed_off':
    default:
      return 'In Progress';
  }
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-1 my-1">{listItems}</ul>);
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    const listMatch = line.match(/^[-•]\s+(.+)/);
    if (listMatch) {
      listItems.push(<li key={i}>{inlineMarkdown(listMatch[1])}</li>);
      return;
    }
    flushList();
    if (line.trim() === '') {
      elements.push(<br key={i} />);
    } else {
      elements.push(<span key={i}>{inlineMarkdown(line)}{i < lines.length - 1 ? '\n' : ''}</span>);
    }
  });
  flushList();

  return <span className="whitespace-pre-wrap">{elements}</span>;
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (match[2]) {
      parts.push(<em key={match.index}>{match[2]}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export default function PortalChat({ onNavigateToTicket, autoStart }: Props) {
  const [sessions, setSessions] = useState<PortalChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<PortalChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmedTicket, setConfirmedTicket] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    pf('/api/portal/chat/sessions')
      .then(r => r.json())
      .then(data => { if (data.ok) setSessions(data.data || []); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (autoStart && !autoStarted.current && !activeSessionId) {
      autoStarted.current = true;
      startNewSession();
    }
  }, [autoStart, activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startNewSession = async () => {
    setLoading(true);
    setConfirmedTicket(null);
    setFiles([]);
    try {
      const res = await pf('/api/portal/chat/sessions', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setActiveSessionId(data.data.id);
        setMessages([]);
        setSessions(prev => [data.data, ...prev]);
      }
    } catch (err) {
      console.error('Failed to start session:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSession = async (id: number) => {
    setLoading(true);
    setConfirmedTicket(null);
    setFiles([]);
    try {
      const res = await pf(`/api/portal/chat/sessions/${id}`);
      const data = await res.json();
      if (data.ok) {
        setActiveSessionId(id);
        setMessages(data.data.messages || []);
        // Check if this session was already confirmed
        const sess = data.data.session as PortalChatSession;
        setSessions(prev => prev.map(existing => existing.id === id ? sess : existing));
        if (sess.jira_issue_key) {
          setConfirmedTicket(sess.jira_issue_key);
        }
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (overrideText?: string) => {
    const text = overrideText || input.trim();
    if (!text || !activeSessionId || sending) return;

    const userMessage = text;
    if (!overrideText) setInput('');
    setSending(true);

    const tempMsg: PortalChatMessage = {
      id: Date.now(),
      session_id: activeSessionId,
      role: 'user',
      content: userMessage,
      metadata: null,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await pf(`/api/portal/chat/sessions/${activeSessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: userMessage }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessages(prev => [...prev, data.data]);
        // Detect typed confirmation that created a ticket
        const msgMeta = data.data.metadata ? (() => { try { return JSON.parse(data.data.metadata); } catch { return null; } })() : null;
        if (msgMeta?.type === 'confirmed' && msgMeta.ticketKey) {
          setConfirmedTicket(msgMeta.ticketKey);
          setSessions(prev => prev.map(s =>
            s.id === activeSessionId ? { ...s, jira_issue_key: msgMeta.ticketKey, status: 'handed_off' as const } : s
          ));
        }
      } else {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          session_id: activeSessionId,
          role: 'assistant',
          content: data.error || "We couldn't continue the chat just now. Please try again, or submit your request through the portal form.",
          metadata: null,
          created_at: new Date().toISOString(),
        }]);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        session_id: activeSessionId,
        role: 'assistant',
        content: "We couldn't continue the chat just now. Please try again, or submit your request through the portal form.",
        metadata: null,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  };

  const endSession = async () => {
    if (!activeSessionId) return;
    try {
      await pf(`/api/portal/chat/sessions/${activeSessionId}/end`, { method: 'POST' });
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, status: 'resolved' as const } : s));
      setActiveSessionId(null);
      setMessages([]);
      setConfirmedTicket(null);
      setFiles([]);
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const toAdd: UploadedFile[] = [];
    for (const file of Array.from(newFiles)) {
      if (file.size > MAX_FILE_SIZE) continue;
      const entry: UploadedFile = { file };
      if (file.type.startsWith('image/')) entry.preview = URL.createObjectURL(file);
      toAdd.push(entry);
    }
    setFiles(prev => [...prev, ...toAdd]);
  }, []);

  const removeFile = (index: number) => {
    setFiles(prev => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleConfirmSubmit = async (editedFields: Record<string, unknown>) => {
    if (!activeSessionId || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await pf(`/api/portal/chat/sessions/${activeSessionId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ fields: editedFields }),
      });
      const data = await res.json();
      if (data.ok) {
        const ticketKey = data.data?.ticketKey;
        if (!ticketKey) {
          setSubmitError('The request was created but we could not retrieve the reference. Please check My Tickets.');
          return;
        }
        setConfirmedTicket(ticketKey);
        setSessions(prev => prev.map(session => (
          session.id === activeSessionId
            ? { ...session, jira_issue_key: ticketKey, status: 'handed_off' as const }
            : session
        )));

        // Upload attachments if any
        for (const { file } of files) {
          const formData = new FormData();
          formData.append('file', file);
          try {
            await pf(`/api/portal/tickets/${ticketKey}/attachments`, {
              method: 'POST',
              body: formData,
            });
          } catch {
            console.warn(`Failed to upload ${file.name}`);
          }
        }
      } else {
        setSubmitError(data.error || 'Something went wrong creating your request. Please try again.');
      }
    } catch (err) {
      console.error('Failed to confirm:', err);
      setSubmitError('We couldn\'t reach the server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Parse message metadata
  const getMessageMeta = (msg: PortalChatMessage): ChatMessageMetadata | null => {
    if (!msg.metadata) return null;
    try {
      return JSON.parse(msg.metadata) as ChatMessageMetadata;
    } catch {
      return null;
    }
  };

  return (
    <div className="flex h-[calc(100vh-220px)] gap-4">
      {/* Session sidebar */}
      <div className="w-64 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden flex-shrink-0 hidden md:flex">
        <div className="p-3 border-b border-gray-100">
          <button
            onClick={startNewSession}
            disabled={loading}
            aria-label="Start new conversation"
            className="w-full px-3 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
          >
            New Conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-600">
              No previous conversations
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  aria-label={`Conversation from ${new Date(s.started_at).toLocaleDateString()} — ${getSessionStatusLabel(s)}${s.jira_issue_key ? `, ticket ${s.jira_issue_key}` : ''}`}
                  className={`w-full px-3 py-3 text-left hover:bg-gray-50 transition-colors focus-visible:ring-2 focus-visible:ring-brand outline-none ${
                    s.id === activeSessionId ? 'bg-brand/5' : ''
                  }`}
                >
                  <div className="text-xs text-gray-600">{new Date(s.started_at).toLocaleDateString()}</div>
                  <div className="text-sm text-gray-700 mt-0.5">{getSessionStatusLabel(s)}</div>
                  {s.jira_issue_key && (
                    <div className="text-xs text-brand mt-0.5">{s.jira_issue_key}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        {!activeSessionId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-brand/15 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">How can we help?</h2>
              <p className="text-sm text-gray-600 mb-6">
                Tell us what you need — report an issue, ask a question, request a change, or check on a ticket.
              </p>
              <button
                onClick={startNewSession}
                disabled={loading}
                className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
              >
                Get help
              </button>
            </div>
          </div>
        ) : confirmedTicket ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Request Submitted</h2>
              <p className="text-gray-600 mb-6">
                Your ticket <span className="font-mono font-medium text-brand">{confirmedTicket}</span> has been created. Our team will review it shortly.
              </p>
              <div className="flex gap-3 justify-center">
                {onNavigateToTicket && (
                  <button
                    onClick={() => onNavigateToTicket(confirmedTicket)}
                    className="px-5 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors text-sm font-medium"
                  >
                    View Ticket
                  </button>
                )}
                <button
                  onClick={startNewSession}
                  className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Start a new conversation
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-gray-900">Support Assistant</span>
              </div>
              <button
                onClick={endSession}
                aria-label="End conversation"
                className="text-xs text-gray-600 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-brand outline-none"
              >
                End conversation
              </button>
            </div>

            {/* Messages */}
            <div role="log" aria-live="polite" className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-sm text-gray-600 py-8">
                  How can we help you today? Describe your issue, question, or request.
                </div>
              )}
              {messages.map(msg => {
                const meta = getMessageMeta(msg);
                if (meta?.type === 'summary_card' && meta.fields) {
                  return (
                    <SummaryCard
                      key={msg.id}
                      fields={meta.fields}
                      files={files}
                      isDragging={isDragging}
                      fileInputRef={fileInputRef}
                      onAddFiles={addFiles}
                      onRemoveFile={removeFile}
                      onDragStateChange={setIsDragging}
                      onConfirm={handleConfirmSubmit}
                      onEditInChat={(text) => { setInput(text); }}
                      submitting={submitting}
                      submitError={submitError}
                      timestamp={msg.created_at}
                    />
                  );
                }

                if ((meta?.type === 'category_picker' || meta?.type === 'subcategory_picker') && meta.categories) {
                  const handlePickerClick = (name: string) => {
                    sendMessage(name);
                  };
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[85%]">
                        <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-900 mb-2">
                          {renderMarkdown(msg.content)}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-1">
                          {meta.categories.map((cat: { id: string; name: string; description: string }) => (
                            <button
                              key={cat.id}
                              onClick={() => handlePickerClick(cat.name)}
                              disabled={sending}
                              aria-label={cat.description ? `${cat.name} — ${cat.description}` : cat.name}
                              className="text-left bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-brand/50 hover:shadow-sm transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand outline-none"
                            >
                              <div className="text-sm font-medium text-gray-900">{cat.name}</div>
                              {cat.description && (
                                <div className="text-xs text-gray-600 mt-0.5">{cat.description}</div>
                              )}
                            </button>
                          ))}
                        </div>
                        <div className="text-xs text-gray-600 mt-2 ml-1">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (meta?.type === 'kb_suggestions' && meta.articles && Array.isArray(meta.articles)) {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%]">
                        <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-900 mb-2">
                          {renderMarkdown(msg.content)}
                        </div>
                        <div className="space-y-2 ml-1">
                          {meta.articles.map((article: { id: number; title: string; excerpt: string }) => (
                            <div key={article.id} role="article" aria-label={article.title} className="bg-white border border-gray-200 rounded-lg p-3 hover:border-brand/40 hover:shadow-sm transition-all">
                              <div className="text-sm font-medium text-gray-900">{article.title}</div>
                              <div className="text-xs text-gray-600 mt-1 line-clamp-2">{article.excerpt}</div>
                            </div>
                          ))}
                          <button
                            onClick={() => { setInput("These articles don't answer my question"); }}
                            aria-label="None of these articles help, continue to ticket creation"
                            className="text-xs text-gray-600 hover:text-brand transition-colors mt-1 focus-visible:ring-2 focus-visible:ring-brand outline-none rounded"
                          >
                            None of these help
                          </button>
                        </div>
                        <div className="text-xs text-gray-600 mt-1 ml-1">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-brand text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}>
                      <div className="whitespace-pre-wrap">
                        {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                      </div>
                      <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-white/70' : 'text-gray-600'}`}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-gray-100">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  aria-label="Chat message input"
                  rows={1}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm resize-none"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || sending}
                  aria-label="Send message"
                  className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Summary Card Component ──

interface SummaryCardProps {
  fields: IntakeCollectedFields & { category: string | null; subcategory: string | null };
  files: UploadedFile[];
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (index: number) => void;
  onDragStateChange: (dragging: boolean) => void;
  onConfirm: (fields: Record<string, unknown>) => void;
  onEditInChat: (text: string) => void;
  submitting: boolean;
  submitError: string | null;
  timestamp: string;
}

function SummaryCard({
  fields,
  files,
  isDragging,
  fileInputRef,
  onAddFiles,
  onRemoveFile,
  onDragStateChange,
  onConfirm,
  onEditInChat,
  submitting,
  submitError,
  timestamp,
}: SummaryCardProps) {
  const [editField, setEditField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const getValue = (key: string): string => {
    if (editValues[key] !== undefined) return editValues[key];
    return (fields as unknown as Record<string, unknown>)[key] as string || '';
  };

  const setFieldValue = (key: string, value: string) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
    setEditField(null);
  };

  const handleConfirm = () => {
    const merged = { ...fields, ...editValues };
    onConfirm(merged);
  };

  const followUpKey = getValue('followUpTicketKey');
  const followUpSummary = getValue('followUpTicketSummary');
  const relatedTicketValue = followUpKey ? `${followUpKey}${followUpSummary ? ` — ${followUpSummary}` : ''}` : '';

  const rows: Array<{ key: string; label: string; value: string; editable?: boolean }> = [
    { key: 'subject', label: 'Subject', value: getValue('subject') },
    { key: 'category', label: 'Request type', value: CATEGORY_LABELS[getValue('category')] || getValue('category') },
    { key: 'relatedTicket', label: 'Related ticket', value: relatedTicketValue, editable: false },
    { key: 'account', label: 'Account', value: getValue('account') },
    { key: 'description', label: 'Description', value: getValue('description') },
    { key: 'url', label: 'URL', value: getValue('url') },
    { key: 'errorMessage', label: 'Error message', value: getValue('errorMessage') },
    { key: 'browser', label: 'Browser', value: getValue('browser') },
  ].filter(r => r.value);

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="text-sm font-medium text-gray-900">Request Summary</div>
            <div className="text-xs text-gray-500 mt-0.5">Review and confirm your details</div>
          </div>

          <div className="divide-y divide-gray-100">
            {rows.map(({ key, label, value, editable }) => (
              <div key={key} className="px-4 py-2.5 flex items-start gap-3">
                <div className="text-xs font-medium text-gray-500 w-24 flex-shrink-0 pt-0.5">{label}</div>
                <div className="flex-1 min-w-0">
                  {editField === key ? (
                    <div className="flex gap-2">
                      {key === 'description' ? (
                        <textarea
                          defaultValue={value}
                          autoFocus
                          rows={3}
                          className="flex-1 px-2 py-1 text-sm border border-brand rounded focus:outline-none resize-none"
                          onBlur={e => setFieldValue(key, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') setEditField(null); }}
                        />
                      ) : (
                        <input
                          defaultValue={value}
                          autoFocus
                          className="flex-1 px-2 py-1 text-sm border border-brand rounded focus:outline-none"
                          onBlur={e => setFieldValue(key, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') setFieldValue(key, (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') setEditField(null);
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-1 group">
                      <div className="text-sm text-gray-900 whitespace-pre-wrap flex-1">{value}</div>
                      {key !== 'category' && editable !== false && (
                        <button
                          onClick={() => setEditField(key)}
                          className="p-0.5 text-gray-300 hover:text-brand transition-colors opacity-0 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-brand outline-none rounded focus-visible:opacity-100"
                          aria-label={`Edit ${label}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Urgency dropdown */}
            <div className="px-4 py-2.5 flex items-center gap-3">
              <div className="text-xs font-medium text-gray-500 w-24 flex-shrink-0">Urgency</div>
              <select
                value={editValues.urgency || fields.urgency || 'Normal'}
                onChange={e => setEditValues(prev => ({ ...prev, urgency: e.target.value }))}
                aria-label="Urgency"
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="Normal">Normal</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            {/* Contact preference dropdown */}
            <div className="px-4 py-2.5 flex items-center gap-3">
              <div className="text-xs font-medium text-gray-500 w-24 flex-shrink-0">Contact</div>
              <select
                value={editValues.contactPreference || fields.contactPreference || 'portal'}
                onChange={e => setEditValues(prev => ({ ...prev, contactPreference: e.target.value }))}
                aria-label="Contact preference"
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="portal">Portal reply</option>
                <option value="email">Email</option>
                <option value="phone">Phone callback</option>
              </select>
            </div>
          </div>

          {/* File attachment area */}
          <div className="px-4 py-3 border-t border-gray-100">
            <div
              onDragOver={e => { e.preventDefault(); onDragStateChange(true); }}
              onDragLeave={() => onDragStateChange(false)}
              onDrop={e => { e.preventDefault(); onDragStateChange(false); if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }}}
              role="button"
              tabIndex={0}
              aria-label="Attach files"
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-brand outline-none ${
                isDragging ? 'border-brand bg-brand/5' : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <p className="text-xs text-gray-600">Drop files here or click to attach screenshots</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_TYPES}
                onChange={e => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
              />
            </div>

            {files.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-xs">
                    {f.preview ? (
                      <img src={f.preview} alt="" className="w-8 h-8 object-cover rounded" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center">
                        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-700 truncate">{f.file.name}</div>
                      <div className="text-gray-400">{formatFileSize(f.file.size)}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); onRemoveFile(i); }} aria-label={`Remove file ${f.file.name}`} className="p-0.5 text-gray-400 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-brand outline-none rounded">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
            {submitError && (
              <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {submitError}
              </div>
            )}
            <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting...' : submitError ? 'Try again' : 'Submit request'}
            </button>
            <button
              onClick={() => onEditInChat('I want to change ')}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              Edit in chat
            </button>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-600 mt-1 ml-1">
          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
