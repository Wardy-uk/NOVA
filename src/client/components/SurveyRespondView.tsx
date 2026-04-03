import { useState, useEffect } from 'react';

interface Question {
  id: number; order_index: number; question_text: string;
  question_type: string; required: number;
}

interface SurveyData {
  title: string; description: string | null; team_name: string;
  questions: Question[];
}

const SCALE_LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

export function SurveyRespondView({ token }: { token: string }) {
  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [answers, setAnswers] = useState<Record<number, string | number>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'submitting' | 'done' | 'used' | 'invalid'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/survey/${token}`);
        const json = await res.json();
        if (json.ok) {
          setSurvey(json.data);
          setState('ready');
        } else if (res.status === 410) {
          setState('used');
          setErrorMsg(json.error);
        } else {
          setState('invalid');
          setErrorMsg(json.error);
        }
      } catch {
        setState('invalid');
        setErrorMsg('Unable to load survey. Please check your link.');
      }
    })();
  }, [token]);

  const allRequiredAnswered = survey
    ? survey.questions.filter(q => q.required).every(q => {
        const a = answers[q.id];
        if (q.question_type === 'scale_5') return typeof a === 'number';
        return typeof a === 'string' && a.trim().length > 0;
      })
    : false;

  const handleSubmit = async () => {
    if (!survey || !allRequiredAnswered) return;
    setState('submitting');
    try {
      const payload = survey.questions
        .filter(q => answers[q.id] !== undefined && answers[q.id] !== '')
        .map(q => ({ question_id: q.id, value: answers[q.id] }));

      const res = await fetch(`/api/survey/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      const json = await res.json();
      if (json.ok) {
        setState('done');
      } else {
        setState('ready');
        setErrorMsg(json.error || 'Failed to submit');
      }
    } catch {
      setState('ready');
      setErrorMsg('Network error. Please try again.');
    }
  };

  // ── Terminal states ──
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading survey...</div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
            <i className="fa-solid fa-check text-2xl text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Thank you</h2>
          <p className="text-sm text-slate-500">Your response has been recorded. You can close this page.</p>
        </div>
      </div>
    );
  }

  if (state === 'used') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-5">
            <i className="fa-solid fa-circle-check text-2xl text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Already submitted</h2>
          <p className="text-sm text-slate-500">{errorMsg || 'This survey link has already been submitted.'}</p>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
            <i className="fa-solid fa-link-slash text-2xl text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Invalid link</h2>
          <p className="text-sm text-slate-500">{errorMsg || 'This link is not valid or the survey is no longer open.'}</p>
        </div>
      </div>
    );
  }

  // ── Survey form ──
  if (!survey) return null;
  const answeredCount = survey.questions.filter(q => {
    const a = answers[q.id];
    if (q.question_type === 'scale_5') return typeof a === 'number';
    return typeof a === 'string' && a.trim().length > 0;
  }).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-[#3eaab4] to-[#7c3aed] text-white text-lg font-extrabold mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>n</div>
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">{survey.title}</h1>
          <p className="text-sm text-slate-400 mt-1">{survey.team_name}</p>
          {survey.description && <p className="text-sm text-slate-500 mt-2 max-w-lg mx-auto">{survey.description}</p>}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <i className="fa-solid fa-shield-halved text-emerald-500" />
            <span>Your response is completely anonymous</span>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Progress</span>
            <span>{answeredCount} of {survey.questions.length} answered</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#3eaab4] to-[#5ec1ca] rounded-full transition-all duration-300"
              style={{ width: `${(answeredCount / survey.questions.length) * 100}%` }} />
          </div>
        </div>

        {/* Questions */}
        <div className="space-y-6">
          {survey.questions.map((q, i) => (
            <div key={q.id} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <div className="flex items-start gap-3 mb-4">
                <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-gradient-to-br from-[#3eaab4]/10 to-[#7c3aed]/10 text-[#3eaab4] text-xs font-bold">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{q.question_text}</p>
                  {!q.required && <span className="text-[10px] text-slate-300 uppercase tracking-wide">Optional</span>}
                </div>
              </div>

              {q.question_type === 'scale_5' ? (
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map(n => {
                    const selected = answers[q.id] === n;
                    return (
                      <button key={n} onClick={() => setAnswers(prev => ({ ...prev, [q.id]: n }))}
                        className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer min-w-[72px]
                          ${selected
                            ? 'border-[#3eaab4] bg-[#3eaab4]/10 text-[#3eaab4] shadow-sm'
                            : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200 hover:bg-white'}`}
                      >
                        <span className="text-xl font-bold">{n}</span>
                        <span className="text-[9px] leading-tight text-center">{SCALE_LABELS[n - 1]}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <textarea
                    value={(answers[q.id] as string) || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                    rows={3}
                    maxLength={2000}
                    className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-[#3eaab4] focus:ring-2 focus:ring-[#3eaab4]/10 transition resize-none"
                    placeholder="Type your answer here..."
                  />
                  <div className="text-right text-[10px] text-slate-300 mt-1">
                    {((answers[q.id] as string) || '').length}/2000
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {errorMsg && state === 'ready' && (
          <p className="text-sm text-red-500 mt-4 text-center">{errorMsg}</p>
        )}

        {/* Submit */}
        <div className="mt-8 text-center">
          <button
            disabled={!allRequiredAnswered || state === 'submitting'}
            onClick={handleSubmit}
            className={`px-8 py-3 rounded-full text-sm font-semibold transition-all
              ${allRequiredAnswered
                ? 'bg-gradient-to-r from-[#3eaab4] to-[#5ec1ca] text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
          >
            {state === 'submitting' ? (
              <><i className="fa-solid fa-spinner fa-spin mr-2" />Submitting...</>
            ) : (
              <><i className="fa-solid fa-paper-plane mr-2" />Submit Response</>
            )}
          </button>
          {!allRequiredAnswered && (
            <p className="text-xs text-slate-300 mt-2">Please answer all required questions to submit</p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-[10px] text-slate-300">
          Powered by N.O.V.A
        </div>
      </div>
    </div>
  );
}
