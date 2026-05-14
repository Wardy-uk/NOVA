import React, { useState, useEffect, useRef } from 'react';

interface Message {
  id: number;
  role: 'bot' | 'user';
  content: string;
  timestamp: Date;
}

interface WidgetConfig {
  apiBase: string;
  greeting: string;
  brandColor: string;
  position: 'bottom-right' | 'bottom-left';
}

export default function ChatWidget({ apiBase, greeting, brandColor, position }: WidgetConfig) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && token) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, token]);

  // Add greeting when first opened
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ id: 0, role: 'bot', content: greeting, timestamp: new Date() }]);
    }
  }, [open]);

  const identify = async () => {
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) return;
    setIdentifying(true);
    try {
      const res = await fetch(`${apiBase}/api/portal/widget/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.ok) {
        setToken(data.data.token);
        setSessionId(data.data.sessionId);
      }
    } catch { /* ignore */ }
    setIdentifying(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || !token || sending) return;
    const text = input.trim();
    setInput('');
    const userMsg: Message = { id: Date.now(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);
    setTyping(true);

    try {
      const res = await fetch(`${apiBase}/api/portal/widget/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sessionId, message: text }),
      });
      const data = await res.json();
      if (data.ok && data.data.reply) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'bot',
          content: data.data.reply,
          timestamp: new Date(),
        }]);
        if (data.data.sessionId) setSessionId(data.data.sessionId);
      }
    } catch { /* ignore */ }
    setTyping(false);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const posStyle = position === 'bottom-left'
    ? { '--nw-right': 'auto', '--nw-left': '20px' } as React.CSSProperties
    : {};

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ '--nw-brand': brandColor, ...posStyle } as React.CSSProperties}>
      {/* Chat Panel */}
      <div className={`nw-panel ${open ? 'open' : ''}`}>
        <div className="nw-header">
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>Nurtur Support</div>
            <div style={{ fontSize: '12px', opacity: 0.8 }}>We typically reply within minutes</div>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px', padding: '4px' }}>
            &#x2715;
          </button>
        </div>

        {!token ? (
          <div className="nw-email-form">
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>&#x1F44B;</div>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', color: '#111827' }}>Welcome!</div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px' }}>Enter your email to get started</div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') identify(); }}
              placeholder="you@company.com"
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', marginBottom: '12px', outline: 'none', boxSizing: 'border-box' }}
            />
            <button
              onClick={identify}
              disabled={identifying || !email.trim()}
              style={{ width: '100%', padding: '10px', background: brandColor, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: identifying ? 0.6 : 1 }}
            >
              {identifying ? 'Starting...' : 'Start Chat'}
            </button>
          </div>
        ) : (
          <>
            <div className="nw-messages">
              {messages.map(m => (
                <div key={m.id} className={`nw-msg ${m.role}`}>
                  {m.content}
                  <div className="nw-time">{formatTime(m.timestamp)}</div>
                </div>
              ))}
              {typing && (
                <div className="nw-typing">
                  <span /><span /><span />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="nw-input-area">
              <input
                ref={inputRef}
                type="text"
                className="nw-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                disabled={sending}
              />
              <button className="nw-send" onClick={sendMessage} disabled={!input.trim() || sending}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Floating Bubble */}
      {!open && (
        <button className="nw-bubble" onClick={() => setOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
    </div>
  );
}
