import { useState, useEffect } from 'react';

interface Props {
  ticketKey: string;
  onClose: () => void;
  onResolved: () => void;
}

const RESOLUTION_TYPES = [
  'No Fault Found',
  'Duplicate',
  'Third-Party / External Resolution',
  'Configuration Change',
  'Request Cancelled / Withdrawn',
  'User Error / How-To Guidance',
  'Fix By Tech Services',
  'Escalation',
] as const;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

export function CloseTicketPanel({ ticketKey, onClose, onResolved }: Props) {
  const [customerMessage, setCustomerMessage] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [resolutionType, setResolutionType] = useState('');
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDraft = async () => {
    setRegenerating(true);
    try {
      const res = await fetch('/api/agent/quick-actions/draft-resolve', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey }),
      });
      const json = await res.json();
      if (json.ok) {
        setCustomerMessage(json.data.customerMessage ?? '');
        setResolutionSummary(json.data.resolutionSummary ?? '');
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

  useEffect(() => { fetchDraft(); }, []);

  const canSubmit = customerMessage.length >= 20
    && resolutionSummary.length >= 10
    && resolutionType !== '';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/quick-actions/resolve', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey, customerMessage, resolutionSummary, resolutionType }),
      });
      const json = await res.json();
      if (json.ok) {
        onResolved();
      } else {
        setError(json.error ?? 'Failed to resolve ticket');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

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
              Close Ticket — {ticketKey}
            </h2>
            <span className="text-[10px] text-neutral-500">SOP-005: Personalised close</span>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
        </div>

        {/* SOP-005 notice */}
        <div className="mx-5 mt-4 px-3 py-2 bg-[#5ec1ca]/5 border border-[#5ec1ca]/20 rounded-lg">
          <span className="text-[10px] text-[#5ec1ca]">
            SOP-005: Every close message must be personalised to this ticket. Review and edit the AI draft before sending.
          </span>
        </div>

        {loading ? (
          <div className="px-5 py-8">
            <div className="animate-pulse space-y-3">
              <div className="h-24 bg-[#141820] rounded-lg" />
              <div className="h-16 bg-[#141820] rounded-lg" />
            </div>
          </div>
        ) : (
          <>
            {/* Customer message */}
            <div className="px-5 pt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-neutral-400">Customer close message</label>
                <button
                  onClick={fetchDraft}
                  disabled={regenerating}
                  className="px-2 py-0.5 text-[10px] bg-[#141820] text-neutral-500 border border-[#2A2F38] rounded hover:text-neutral-300 transition-colors disabled:opacity-40"
                >
                  {regenerating ? 'Generating...' : 'Regenerate'}
                </button>
              </div>
              <textarea
                value={customerMessage}
                onChange={e => setCustomerMessage(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
              />
              <div className={`text-[10px] mt-0.5 ${customerMessage.length >= 20 ? 'text-neutral-600' : 'text-amber-500'}`}>
                {customerMessage.length}/20 minimum
              </div>
            </div>

            {/* Resolution summary (TL;DR) */}
            <div className="px-5 pt-3">
              <label className="text-xs text-neutral-400 block mb-1.5">Resolution summary (TL;DR)</label>
              <textarea
                value={resolutionSummary}
                onChange={e => setResolutionSummary(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
              />
              <div className={`text-[10px] mt-0.5 ${resolutionSummary.length >= 10 ? 'text-neutral-600' : 'text-amber-500'}`}>
                {resolutionSummary.length}/10 minimum
              </div>
            </div>

            {/* Resolution type */}
            <div className="px-5 pt-3 pb-4">
              <label className="text-xs text-neutral-400 block mb-1.5">Resolution type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {RESOLUTION_TYPES.map(rt => (
                  <button
                    key={rt}
                    onClick={() => setResolutionType(rt)}
                    className={`text-left px-2.5 py-1.5 text-[11px] rounded-lg transition-colors border ${
                      resolutionType === rt
                        ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40 text-neutral-100'
                        : 'bg-[#141820] border-[#2A2F38] text-neutral-400 hover:bg-[#1E232B]'
                    }`}
                  >
                    {rt}
                  </button>
                ))}
              </div>
              {!resolutionType && (
                <div className="text-[10px] text-amber-500 mt-1">Required</div>
              )}
            </div>
          </>
        )}

        {/* Error */}
        {error && (
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
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="px-4 py-1.5 text-xs bg-emerald-600 text-white font-semibold rounded-lg disabled:opacity-40 transition-colors hover:bg-emerald-700"
          >
            {submitting ? 'Resolving...' : 'Resolve & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
