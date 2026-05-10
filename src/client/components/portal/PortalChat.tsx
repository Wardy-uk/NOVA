import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PortalChatSession, PortalChatMessage } from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

interface Props {
  onNavigateToTicket?: (ticketKey: string) => void;
}

export default function PortalChat({ onNavigateToTicket }: Props = {}) {
  const [sessions, setSessions] = useState<PortalChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<PortalChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pf('/api/portal/chat/sessions')
      .then(r => r.json())
      .then(data => { if (data.ok) setSessions(data.data || []); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startNewSession = async () => {
    setLoading(true);
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
    try {
      const res = await pf(`/api/portal/chat/sessions/${id}`);
      const data = await res.json();
      if (data.ok) {
        setActiveSessionId(id);
        setMessages(data.data.messages || []);
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

    // Optimistic: add user message immediately
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
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  const handleHandoff = async () => {
    if (!activeSessionId) return;
    if (!confirm('This will create a support ticket with our conversation history. Continue?')) return;
    try {
      const res = await pf(`/api/portal/chat/sessions/${activeSessionId}/end`, {
        method: 'POST',
        body: JSON.stringify({ handoff: true }),
      });
      const data = await res.json();
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, status: 'escalated' as const } : s));
      setActiveSessionId(null);
      setMessages([]);
      if (data.ok && data.data?.jira_issue_key && onNavigateToTicket) {
        onNavigateToTicket(data.data.jira_issue_key);
      }
    } catch (err) {
      console.error('Failed to create handoff ticket:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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
            className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
                    s.id === activeSessionId ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="text-xs text-gray-500">{new Date(s.started_at).toLocaleDateString()}</div>
                  <div className="text-sm text-gray-700 mt-0.5">
                    {s.status === 'active' ? 'Active' : s.status === 'resolved' ? 'Resolved' : s.status}
                  </div>
                  {s.jira_issue_key && (
                    <div className="text-xs text-blue-600 mt-0.5">{s.jira_issue_key}</div>
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
              <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Chat with Nurtur Support</h2>
              <p className="text-sm text-gray-500 mb-6">
                Our AI assistant can help answer questions, troubleshoot issues, or create a support ticket for you.
              </p>
              <button
                onClick={startNewSession}
                disabled={loading}
                className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Start a conversation
              </button>
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
                  How can we help you today?
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
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
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 text-center">
                <button
                  onClick={handleHandoff}
                  className="text-xs text-gray-400 hover:text-blue-600 transition-colors inline-flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Talk to a human
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
