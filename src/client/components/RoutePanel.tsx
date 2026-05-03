import { useState } from 'react';

interface Props {
  ticketKey: string;
  ticketSummary: string;
  currentAssignee?: string;
  reporterName?: string;
  onClose: () => void;
  onRouted: () => void;
  onEscalate: () => void;
}

interface Destination {
  name: string;
  model: 'A' | 'B';
  tag: string;
  borderColor: string;
  devRedirect?: boolean;
}

const DESTINATIONS: Destination[] = [
  { name: 'NTPJ', model: 'A', tag: 'Model A · closes ticket', borderColor: 'border-blue-500/40' },
  { name: 'Finance', model: 'A', tag: 'Model A · closes ticket', borderColor: 'border-blue-500/40' },
  { name: 'Starberry', model: 'A', tag: 'Model A · closes ticket', borderColor: 'border-blue-500/40' },
  { name: 'Yomdel', model: 'A', tag: 'Model A · closes ticket', borderColor: 'border-blue-500/40' },
  { name: 'Tech Services', model: 'B', tag: 'Model B · keeps ticket open', borderColor: 'border-amber-500/40' },
  { name: 'Dev team', model: 'B', tag: 'Model B · via T2 escalation', borderColor: 'border-amber-500/40', devRedirect: true },
];

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

export function RoutePanel({ ticketKey, ticketSummary, currentAssignee, reporterName, onClose, onRouted, onEscalate }: Props) {
  const [selected, setSelected] = useState<Destination | null>(null);
  const [reason, setReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ newTicketKey?: string; parallelTicketKey?: string } | null>(null);

  const canSubmit = selected && !selected.devRedirect && reason.length >= 10;

  const handleSubmit = async () => {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/route', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ticketKey,
          model: selected.model,
          destination: selected.name,
          reason,
          internalNote: internalNote || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setResult(json.data);
        setTimeout(() => onRouted(), 2000);
      } else {
        setError(json.error ?? 'Failed to route ticket');
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
              Route Ticket — {ticketKey}
            </h2>
            <span className="text-[10px] text-neutral-500">SOP-004: Route to correct team</span>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
        </div>

        {result ? (
          <div className="px-5 py-8 text-center">
            <div className="text-emerald-400 text-sm font-semibold mb-2">Ticket routed successfully</div>
            {result.newTicketKey && (
              <div className="text-xs text-neutral-300">New ticket: <span className="font-mono text-[#5ec1ca]">{result.newTicketKey}</span></div>
            )}
            {result.parallelTicketKey && (
              <div className="text-xs text-neutral-300">Parallel ticket: <span className="font-mono text-[#5ec1ca]">{result.parallelTicketKey}</span></div>
            )}
          </div>
        ) : (
          <>
            {/* Destination picker */}
            <div className="px-5 pt-4">
              <label className="text-xs text-neutral-400 block mb-2">Route destination</label>

              <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">Model A — Hand off (closes NT ticket)</div>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {DESTINATIONS.filter(d => d.model === 'A').map(d => (
                  <button
                    key={d.name}
                    onClick={() => setSelected(d)}
                    className={`text-left px-2.5 py-2 rounded-lg transition-colors border ${
                      selected?.name === d.name
                        ? 'bg-blue-500/10 border-blue-500/40 text-neutral-100'
                        : `bg-[#141820] ${d.borderColor} text-neutral-400 hover:bg-[#1E232B]`
                    }`}
                  >
                    <div className="text-[11px] font-medium">{d.name}</div>
                    <div className="text-[9px] text-neutral-500 mt-0.5">{d.tag}</div>
                  </button>
                ))}
              </div>

              <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">Model B — Retain ownership</div>
              <div className="grid grid-cols-2 gap-1.5">
                {DESTINATIONS.filter(d => d.model === 'B').map(d => (
                  <button
                    key={d.name}
                    onClick={() => setSelected(d)}
                    className={`text-left px-2.5 py-2 rounded-lg transition-colors border ${
                      selected?.name === d.name
                        ? 'bg-amber-500/10 border-amber-500/40 text-neutral-100'
                        : `bg-[#141820] ${d.borderColor} text-neutral-400 hover:bg-[#1E232B]`
                    }`}
                  >
                    <div className="text-[11px] font-medium">{d.name}</div>
                    <div className="text-[9px] text-neutral-500 mt-0.5">{d.tag}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Dev team redirect notice */}
            {selected?.devRedirect && (
              <div className="mx-5 mt-3 px-3 py-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <div className="text-[11px] text-amber-400 mb-2">Dev routing goes through T2 escalation. Use the Escalate action instead.</div>
                <button
                  onClick={onEscalate}
                  className="px-3 py-1.5 text-[11px] bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors"
                >
                  Open Escalation Wizard
                </button>
              </div>
            )}

            {/* Confirmation section */}
            {selected && !selected.devRedirect && (
              <>
                {/* Model banner */}
                <div className={`mx-5 mt-3 px-3 py-2 rounded-lg border ${
                  selected.model === 'A'
                    ? 'bg-blue-500/5 border-blue-500/20'
                    : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                  <span className={`text-[11px] ${selected.model === 'A' ? 'text-blue-400' : 'text-amber-400'}`}>
                    {selected.model === 'A'
                      ? `This will close ${ticketKey} and create a new ticket in ${selected.name}. The other team takes over.`
                      : `This will create a parallel ticket in ${selected.name}. You stay as the customer's point of contact and chase every 3 working days.`
                    }
                  </span>
                </div>

                {/* Reason */}
                <div className="px-5 pt-3">
                  <label className="text-xs text-neutral-400 block mb-1.5">Why does this ticket belong to {selected.name}?</label>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={2}
                    placeholder={`Why does this ticket belong to ${selected.name}?`}
                    className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
                  />
                  <div className={`text-[10px] mt-0.5 ${reason.length >= 10 ? 'text-neutral-600' : 'text-amber-500'}`}>
                    {reason.length}/10 minimum
                  </div>
                </div>

                {/* Internal note */}
                <div className="px-5 pt-2 pb-3">
                  <label className="text-xs text-neutral-400 block mb-1.5">Internal note (optional)</label>
                  <textarea
                    value={internalNote}
                    onChange={e => setInternalNote(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
                    placeholder="Additional context for the receiving team"
                  />
                </div>
              </>
            )}

            {/* SOP-004 reminder */}
            <div className="mx-5 mb-3 px-3 py-2 bg-[#5ec1ca]/5 border border-[#5ec1ca]/20 rounded-lg">
              <span className="text-[10px] text-[#5ec1ca]">
                SOP-004: Don't route on a hunch. If you're not sure which team, ask a T2 agent first.
              </span>
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
        {!result && (
          <div className="px-5 py-3 border-t border-[#2A2F38] flex justify-between">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
            {selected && !selected.devRedirect && (
              <button
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
                className={`px-4 py-1.5 text-xs text-white font-semibold rounded-lg disabled:opacity-40 transition-colors ${
                  selected.model === 'A'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {submitting ? 'Routing...' : `Route to ${selected.name}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
