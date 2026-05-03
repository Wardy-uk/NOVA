import { useState, useEffect } from 'react';
import { JiraNotConnected } from './JiraNotConnected.js';

interface Props {
  ticketKey: string;
  onClose: () => void;
  onSent: () => void;
  onRedirectToClose: () => void;
}

type ChaseStage = 'day2_nudge' | 'day4_warning' | 'day5_close';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

const STAGE_CONFIG: Record<string, { label: string; color: string; border: string; bg: string }> = {
  day2_nudge: { label: 'Day 2 Nudge — friendly follow-up', color: 'text-[#5ec1ca]', border: 'border-[#5ec1ca]/40', bg: 'bg-[#5ec1ca]/5' },
  day4_warning: { label: 'Day 4 Warning — close notice', color: 'text-amber-400', border: 'border-amber-600/40', bg: 'bg-amber-900/10' },
};

export function ChasePanel({ ticketKey, onClose, onSent, onRedirectToClose }: Props) {
  const [draft, setDraft] = useState('');
  const [stage, setStage] = useState<ChaseStage | null>(null);
  const [daysWaiting, setDaysWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDraft = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/chase/draft', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey }),
      });
      const json = await res.json();
      if (json.ok) {
        if (json.data.redirectToClose) {
          onRedirectToClose();
          return;
        }
        setDraft(json.data.draftMessage);
        setStage(json.data.stage);
        setDaysWaiting(json.data.daysWaiting);
      } else {
        setError(json.error ?? 'Failed to generate draft');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  useEffect(() => { fetchDraft(); }, []);

  const handleSend = async () => {
    if (!draft.trim() || draft.length < 10) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/chase/send', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey, message: draft, stage }),
      });
      const json = await res.json();
      if (json.ok) {
        onSent();
      } else {
        setError(json.error ?? 'Failed to send');
        if (json.code === 'JIRA_NOT_CONNECTED') setJiraDisconnected(true);
      }
    } catch {
      setError('Network error');
    } finally {
      setSending(false);
    }
  };

  const [jiraDisconnected, setJiraDisconnected] = useState(false);
  const cfg = stage ? STAGE_CONFIG[stage] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-[#1A1F26] border border-[#2A2F38] rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[#2A2F38] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              Chase — {ticketKey}
            </h2>
            <span className="text-[10px] text-neutral-500">SOP-003: Customer follow-up cadence</span>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
        </div>

        {/* Stage banner */}
        {cfg && (
          <div className={`mx-5 mt-4 px-3 py-2 rounded-lg border ${cfg.border} ${cfg.bg}`}>
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
        )}

        {/* Info line */}
        {daysWaiting > 0 && (
          <div className="mx-5 mt-2 text-[10px] text-neutral-500">
            Waiting {daysWaiting} working days
          </div>
        )}

        {/* Draft section */}
        <div className="px-5 py-4 border-b border-[#2A2F38]">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-neutral-400">Draft chase message</label>
            <button
              onClick={fetchDraft}
              disabled={regenerating}
              className="px-2 py-0.5 text-[10px] bg-[#141820] text-neutral-500 border border-[#2A2F38] rounded hover:text-neutral-300 transition-colors disabled:opacity-40"
            >
              {regenerating ? 'Generating...' : 'Regenerate'}
            </button>
          </div>

          {loading ? (
            <div className="h-32 bg-[#141820] rounded-lg animate-pulse" />
          ) : (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
            />
          )}
          <div className="text-[10px] text-neutral-600 mt-1">
            {draft.length} chars{draft.length < 10 && draft.length > 0 ? ' (min 10)' : ''}
          </div>
        </div>

        {/* Error */}
        {jiraDisconnected && <JiraNotConnected />}
        {error && !jiraDisconnected && (
          <div className="mx-5 mt-3 text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2A2F38] flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || draft.length < 10}
            className="px-4 py-1.5 text-xs bg-[#5ec1ca] text-[#0f172a] font-semibold rounded-lg disabled:opacity-40 transition-colors hover:bg-[#4db0b9]"
          >
            {sending ? 'Sending...' : 'Send Chase'}
          </button>
        </div>
      </div>
    </div>
  );
}
