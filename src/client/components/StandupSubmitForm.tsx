import { useEffect, useState } from 'react';
import { TEAM_AGENTS } from '../../shared/team-standup.js';

interface ExistingSubmission {
  ticket_count: number | null;
  over_5_count: number | null;
  oldest_ticket: string | null;
  oldest_age: number | null;
  blockers: string | null;
  commitments_json: string | null;
  notes: string | null;
}

const labelCls = 'block text-sm font-medium text-neutral-300 mb-1.5';
const inputCls =
  'w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3.5 py-3 text-[15px] text-neutral-100 ' +
  'placeholder-neutral-500 focus:outline-none focus:border-[#5ec1ca] focus:ring-1 focus:ring-[#5ec1ca]';

export function StandupSubmitForm({ date }: { date: string }) {
  const [agentName, setAgentName] = useState('');
  const [editable, setEditable] = useState(true);
  const [ticketCount, setTicketCount] = useState('');
  const [over5, setOver5] = useState('');
  const [oldestTicket, setOldestTicket] = useState('');
  const [oldestAge, setOldestAge] = useState('');
  const [blockers, setBlockers] = useState('');
  const [commitments, setCommitments] = useState<string[]>([]);
  const [commitmentDraft, setCommitmentDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<'form' | 'submitting' | 'done' | 'closed'>('form');
  const [error, setError] = useState<string | null>(null);

  const niceDate = (() => {
    try {
      return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch { return date; }
  })();

  // When a name is picked, load any existing submission for the day.
  useEffect(() => {
    if (!agentName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/standup/public/${date}?agent=${encodeURIComponent(agentName)}`);
        const json = await res.json();
        if (cancelled || !json.ok) return;
        setEditable(json.data.editable);
        const sub: ExistingSubmission | null = json.data.submission;
        if (sub) {
          setTicketCount(sub.ticket_count?.toString() ?? '');
          setOver5(sub.over_5_count?.toString() ?? '');
          setOldestTicket(sub.oldest_ticket ?? '');
          setOldestAge(sub.oldest_age?.toString() ?? '');
          setBlockers(sub.blockers ?? '');
          setNotes(sub.notes ?? '');
          try { setCommitments(sub.commitments_json ? JSON.parse(sub.commitments_json) : []); } catch { setCommitments([]); }
        }
        if (!json.data.editable && !sub) setPhase('closed');
      } catch { /* ignore — fresh form */ }
    })();
    return () => { cancelled = true; };
  }, [agentName, date]);

  function addCommitment() {
    const v = commitmentDraft.trim();
    if (!v) return;
    setCommitments((c) => [...c, v]);
    setCommitmentDraft('');
  }

  function removeCommitment(i: number) {
    setCommitments((c) => c.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError(null);
    if (!agentName) { setError('Please choose your name.'); return; }
    if (!ticketCount || !over5 || !oldestTicket || !oldestAge || !blockers.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    const allCommitments = commitmentDraft.trim() ? [...commitments, commitmentDraft.trim()] : commitments;
    if (allCommitments.length === 0) { setError('Please add at least one commitment.'); return; }

    setPhase('submitting');
    try {
      const res = await fetch('/api/standup/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          agent_name: agentName,
          ticket_count: Number(ticketCount),
          over_5_count: Number(over5),
          oldest_ticket: oldestTicket.trim(),
          oldest_age: Number(oldestAge),
          blockers: blockers.trim(),
          commitments: allCommitments,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || 'Something went wrong.'); setPhase('form'); return; }
      setCommitments(allCommitments);
      setCommitmentDraft('');
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
          <div className="text-[10px] uppercase tracking-[2px] text-neutral-500 mt-0.5">Daily Standup</div>
        </div>

        <div className="bg-[#2f353d] border border-[#3a424d] rounded-2xl p-6 sm:p-7">
          {phase === 'done' ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-4">✅</div>
              <h1 className="text-xl font-semibold text-neutral-100 mb-2">Thanks {firstName}.</h1>
              <p className="text-neutral-400 text-sm">See you at standup.</p>
              <button
                onClick={() => setPhase('form')}
                className="mt-6 text-sm text-[#5ec1ca] hover:underline"
              >
                Edit my submission
              </button>
            </div>
          ) : phase === 'closed' ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-4">⏰</div>
              <h1 className="text-lg font-semibold text-neutral-100 mb-2">Submissions are closed</h1>
              <p className="text-neutral-400 text-sm">Standup for {niceDate} is already underway.</p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-neutral-100 mb-1">Standup — {niceDate}</h1>
              <p className="text-neutral-500 text-sm mb-5">Submit your numbers and commitments before we meet.</p>

              <div className="space-y-5">
                <div>
                  <label className={labelCls}>Your name <span className="text-red-400">*</span></label>
                  <select value={agentName} onChange={(e) => setAgentName(e.target.value)} className={inputCls}>
                    <option value="">Select your name…</option>
                    {TEAM_AGENTS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {!editable && agentName && (
                  <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
                    Standup is underway — your previous answers are shown but can no longer be changed.
                  </div>
                )}

                <fieldset disabled={!editable} className="space-y-5 disabled:opacity-60">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>My ticket count <span className="text-red-400">*</span></label>
                      <input type="number" inputMode="numeric" value={ticketCount} onChange={(e) => setTicketCount(e.target.value)} className={inputCls} placeholder="0" />
                    </div>
                    <div>
                      <label className={labelCls}>Over 5 days <span className="text-red-400">*</span></label>
                      <input type="number" inputMode="numeric" value={over5} onChange={(e) => setOver5(e.target.value)} className={inputCls} placeholder="0" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Oldest ticket <span className="text-red-400">*</span></label>
                      <input value={oldestTicket} onChange={(e) => setOldestTicket(e.target.value)} className={inputCls} placeholder="NT-10287" />
                    </div>
                    <div>
                      <label className={labelCls}>Oldest age (days) <span className="text-red-400">*</span></label>
                      <input type="number" inputMode="numeric" value={oldestAge} onChange={(e) => setOldestAge(e.target.value)} className={inputCls} placeholder="0" />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Blockers <span className="text-red-400">*</span></label>
                    <textarea
                      value={blockers}
                      onChange={(e) => setBlockers(e.target.value)}
                      rows={3}
                      className={inputCls}
                      placeholder="What's stopping you progressing tickets? If none, write 'None'"
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Commitments <span className="text-red-400">*</span></label>
                    <p className="text-xs text-neutral-500 mb-2">What will you get done? Add at least one.</p>
                    {commitments.length > 0 && (
                      <ul className="space-y-2 mb-3">
                        {commitments.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2.5">
                            <span className="flex-1 text-sm text-neutral-200">{c}</span>
                            <button onClick={() => removeCommitment(i)} className="text-neutral-500 hover:text-red-400 text-lg leading-none px-1" aria-label="Remove">×</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={commitmentDraft}
                        onChange={(e) => setCommitmentDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCommitment(); } }}
                        className={inputCls}
                        placeholder="e.g. Chase Arthur re NT-10287 today"
                      />
                      <button
                        onClick={addCommitment}
                        type="button"
                        className="shrink-0 px-4 rounded-lg bg-[#5ec1ca] text-[#272C33] font-semibold text-sm hover:bg-[#4db0b9] transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Anything else</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Optional" />
                  </div>
                </fieldset>

                {error && <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">{error}</div>}

                {editable && (
                  <button
                    onClick={submit}
                    disabled={phase === 'submitting'}
                    className="w-full py-3.5 rounded-lg bg-[#5ec1ca] text-[#272C33] font-semibold text-[15px] hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
                  >
                    {phase === 'submitting' ? 'Submitting…' : 'Submit my standup'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
