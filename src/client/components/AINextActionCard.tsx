import { useState, useEffect } from 'react';
import type { PendingDecision } from '../hooks/useMyTicketsQueue.js';

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
  pendingDecision?: PendingDecision | null;
  onDecisionActioned?: () => void;
  onTransition?: (transitionName: string) => void;
  onEscalate?: (context: { headline: string; body: string }) => void;
  onHoldingUpdate?: () => void;
  onCloseTicket?: () => void;
  onRoute?: () => void;
  onChase?: () => void;
  onStuckHelper?: () => void;
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

export function AINextActionCard({ ticketKey, compact, pendingDecision, onDecisionActioned, onTransition, onEscalate, onHoldingUpdate, onCloseTicket, onRoute, onChase, onStuckHelper }: Props) {
  const [data, setData] = useState<NextActionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [runningAgent, setRunningAgent] = useState(false);
  const [decisionActing, setDecisionActing] = useState(false);
  const [decisionResult, setDecisionResult] = useState<string | null>(null);
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [loadingDraft, setLoadingDraft] = useState(false);

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

  const handleOpenEdit = async () => {
    if (!pendingDecision) return;
    setLoadingDraft(true);
    try {
      const r = await fetch(`/api/agent/decisions/${pendingDecision.id}`, { headers: authHeaders() });
      const json = await r.json();
      if (json.ok) {
        const output = json.data?.output ?? {};
        setEditDraft(output.draft_response ?? pendingDecision.draftPreview ?? '');
      } else {
        setEditDraft(pendingDecision.draftPreview ?? '');
      }
    } catch {
      setEditDraft(pendingDecision.draftPreview ?? '');
    } finally {
      setLoadingDraft(false);
      setEditMode(true);
    }
  };

  const handleEditApprove = async () => {
    if (!pendingDecision || !editDraft.trim()) return;
    setDecisionActing(true);
    try {
      const r = await fetch(`/api/agent/decisions/${pendingDecision.id}/decide`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', editedResponse: editDraft.trim() }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || 'Failed');
      setDecisionResult('Executed (edited)');
      setEditMode(false);
      if (onDecisionActioned) setTimeout(onDecisionActioned, 800);
    } catch {
      setDecisionResult('Error');
    } finally {
      setDecisionActing(false);
    }
  };

  const handleDecisionAction = async (action: 'confirm' | 'execute' | 'decline') => {
    if (!pendingDecision) return;
    if (action === 'decline' && !declineReason.trim()) return;
    setDecisionActing(true);
    try {
      const r = await fetch(`/api/agent/decisions/${pendingDecision.id}/decide`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'decline' ? { declineReason: declineReason.trim() } : {}),
        }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || 'Failed');
      const msgs: Record<string, string> = {
        confirm: 'Confirmed',
        execute: 'Executed',
        decline: 'Declined',
      };
      setDecisionResult(msgs[action]);
      setShowDeclineInput(false);
      setDeclineReason('');
      if (onDecisionActioned) setTimeout(onDecisionActioned, 800);
    } catch {
      setDecisionResult('Error');
    } finally {
      setDecisionActing(false);
    }
  };

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
    const label = data.primaryAction.label;
    const transition = data.primaryAction.jiraTransition;
    if (transition && /escalat/i.test(transition) && onEscalate) {
      onEscalate({ headline: data.headline, body: data.body });
      return;
    }
    if (onHoldingUpdate && /update|holding|hasn.t heard/i.test(label)) {
      onHoldingUpdate();
      return;
    }
    if (onCloseTicket && /close|resolve|mark.?resolved|confirmed.?fix/i.test(label)) {
      onCloseTicket();
      return;
    }
    if (onRoute && /route|reassign|wrong.*team|wrong.*queue|misroute|transfer|move.*to|belongs.*to/i.test(label)) {
      onRoute();
      return;
    }
    if (onChase && /chase|follow.?up|nudge|waiting.*customer/i.test(label)) {
      onChase();
      return;
    }
    if (onStuckHelper && data.state === 'stalled') {
      onStuckHelper();
      return;
    }
    if (transition && onTransition) {
      onTransition(transition);
    }
  };

  return (
    <div className="space-y-3">
      {/* Pending AI Decision Banner */}
      {pendingDecision && !decisionResult && (
        <div
          className="rounded-2xl overflow-hidden p-4"
          style={{ background: 'rgba(94,193,202,0.08)', border: '1px solid rgba(94,193,202,0.25)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">💡</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#5ec1ca]">
              AI Draft Ready — Review Needed
            </span>
            {pendingDecision.shadowMode && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-900/60 text-purple-300 border border-purple-700/40">SHADOW</span>
            )}
            <span className="ml-auto text-[10px] text-neutral-500">
              {Math.round(pendingDecision.confidence * 100)}% confidence
              {pendingDecision.category ? ` · ${pendingDecision.category}` : ''}
            </span>
          </div>
          {pendingDecision.draftPreview && (
            <div className="text-[12px] text-neutral-300 leading-relaxed mb-3 line-clamp-3">
              {pendingDecision.draftPreview}
            </div>
          )}
          {!showDeclineInput ? (
            <div className="flex items-center gap-2 flex-wrap">
              {pendingDecision.shadowMode ? (
                <>
                  <button
                    onClick={() => handleDecisionAction('confirm')}
                    disabled={decisionActing}
                    className="px-3 py-1.5 text-[11px] rounded-lg font-bold transition-colors disabled:opacity-40 bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30"
                    title="AI was correct — no Jira action"
                  >
                    {decisionActing ? 'Processing…' : 'Confirm Correct'}
                  </button>
                  <button
                    onClick={() => handleDecisionAction('execute')}
                    disabled={decisionActing}
                    className="px-3 py-1.5 text-[11px] rounded-lg font-bold transition-colors disabled:opacity-40 text-[#0f172a]"
                    style={{ background: '#5ec1ca', boxShadow: '0 2px 8px rgba(94,193,202,0.4)' }}
                    title="Execute this action on Jira now"
                  >
                    {decisionActing ? 'Processing…' : 'Execute Action'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleDecisionAction('execute')}
                    disabled={decisionActing}
                    className="px-3 py-1.5 text-[11px] rounded-lg font-bold transition-colors disabled:opacity-40 text-[#0f172a]"
                    style={{ background: '#10b981', boxShadow: '0 2px 8px rgba(16,185,129,0.4)' }}
                  >
                    {decisionActing ? 'Processing…' : 'Approve'}
                  </button>
                  <button
                    onClick={handleOpenEdit}
                    disabled={decisionActing || loadingDraft}
                    className="px-3 py-1.5 text-[11px] rounded-lg font-semibold text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/10 transition-colors disabled:opacity-40"
                  >
                    {loadingDraft ? 'Loading…' : 'Edit & Approve'}
                  </button>
                </>
              )}
              <button
                onClick={() => setShowDeclineInput(true)}
                disabled={decisionActing}
                className="px-3 py-1.5 text-[11px] rounded-lg font-semibold text-red-400 border border-red-600/30 hover:bg-red-600/20 transition-colors disabled:opacity-40"
              >
                Decline
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
                placeholder="Reason for declining (required)…"
                className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-[11px] rounded p-2 resize-y min-h-[50px] focus:outline-none focus:border-red-500/50"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDecisionAction('decline')}
                  disabled={decisionActing || !declineReason.trim()}
                  className="px-3 py-1.5 text-[11px] rounded-lg font-bold bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors disabled:opacity-40"
                >
                  {decisionActing ? 'Processing…' : 'Confirm Decline'}
                </button>
                <button
                  onClick={() => { setShowDeclineInput(false); setDeclineReason(''); }}
                  className="px-3 py-1.5 text-[11px] rounded-lg font-semibold text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {/* Edit draft panel */}
          {editMode && (
            <div className="mt-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#5ec1ca]">Edit Draft Response</div>
              <textarea
                value={editDraft}
                onChange={e => setEditDraft(e.target.value)}
                className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-[12px] rounded-lg p-3 resize-y min-h-[120px] focus:outline-none focus:border-[#5ec1ca]/50 leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleEditApprove}
                  disabled={decisionActing || !editDraft.trim()}
                  className="px-4 py-1.5 text-[11px] rounded-lg font-bold text-[#0f172a] disabled:opacity-40 transition-colors"
                  style={{ background: '#10b981', boxShadow: '0 2px 8px rgba(16,185,129,0.4)' }}
                >
                  {decisionActing ? 'Sending…' : 'Approve with Edits'}
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="px-3 py-1.5 text-[11px] rounded-lg font-semibold text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {decisionResult && (
        <div
          className="rounded-2xl overflow-hidden p-3 text-center text-[12px] font-semibold"
          style={{
            background: decisionResult === 'Declined' ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
            border: `1px solid ${decisionResult === 'Declined' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
            color: decisionResult === 'Declined' ? '#ef4444' : '#10b981',
          }}
        >
          {decisionResult === 'Executed' ? 'Executed [OVERRIDE]' : decisionResult}
        </div>
      )}

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
    </div>
  );
}
