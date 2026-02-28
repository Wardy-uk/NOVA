import { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessages(json.history);
      } else {
        setError(json.error ?? 'Failed to send message');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const reset = async () => {
    await fetch('/api/chat/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-neutral-400">
          Chat with N.O.V.A about your tasks, deliveries, and milestones
        </div>
        {messages.length > 0 && (
          <button
            onClick={reset}
            className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors px-2 py-1 rounded hover:bg-[#2f353d]"
          >
            New Conversation
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto space-y-3 mb-3 pr-1"
      >
        {messages.length === 0 && !loading && (
          <div className="text-center py-12 space-y-3">
            <div className="text-2xl">N.O.V.A</div>
            <div className="text-xs text-neutral-500">Ask me anything about your workload, deliveries, or tasks.</div>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {['What\'s overdue?', 'Summarise my deliveries', 'Any milestones this week?'].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="px-3 py-1.5 text-[11px] bg-[#2f353d] text-neutral-300 rounded-full hover:bg-[#363d47] transition-colors border border-[#3a424d]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#5ec1ca] text-[#1f242b]'
                  : 'bg-[#2f353d] text-neutral-200 border border-[#3a424d]'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#2f353d] border border-[#3a424d] px-3 py-2 rounded-lg text-xs text-neutral-400">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-2 px-3 py-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-[#3a424d] pt-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message..."
          className="flex-1 bg-[#272C33] text-neutral-200 text-xs rounded-lg px-4 py-2.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors placeholder:text-neutral-600"
          autoComplete="off"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="px-4 py-2.5 bg-[#5ec1ca] text-[#272C33] text-xs font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
