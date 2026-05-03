import { useState } from 'react';
import { JiraNotConnected } from './JiraNotConnected.js';

interface Props {
  ticketKey: string;
  suggestedDestination?: 'tier2' | 'production' | 'development';
  aiContext?: { headline?: string; body?: string };
  onClose: () => void;
  onEscalated: () => void;
}

type Destination = 'tier2' | 'production' | 'development';

const REASONS = [
  'Requires T2 expertise',
  'Configuration change needed',
  'Bug identified — needs development',
  'Customer impact — priority escalation',
  'Third-party dependency',
  'Other',
] as const;

const DESTINATION_LABELS: Record<Destination, string> = {
  tier2: 'Tier 2',
  production: 'Production',
  development: 'Development',
};

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

export function EscalationWizardModal({ ticketKey, suggestedDestination, aiContext, onClose, onEscalated }: Props) {
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [troubleshooting, setTroubleshooting] = useState(aiContext?.body ?? '');
  const [summary, setSummary] = useState('');
  const [destination, setDestination] = useState<Destination>(suggestedDestination ?? 'tier2');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const effectiveReason = reason === 'Other' ? customReason : reason;
  const canNext = [
    () => effectiveReason.length > 0,
    () => troubleshooting.length >= 20,
    () => summary.length >= 30,
    () => true,
  ];

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/agent/escalate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ticketKey,
          destination,
          reason: effectiveReason,
          troubleshooting,
          summary,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onEscalated();
      } else {
        setSubmitError(json.error ?? 'Escalation failed');
        if (json.code === 'JIRA_NOT_CONNECTED') setJiraDisconnected(true);
      }
    } catch {
      setSubmitError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const [jiraDisconnected, setJiraDisconnected] = useState(false);
  const steps = ['Reason', 'Troubleshooting', 'Summary', 'Confirm'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-[#1A1F26] border border-[#2A2F38] rounded-xl w-full max-w-lg mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[#2A2F38]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-neutral-100">
              Escalate {ticketKey} — SOP-002
            </h2>
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1">
            {steps.map((label, i) => (
              <div key={label} className="flex-1">
                <div className={`h-1 rounded-full transition-colors ${i <= step ? 'bg-[#5ec1ca]' : 'bg-[#2A2F38]'}`} />
                <span className={`text-[9px] mt-0.5 block ${i === step ? 'text-[#5ec1ca]' : 'text-neutral-600'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 min-h-[220px]">
          {/* Step 1: Reason */}
          {step === 0 && (
            <div className="space-y-3">
              <label className="text-xs text-neutral-400 block">Why is this being escalated?</label>
              <div className="space-y-1.5">
                {REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors border ${
                      reason === r
                        ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40 text-neutral-100'
                        : 'bg-[#141820] border-[#2A2F38] text-neutral-400 hover:bg-[#1E232B]'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {reason === 'Other' && (
                <input
                  type="text"
                  value={customReason}
                  onChange={e => setCustomReason(e.target.value)}
                  placeholder="Describe the reason..."
                  className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none"
                />
              )}
            </div>
          )}

          {/* Step 2: Troubleshooting */}
          {step === 1 && (
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 block">What have you tried so far?</label>
              <textarea
                value={troubleshooting}
                onChange={e => setTroubleshooting(e.target.value)}
                rows={6}
                placeholder="Include steps taken, results observed, and why they didn't resolve the issue"
                className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
              />
              <div className={`text-[10px] ${troubleshooting.length >= 20 ? 'text-neutral-600' : 'text-amber-500'}`}>
                {troubleshooting.length}/20 minimum
              </div>
            </div>
          )}

          {/* Step 3: Agent summary */}
          {step === 2 && (
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 block">Summary for the receiving team</label>
              <textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                rows={6}
                placeholder="What does T2/Dev need to know? Include account name, impact, and what you need them to do"
                className="w-full px-3 py-2 text-xs bg-[#141820] border border-[#2A2F38] rounded-lg text-neutral-200 placeholder-neutral-600 focus:border-[#5ec1ca] outline-none resize-none"
              />
              <div className={`text-[10px] ${summary.length >= 30 ? 'text-neutral-600' : 'text-amber-500'}`}>
                {summary.length}/30 minimum
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="bg-[#141820] border border-[#2A2F38] rounded-lg p-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Ticket</span>
                  <span className="text-neutral-200 font-mono">{ticketKey}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-500">Destination</span>
                  <select
                    value={destination}
                    onChange={e => setDestination(e.target.value as Destination)}
                    className="bg-[#1A1F26] border border-[#2A2F38] rounded px-2 py-1 text-neutral-200 text-xs focus:border-[#5ec1ca] outline-none"
                  >
                    <option value="tier2">Tier 2</option>
                    <option value="production">Production</option>
                    <option value="development">Development</option>
                  </select>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-0.5">Reason</span>
                  <span className="text-neutral-300">{effectiveReason}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-0.5">Troubleshooting</span>
                  <span className="text-neutral-300 whitespace-pre-wrap">{troubleshooting}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-0.5">Agent summary</span>
                  <span className="text-neutral-300 whitespace-pre-wrap">{summary}</span>
                </div>
              </div>
              {jiraDisconnected && <JiraNotConnected />}
              {submitError && !jiraDisconnected && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2A2F38] flex justify-between">
          <button
            onClick={() => step === 0 ? onClose() : setStep(step - 1)}
            className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext[step]()}
              className="px-4 py-1.5 text-xs bg-[#5ec1ca] text-[#0f172a] font-semibold rounded-lg disabled:opacity-40 transition-colors hover:bg-[#4db0b9]"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-1.5 text-xs bg-amber-500 text-[#0f172a] font-semibold rounded-lg disabled:opacity-40 transition-colors hover:bg-amber-400"
            >
              {submitting ? 'Submitting...' : 'Submit Escalation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
