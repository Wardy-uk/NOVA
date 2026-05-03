import { useState, useEffect, useMemo } from 'react';
import { createWorkingDayClock } from '../../shared/utils/workingDayClock.js';
import { JiraNotConnected } from './JiraNotConnected.js';

interface Props {
  ticketKey: string;
  onClose: () => void;
  onSent: () => void;
}

type Tone = 'friendly' | 'formal';

function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

const clock = createWorkingDayClock();

function formatCommitment(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function HoldingUpdatePanel({ ticketKey, onClose, onSent }: Props) {
  const [tone, setTone] = useState<Tone>('friendly');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [nextUpdateAt, setNextUpdateAt] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDraft = async (t: Tone) => {
    setRegenerating(true);
    try {
      const res = await fetch('/api/agent/holding-update/draft', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey, tone: t }),
      });
      const json = await res.json();
      if (json.ok) {
        setDraft(json.data.draft);
        setError(null);
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

  useEffect(() => { fetchDraft(tone); }, []);

  const quickPicks = useMemo(() => {
    const now = new Date();
    return [
      { label: 'Tomorrow', iso: clock.addWorkingDays(now, 1).toISOString() },
      { label: '2 working days', iso: clock.addWorkingDays(now, 2).toISOString() },
      { label: '3 working days', iso: clock.addWorkingDays(now, 3).toISOString() },
      { label: '1 week', iso: clock.addWorkingDays(now, 5).toISOString() },
    ];
  }, []);

  const handleToneChange = (t: Tone) => {
    setTone(t);
    fetchDraft(t);
  };

  const handleCustomDate = (val: string) => {
    setCustomDate(val);
    if (val) setNextUpdateAt(new Date(val).toISOString());
  };

  const handleSend = async () => {
    if (!nextUpdateAt || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/holding-update/send', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey, message: draft, nextUpdateAt, tone }),
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
              Holding Update — {ticketKey}
            </h2>
            <span className="text-[10px] text-neutral-500">SOP-008: Customer hasn't heard from you</span>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
        </div>

        {/* Section A: Draft */}
        <div className="px-5 py-4 border-b border-[#2A2F38]">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-neutral-400">Draft update</label>
            <div className="flex items-center gap-1.5">
              {(['friendly', 'formal'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => handleToneChange(t)}
                  disabled={regenerating}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    tone === t
                      ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/40'
                      : 'bg-[#141820] text-neutral-500 border border-[#2A2F38] hover:text-neutral-300'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
              <button
                onClick={() => fetchDraft(tone)}
                disabled={regenerating}
                className="px-2 py-0.5 text-[10px] bg-[#141820] text-neutral-500 border border-[#2A2F38] rounded hover:text-neutral-300 transition-colors disabled:opacity-40"
              >
                {regenerating ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
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
          <div className="text-[10px] text-neutral-600 mt-1">{draft.length} chars</div>
        </div>

        {/* Section B: Commitment */}
        <div className="px-5 py-4">
          <label className="text-xs text-neutral-400 block mb-2">When will you next update the customer?</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {quickPicks.map(qp => (
              <button
                key={qp.label}
                onClick={() => { setNextUpdateAt(qp.iso); setCustomDate(''); }}
                className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors border ${
                  nextUpdateAt === qp.iso
                    ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40 text-neutral-100'
                    : 'bg-[#141820] border-[#2A2F38] text-neutral-400 hover:bg-[#1E232B]'
                }`}
              >
                {qp.label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={customDate}
            onChange={e => handleCustomDate(e.target.value)}
            className="w-full px-3 py-1.5 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 focus:border-[#5ec1ca] outline-none"
          />
          {nextUpdateAt && (
            <div className="mt-2 text-[11px] text-[#5ec1ca]">
              Next update: {formatCommitment(nextUpdateAt)}
            </div>
          )}
          {!nextUpdateAt && (
            <div className="mt-2 text-[10px] text-amber-500">
              A commitment is required before sending
            </div>
          )}
        </div>

        {/* Error */}
        {jiraDisconnected && <JiraNotConnected />}
        {error && !jiraDisconnected && (
          <div className="mx-5 mb-3 text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
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
            disabled={sending || !nextUpdateAt || !draft.trim()}
            className="px-4 py-1.5 text-xs bg-[#5ec1ca] text-[#0f172a] font-semibold rounded-lg disabled:opacity-40 transition-colors hover:bg-[#4db0b9]"
          >
            {sending ? 'Sending...' : 'Send & Set Commitment'}
          </button>
        </div>
      </div>
    </div>
  );
}
