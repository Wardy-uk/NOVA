import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PortalChatSession, PortalChatMessage, ChatMessageMetadata, IntakeCollectedFields } from '../../../shared/portal-types.js';

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
  other: 'Something Else',
};

export default function PortalChat({ onNavigateToTicket, autoStart }: Props) {
  const [sessions, setSessions] = useState<PortalChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<PortalChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmedTicket, setConfirmedTicket] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  const sendMessage = async () => {
    if (!input.trim() || !activeSessionId || sending) return;

    const userMessage = input.trim();
    setInput('');
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
      }
    } catch (err) {
      console.error('Failed to send message:', err);
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

    try {
      const res = await pf(`/api/portal/chat/sessions/${activeSessionId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ fields: editedFields }),
      });
      const data = await res.json();
      if (data.ok) {
        const ticketKey = data.data.ticketKey;
        setConfirmedTicket(ticketKey);

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
      }
    } catch (err) {
      console.error('Failed to confirm:', err);
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
            className="w-full px-3 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors"
          >
            New Conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No previous conversations
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  className={`w-full px-3 py-3 text-left hover:bg-gray-50 transition-colors ${
                    s.id === activeSessionId ? 'bg-brand/5' : ''
                  }`}
                >
                  <div className="text-xs text-gray-500">{new Date(s.started_at).toLocaleDateString()}</div>
                  <div className="text-sm text-gray-700 mt-0.5">
                    {s.status === 'active' ? 'Active' : s.status === 'resolved' ? 'Resolved' : s.status}
                  </div>
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
              <p className="text-sm text-gray-500 mb-6">
                Tell us what you need — report an issue, ask a question, request a change, or check on a ticket.
              </p>
              <button
                onClick={startNewSession}
                disabled={loading}
                className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors"
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
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
              >
                End conversation
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-sm text-gray-500 py-8">
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
                      timestamp={msg.created_at}
                    />
                  );
                }

                if (meta?.type === 'kb_suggestions' && meta.articles && Array.isArray(meta.articles)) {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%]">
                        <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-900 mb-2">
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                        <div className="space-y-2 ml-1">
                          {meta.articles.map((article: { id: number; title: string; excerpt: string }) => (
                            <div key={article.id} className="bg-white border border-gray-200 rounded-lg p-3 hover:border-brand/40 hover:shadow-sm transition-all">
                              <div className="text-sm font-medium text-gray-900">{article.title}</div>
                              <div className="text-xs text-gray-500 mt-1 line-clamp-2">{article.excerpt}</div>
                            </div>
                          ))}
                          <button
                            onClick={() => { setInput("These articles don't answer my question"); }}
                            className="text-xs text-gray-500 hover:text-brand transition-colors mt-1"
                          >
                            None of these help
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 ml-1">
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
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
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
                  rows={1}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm resize-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                  className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'subject', label: 'Subject', value: getValue('subject') },
    { key: 'category', label: 'Category', value: CATEGORY_LABELS[getValue('category')] || getValue('category') },
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
            {rows.map(({ key, label, value }) => (
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
                      {key !== 'category' && (
                        <button
                          onClick={() => setEditField(key)}
                          className="p-0.5 text-gray-300 hover:text-brand transition-colors opacity-0 group-hover:opacity-100"
                          title={`Edit ${label}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-brand bg-brand/5' : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <p className="text-xs text-gray-500">Drop files here or click to attach screenshots</p>
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
                    <button onClick={e => { e.stopPropagation(); onRemoveFile(i); }} className="p-0.5 text-gray-400 hover:text-red-500">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-3">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit request'}
            </button>
            <button
              onClick={() => onEditInChat('I want to change ')}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              Edit in chat
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-400 mt-1 ml-1">
          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
