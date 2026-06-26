import { useEffect, useState } from 'react';

const labelCls = 'block text-sm font-medium text-neutral-300 mb-1.5';
const inputCls =
  'w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3.5 py-3 text-[15px] text-neutral-100 ' +
  'placeholder-neutral-500 focus:outline-none focus:border-[#5ec1ca] focus:ring-1 focus:ring-[#5ec1ca]';

export function OneToOneSubmitForm({ token }: { token: string }) {
  const [agentName, setAgentName] = useState('');
  const [dateDisplay, setDateDisplay] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [editable, setEditable] = useState(true);
  const [phase, setPhase] = useState<'loading' | 'form' | 'submitting' | 'done' | 'invalid'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/121/public/${token}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) { setPhase('invalid'); return; }
        setAgentName(json.data.agentName ?? '');
        setDateDisplay(json.data.dateDisplay ?? '');
        setQuestions(json.data.questions ?? []);
        setEditable(json.data.editable);
        const existing: Array<{ question: string; answer: string }> = json.data.answers ?? [];
        if (existing.length) {
          const qs: string[] = json.data.questions ?? [];
          const map: Record<number, string> = {};
          for (const a of existing) {
            const idx = qs.indexOf(a.question);
            if (idx >= 0) map[idx] = a.answer;
          }
          setAnswers(map);
        }
        setPhase('form');
      } catch { if (!cancelled) setPhase('invalid'); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function submit() {
    setError(null);
    setPhase('submitting');
    try {
      const payload = questions.map((q, i) => ({ question: q, answer: (answers[i] ?? '').trim() }));
      const res = await fetch('/api/121/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answers: payload }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || 'Something went wrong.'); setPhase('form'); return; }
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setPhase('form');
    }
  }

  const firstName = agentName.split(' ')[0] || 'there';

  return (
    <div className="min-h-screen bg-[#1e2228] flex flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-[22px] font-bold tracking-[1px] text-[#5ec1ca]">N.O.V.A</div>
          <div className="text-[10px] uppercase tracking-[2px] text-neutral-500 mt-0.5">1-2-1 Prep</div>
        </div>

        <div className="bg-[#2f353d] border border-[#3a424d] rounded-2xl p-6 sm:p-7">
          {phase === 'loading' ? (
            <div className="text-center py-8 text-neutral-400 text-sm">Loading…</div>
          ) : phase === 'invalid' ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-4">🔗</div>
              <h1 className="text-lg font-semibold text-neutral-100 mb-2">Link not valid</h1>
              <p className="text-neutral-400 text-sm">This 1-2-1 prep link has expired or isn't recognised.</p>
            </div>
          ) : phase === 'done' ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-4">✅</div>
              <h1 className="text-xl font-semibold text-neutral-100 mb-2">Thanks {firstName}.</h1>
              <p className="text-neutral-400 text-sm">Your answers have been shared ahead of your 1-2-1.</p>
              {editable && (
                <button onClick={() => setPhase('form')} className="mt-6 text-sm text-[#5ec1ca] hover:underline">
                  Edit my answers
                </button>
              )}
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-neutral-100 mb-1">Your 1-2-1 — {dateDisplay}</h1>
              <p className="text-neutral-500 text-sm mb-5">A few minutes now helps us make the most of our time together.</p>

              {!editable && (
                <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 mb-4">
                  Your 1-2-1 is underway — your answers are shown but can no longer be changed.
                </div>
              )}

              <fieldset disabled={!editable} className="space-y-5 disabled:opacity-60">
                {questions.map((q, i) => (
                  <div key={i}>
                    <label className={labelCls}>{q}</label>
                    <textarea
                      value={answers[i] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                      rows={3}
                      className={inputCls}
                      placeholder="Your thoughts…"
                    />
                  </div>
                ))}
              </fieldset>

              {error && <div className="mt-4 text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">{error}</div>}

              {editable && (
                <button
                  onClick={submit}
                  disabled={phase === 'submitting'}
                  className="mt-5 w-full py-3.5 rounded-lg bg-[#5ec1ca] text-[#272C33] font-semibold text-[15px] hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
                >
                  {phase === 'submitting' ? 'Submitting…' : 'Submit my prep'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
