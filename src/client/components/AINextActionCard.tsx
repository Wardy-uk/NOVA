import { useState, useEffect } from 'react';

type NextActionState = 'action_ready' | 'waiting' | 'stalled' | 'no_context';

interface NextActionData {
  state: NextActionState;
  headline: string;
  body: string;
  primaryAction: { label: string; jiraTransition: string | null };
  generatedAt: string;
  inputs?: {
    ticketKey: string;
    summary: string;
    status: string;
    tier: string;
    timeInStatus: string;
    activityCount: number;
    awaitingCustomer: boolean;
  };
}

interface Props {
  ticketKey: string;
  compact?: boolean;
  onTransition?: (transitionName: string) => void;
  onEscalate?: (context: { headline: string; body: string }) => void;
}

const STATE_CONFIG: Record<NextActionState, { emoji: string; color: string; bg: string; border: string; label: string }> = {
  action_ready: { emoji: '🟢', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', label: 'Do this next' },
  waiting: { emoji: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', label: 'Sit tight' },
  stalled: { emoji: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', label: 'Needs you' },
  no_context: { emoji: '⚪', color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.25)', label: 'No agent context' },
};

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` };
}

export function AINextActionCard({ ticketKey, compact, onTransition, onEscalate }: Props) {
  const [data, setData] = useState<NextActionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [runningAgent, setRunningAgent] = useState(false);

  useEffect(() => {
    if (!ticketKey) return;
    setLoading(true);
    setError(null);
    fetch(`/api/agent/next-action/${encodeURIComponent(ticketKey)}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(json => {
        if (json.ok) setData(json.data);
        else setError(json.error || 'Failed to load');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [ticketKey]);

  if (loading) {
    return (
      <div
        className="rounded-2xl p-4 animate-pulse"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="h-4 bg-neutral-800 rounded w-48 mb-2" />
        <div className="h-3 bg-neutral-800 rounded w-64" />
      </div>
    );
  }

  if (error || !data) return null;

  const cfg = STATE_CONFIG[data.state] || STATE_CONFIG.no_context;

  const handleRunAgent = async () => {
    setRunningAgent(true);
    try {
      await fetch('/api/agent/sweep', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketKey }) });
      // Refetch after sweep
      const r = await fetch(`/api/agent/next-action/${encodeURIComponent(ticketKey)}`, { headers: authHeaders() });
      const json = await r.json();
      if (json.ok) setData(json.data);
    } catch { /* ignore */ }
    finally { setRunningAgent(false); }
  };

  const handlePrimaryAction = () => {
    if (data.state === 'no_context') {
      handleRunAgent();
      return;
    }
    const transition = data.primaryAction.jiraTransition;
    if (transition && /escalat/i.test(transition) && onEscalate) {
      onEscalate({ headline: data.headline, body: data.body });
      return;
    }
    if (transition && onTransition) {
      onTransition(transition);
    }
  };

  return (
    <div
      className={`rounded-2xl overflow-hidden ${compact ? 'p-3' : 'p-5'}`}
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{cfg.emoji}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
          AI says next — {cfg.label}
        </span>
      </div>

      {/* Headline */}
      <div className="text-[13px] text-neutral-100 leading-relaxed mb-1 font-medium">
        {data.headline}
      </div>

      {/* Body */}
      {data.body && (
        <div className="text-[12px] text-neutral-400 leading-relaxed mb-3">
          {data.body}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handlePrimaryAction}
          disabled={runningAgent || (!data.primaryAction.jiraTransition && data.state !== 'no_context')}
          className="px-3 py-1.5 text-[11px] rounded-lg font-bold disabled:opacity-40 transition-colors"
          style={{
            background: cfg.color,
            color: '#0f172a',
            boxShadow: `0 2px 8px ${cfg.color}40`,
          }}
        >
          {runningAgent ? 'Running...' : data.primaryAction.label}
        </button>

        {data.state !== 'no_context' && (
          <button
            onClick={() => setShowWhy(!showWhy)}
            className="px-3 py-1.5 text-[11px] rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5 transition-colors"
          >
            {showWhy ? 'Hide context' : 'Why this?'}
          </button>
        )}

        {data.state === 'no_context' && (
          <button
            onClick={() => setShowWhy(!showWhy)}
            className="px-3 py-1.5 text-[11px] rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5 transition-colors"
          >
            Why is this empty?
          </button>
        )}
      </div>

      {/* Expansion — "Why this?" */}
      {showWhy && data.inputs && (
        <div
          className="mt-3 pt-3 border-t text-[11px] text-neutral-500 space-y-1"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div className="text-[10px] uppercase tracking-wider font-bold text-neutral-600 mb-1">Inputs seen by AI</div>
          <div>Ticket: <span className="text-neutral-300">{data.inputs.ticketKey}</span></div>
          <div>Status: <span className="text-neutral-300">{data.inputs.status}</span></div>
          <div>Tier: <span className="text-neutral-300">{data.inputs.tier}</span></div>
          <div>Time in status: <span className="text-neutral-300">{data.inputs.timeInStatus}</span></div>
          <div>Activity entries: <span className="text-neutral-300">{data.inputs.activityCount}</span></div>
          <div>Awaiting customer: <span className="text-neutral-300">{data.inputs.awaitingCustomer ? 'Yes' : 'No'}</span></div>
          <div className="text-[10px] text-neutral-600 mt-1">Generated {new Date(data.generatedAt).toLocaleString()}</div>
        </div>
      )}

      {showWhy && data.state === 'no_context' && (
        <div
          className="mt-3 pt-3 border-t text-[11px] text-neutral-500"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          Tickets reach this state only when assignment beat AI processing, or processing failed silently.
          If you see this frequently, check the agent pipeline for failures.
        </div>
      )}
    </div>
  );
}
