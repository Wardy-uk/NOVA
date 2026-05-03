import { useState, useEffect, useCallback } from 'react';

interface Props {
  ticketKey: string;
  ticketSummary: string;
  onClose: () => void;
  onEscalate: () => void;
}

type StepId = 'kb_search' | 'colleague' | 'known_issues' | 'escalate';
type StepOutcome = 'resolved' | 'not_helpful' | null;

interface Step {
  id: StepId;
  question: string;
  resolvedLabel: string;
  notHelpfulLabel: string;
}

const STEPS: Step[] = [
  { id: 'kb_search', question: 'Have you searched the Knowledge Base?', resolvedLabel: 'Found a solution', notHelpfulLabel: 'Nothing relevant' },
  { id: 'colleague', question: 'Have you asked a colleague who\'s handled similar tickets?', resolvedLabel: 'Got help', notHelpfulLabel: 'No one available' },
  { id: 'known_issues', question: 'Have you checked the known issues list?', resolvedLabel: 'Found matching issue', notHelpfulLabel: 'Not listed' },
  { id: 'escalate', question: 'Still stuck? Time to escalate.', resolvedLabel: 'Escalated', notHelpfulLabel: '' },
];

interface SimilarAgent {
  agentName: string;
  ticketKey: string;
  summary: string;
}

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export function StuckHelperPanel({ ticketKey, ticketSummary, onClose, onEscalate }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [outcomes, setOutcomes] = useState<StepOutcome[]>([null, null, null, null]);
  const [similarAgents, setSimilarAgents] = useState<SimilarAgent[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [done, setDone] = useState(false);

  const kbSearchUrl = `https://nurturtech.atlassian.net/wiki/search?text=${encodeURIComponent(ticketSummary)}`;
  const knownIssuesUrl = 'https://nurturtech.atlassian.net/wiki/spaces/NSSH/pages';

  const fetchSimilar = useCallback(async () => {
    setLoadingSimilar(true);
    try {
      const res = await fetch('/api/agent/workspace/queue-fast', { headers: authHeaders() });
      const json = await res.json();
      if (json.ok && json.data?.tickets) {
        const words = ticketSummary.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const matches: SimilarAgent[] = [];
        for (const t of json.data.tickets) {
          if (t.key === ticketKey) continue;
          const summary = (t.summary ?? '').toLowerCase();
          const matchCount = words.filter(w => summary.includes(w)).length;
          if (matchCount >= 2 && t.assignee) {
            matches.push({ agentName: t.assignee, ticketKey: t.key, summary: t.summary });
          }
          if (matches.length >= 3) break;
        }
        setSimilarAgents(matches);
      }
    } catch { /* silent */ }
    finally { setLoadingSimilar(false); }
  }, [ticketKey, ticketSummary]);

  useEffect(() => { fetchSimilar(); }, [fetchSimilar]);

  const markStep = (stepIndex: number, outcome: StepOutcome) => {
    const next = [...outcomes];
    next[stepIndex] = outcome;
    setOutcomes(next);

    if (outcome === 'resolved') {
      completeHelper(stepIndex + 1, next);
    } else if (stepIndex < STEPS.length - 1) {
      setCurrentStep(stepIndex + 1);
    }
  };

  const completeHelper = async (resolvedAtStep: number, finalOutcomes: StepOutcome[]) => {
    setDone(true);
    const stepsTried = STEPS
      .map((s, i) => finalOutcomes[i] ? s.id : null)
      .filter(Boolean) as string[];

    try {
      await fetch('/api/my-tickets/events', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          event_type: 'action_taken',
          ticket_key: ticketKey,
          payload: {
            action_type: 'stuck_helper',
            resolved_at_step: resolvedAtStep,
            steps_tried: stepsTried,
          },
        }),
      });
    } catch { /* silent */ }
  };

  const handleEscalate = () => {
    const next = [...outcomes];
    next[3] = 'resolved';
    setOutcomes(next);
    completeHelper(4, next);
    onEscalate();
  };

  if (done && currentStep < 3) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative bg-[#1A1F26] border border-[#2A2F38] rounded-xl w-full max-w-md mx-4 shadow-2xl p-6 text-center" onClick={e => e.stopPropagation()}>
          <div className="text-emerald-400 text-2xl mb-2">&#10003;</div>
          <p className="text-sm text-neutral-200 mb-1">Resolved at step {currentStep + 1}</p>
          <p className="text-xs text-neutral-500 mb-4">Nice one. Back to your queue.</p>
          <button onClick={onClose} className="px-4 py-1.5 text-xs bg-[#5ec1ca] text-[#0f172a] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors">
            Close
          </button>
        </div>
      </div>
    );
  }

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
              Stuck Helper — {ticketKey}
            </h2>
            <span className="text-[10px] text-neutral-500">SOP-011: Guided troubleshooting steps</span>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
        </div>

        {/* Steps */}
        <div className="px-5 py-4 space-y-3">
          {STEPS.map((step, i) => {
            const outcome = outcomes[i];
            const isCurrent = i === currentStep && !done;
            const isCompleted = outcome !== null;
            const isFuture = i > currentStep && !isCompleted;

            return (
              <div
                key={step.id}
                className={`rounded-lg border p-4 transition-all ${
                  isCurrent
                    ? 'border-[#5ec1ca]/40 bg-[#5ec1ca]/5'
                    : isCompleted
                    ? outcome === 'resolved'
                      ? 'border-emerald-800/30 bg-emerald-900/10'
                      : 'border-[#2A2F38] bg-[#141820]/60'
                    : 'border-[#2A2F38] bg-[#141820]/30 opacity-40'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Step indicator */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold ${
                    isCompleted
                      ? outcome === 'resolved'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-700 text-neutral-400'
                      : isCurrent
                      ? 'bg-[#5ec1ca] text-[#0f172a]'
                      : 'bg-[#272C33] text-neutral-500'
                  }`}>
                    {isCompleted ? (outcome === 'resolved' ? '✓' : '✕') : i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium mb-2 ${isCurrent ? 'text-neutral-100' : 'text-neutral-400'}`}>
                      {step.question}
                    </p>

                    {/* Step-specific content */}
                    {isCurrent && step.id === 'kb_search' && (
                      <a
                        href={kbSearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-3 py-1.5 text-[11px] bg-[#272C33] hover:bg-[#2A2F38] text-[#5ec1ca] rounded-lg transition-colors mb-2"
                      >
                        Search KB &rarr;
                      </a>
                    )}

                    {isCurrent && step.id === 'colleague' && (
                      <div className="mb-2">
                        {loadingSimilar ? (
                          <p className="text-[10px] text-neutral-500">Searching for similar tickets...</p>
                        ) : similarAgents.length > 0 ? (
                          <div className="space-y-1">
                            <p className="text-[10px] text-neutral-500 mb-1">Agents who handled similar tickets:</p>
                            {similarAgents.map(sa => (
                              <div key={sa.ticketKey} className="text-[11px] text-neutral-300 bg-[#272C33] rounded px-2 py-1">
                                <span className="font-medium text-[#5ec1ca]">{sa.agentName}</span>
                                {' — '}
                                <span className="text-neutral-500">{sa.ticketKey}</span>
                                {' '}
                                <span className="text-neutral-400">{sa.summary.slice(0, 60)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-neutral-500">No similar resolved tickets found. Try asking in the team channel.</p>
                        )}
                      </div>
                    )}

                    {isCurrent && step.id === 'known_issues' && (
                      <a
                        href={knownIssuesUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-3 py-1.5 text-[11px] bg-[#272C33] hover:bg-[#2A2F38] text-[#5ec1ca] rounded-lg transition-colors mb-2"
                      >
                        View Known Issues &rarr;
                      </a>
                    )}

                    {isCurrent && step.id === 'escalate' && (
                      <button
                        onClick={handleEscalate}
                        className="px-3 py-1.5 text-[11px] bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors mb-2"
                      >
                        Start Escalation
                      </button>
                    )}

                    {/* Toggle buttons */}
                    {isCurrent && step.id !== 'escalate' && !isCompleted && (
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          onClick={() => markStep(i, 'resolved')}
                          className="px-2.5 py-1 text-[10px] bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/30 rounded-lg transition-colors"
                        >
                          {step.resolvedLabel}
                        </button>
                        <button
                          onClick={() => markStep(i, 'not_helpful')}
                          className="px-2.5 py-1 text-[10px] bg-[#272C33] hover:bg-[#2A2F38] text-neutral-400 border border-[#2A2F38] rounded-lg transition-colors"
                        >
                          {step.notHelpfulLabel}
                        </button>
                      </div>
                    )}

                    {/* Completed state */}
                    {isCompleted && !isFuture && (
                      <p className="text-[10px] text-neutral-500">
                        {outcome === 'resolved' ? step.resolvedLabel : step.notHelpfulLabel}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2A2F38] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
