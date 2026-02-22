import { useState, useEffect } from 'react';
import type { Task } from '../../shared/types.js';
import { StandupCard } from './StandupCard.js';

type Mode = 'morning' | 'replan' | 'eod';

interface TaskRef {
  task_id: string;
  reason?: string;
  note?: string;
  task: Task | null;
}

interface MorningData {
  summary: string;
  overdue: TaskRef[];
  due_today: TaskRef[];
  top_priorities: TaskRef[];
  rolled_over: TaskRef[];
  ritual_id: number;
}

interface ReplanData {
  summary: string;
  adjusted_priorities: TaskRef[];
}

interface EodData {
  summary: string;
  accomplished: string[];
  rolling_over: TaskRef[];
  insights: string;
  ritual_id: number;
}

interface Ritual {
  id: number;
  type: string;
  date: string;
  summary_md: string | null;
  created_at: string;
}

interface Props {
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  onNavigate: (view: string) => void;
}

export function StandupView({ onUpdateTask, onNavigate }: Props) {
  const [mode, setMode] = useState<Mode>('morning');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Morning state
  const [morning, setMorning] = useState<MorningData | null>(null);
  const [morningChecked, setMorningChecked] = useState<Set<string>>(new Set());

  // Replan state
  const [replan, setReplan] = useState<ReplanData | null>(null);

  // EOD state
  const [eod, setEod] = useState<EodData | null>(null);

  // Shared
  const [blockers, setBlockers] = useState('');
  const [notes, setNotes] = useState('');

  // History
  const [history, setHistory] = useState<Ritual[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Check if morning already exists today
  const [hasMorning, setHasMorning] = useState(false);

  useEffect(() => {
    fetch('/api/standups/today')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setHasMorning(json.data.hasMorning);
          if (json.data.hasMorning) setMode('replan');
        }
      })
      .catch(() => {});
  }, []);

  const runMorning = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/standups/morning', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Failed to generate briefing');
        return;
      }
      setMorning(json.data);
      setHasMorning(true);
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  const runReplan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/standups/replan', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Failed to generate re-plan');
        return;
      }
      setReplan(json.data);
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  const runEod = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/standups/eod', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Failed to generate review');
        return;
      }
      setEod(json.data);
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  const toggleChecked = (id: string) => {
    setMorningChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveMorning = async () => {
    if (!morning) return;
    // Mark checked tasks as done
    for (const id of morningChecked) {
      onUpdateTask(id, { status: 'done' });
    }
    // Update ritual with blockers/notes
    if (blockers || notes) {
      await fetch(`/api/standups/${morning.ritual_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockers: blockers || undefined,
          summary_md: notes ? `${morning.summary}\n\n**Notes:** ${notes}` : undefined,
        }),
      });
    }
    onNavigate('tasks');
  };

  const saveEod = async () => {
    if (!eod) return;
    if (notes) {
      await fetch(`/api/standups/${eod.ritual_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary_md: `${eod.summary}\n\n**Notes:** ${notes}`,
        }),
      });
    }
    onNavigate('tasks');
  };

  const loadHistory = async () => {
    if (history.length > 0) {
      setShowHistory(!showHistory);
      return;
    }
    try {
      const res = await fetch('/api/standups/history?limit=20');
      const json = await res.json();
      if (json.ok) {
        setHistory(json.data);
        setShowHistory(true);
      }
    } catch { /* ignore */ }
  };

  const renderTaskList = (items: TaskRef[], options?: {
    checkable?: boolean;
    numbered?: boolean;
  }) => {
    if (items.length === 0) {
      return <p className="text-neutral-500 text-sm italic">None</p>;
    }
    return (
      <div className="space-y-1.5">
        {items.map((item, i) => {
          if (!item.task) return null;
          return (
            <div key={item.task_id} className="flex items-start gap-2">
              {options?.numbered && (
                <span className="text-[#5ec1ca] font-bold text-sm shrink-0 mt-0.5 w-5 text-right">
                  {i + 1}.
                </span>
              )}
              <div className="flex-1">
                <StandupCard
                  task={item.task}
                  reason={item.reason}
                  note={item.note}
                  checked={options?.checkable ? morningChecked.has(item.task_id) : undefined}
                  onToggle={options?.checkable ? toggleChecked : undefined}
                  onUpdate={onUpdateTask}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const modeButtons = [
    { key: 'morning' as Mode, label: 'Morning', icon: '09:00' },
    { key: 'replan' as Mode, label: 'Re-Plan', icon: '13:00' },
    { key: 'eod' as Mode, label: 'End of Day', icon: '17:00' },
  ];

  return (
    <div className="space-y-6">
      {/* Mode tabs */}
      <div className="flex items-center gap-2">
        {modeButtons.map((m) => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setError(null); }}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              mode === m.key
                ? 'bg-[#5ec1ca] text-[#272C33] border-[#5ec1ca] font-semibold'
                : 'bg-[#2f353d] text-neutral-400 border-[#3a424d] hover:bg-[#363d47] hover:text-neutral-200'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="border border-[#3a424d] rounded-lg px-5 py-8 bg-[#2f353d] flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#5ec1ca] border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">
            {mode === 'morning' && 'N.O.V.A is preparing your morning briefing...'}
            {mode === 'replan' && 'N.O.V.A is re-assessing your priorities...'}
            {mode === 'eod' && 'N.O.V.A is reviewing your day...'}
          </p>
        </div>
      )}

      {/* ========== MORNING ========== */}
      {mode === 'morning' && !loading && (
        <>
          {!morning ? (
            <div className="border border-[#3a424d] rounded-lg px-5 py-8 bg-[#2f353d] text-center">
              <h2 className="text-lg font-semibold text-neutral-100 mb-2">Morning Standup</h2>
              <p className="text-sm text-neutral-400 mb-4">
                {hasMorning
                  ? "You've already run today's morning standup. Run again to refresh."
                  : 'N.O.V.A will analyse your tasks and prepare a briefing.'}
              </p>
              <button
                onClick={runMorning}
                className="px-5 py-2.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors text-sm"
              >
                Start Standup
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Summary */}
              <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
                <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-2">
                  N.O.V.A Briefing
                </h3>
                <p className="text-sm text-neutral-200 leading-relaxed">{morning.summary}</p>
              </div>

              {/* Overdue */}
              {morning.overdue.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-red-400">
                    Overdue ({morning.overdue.length})
                  </h3>
                  {renderTaskList(morning.overdue, { checkable: true })}
                </section>
              )}

              {/* Due Today */}
              {morning.due_today.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-amber-400">
                    Due Today ({morning.due_today.length})
                  </h3>
                  {renderTaskList(morning.due_today, { checkable: true })}
                </section>
              )}

              {/* Rolled Over */}
              {morning.rolled_over.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-orange-400">
                    Rolled Over from Yesterday ({morning.rolled_over.length})
                  </h3>
                  {renderTaskList(morning.rolled_over, { checkable: true })}
                </section>
              )}

              {/* Top Priorities */}
              <section>
                <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-[#5ec1ca]">
                  Top Priorities
                </h3>
                {renderTaskList(morning.top_priorities, { numbered: true, checkable: true })}
              </section>

              {/* Blockers + Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-neutral-400 uppercase tracking-widest font-semibold mb-1.5">
                    Blockers
                  </label>
                  <textarea
                    value={blockers}
                    onChange={(e) => setBlockers(e.target.value)}
                    placeholder="Any blockers today?"
                    className="w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none resize-none h-20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 uppercase tracking-widest font-semibold mb-1.5">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything else?"
                    className="w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none resize-none h-20"
                  />
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button
                  onClick={saveMorning}
                  className="px-5 py-2.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors text-sm"
                >
                  Save & Close
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ========== REPLAN ========== */}
      {mode === 'replan' && !loading && (
        <>
          {!replan ? (
            <div className="border border-[#3a424d] rounded-lg px-5 py-8 bg-[#2f353d] text-center">
              <h2 className="text-lg font-semibold text-neutral-100 mb-2">Quick Re-Plan</h2>
              <p className="text-sm text-neutral-400 mb-4">
                N.O.V.A will re-assess your priorities based on what's changed since this morning.
              </p>
              <button
                onClick={runReplan}
                className="px-5 py-2.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors text-sm"
              >
                Re-Plan
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
                <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-2">
                  N.O.V.A Re-Assessment
                </h3>
                <p className="text-sm text-neutral-200 leading-relaxed">{replan.summary}</p>
              </div>

              <section>
                <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-[#5ec1ca]">
                  Adjusted Priorities
                </h3>
                {renderTaskList(replan.adjusted_priorities, { numbered: true })}
              </section>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setReplan(null)}
                  className="px-4 py-2 text-sm bg-[#2f353d] text-neutral-400 hover:text-neutral-200 rounded-lg border border-[#3a424d] transition-colors"
                >
                  Re-run
                </button>
                <button
                  onClick={() => onNavigate('tasks')}
                  className="px-5 py-2.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors text-sm"
                >
                  Back to Tasks
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ========== END OF DAY ========== */}
      {mode === 'eod' && !loading && (
        <>
          {!eod ? (
            <div className="border border-[#3a424d] rounded-lg px-5 py-8 bg-[#2f353d] text-center">
              <h2 className="text-lg font-semibold text-neutral-100 mb-2">End of Day Review</h2>
              <p className="text-sm text-neutral-400 mb-4">
                N.O.V.A will review what you accomplished today and what's rolling over.
              </p>
              <button
                onClick={runEod}
                className="px-5 py-2.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors text-sm"
              >
                Start Review
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
                <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-2">
                  N.O.V.A Day Review
                </h3>
                <p className="text-sm text-neutral-200 leading-relaxed">{eod.summary}</p>
              </div>

              {/* Accomplished */}
              {eod.accomplished.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-green-400">
                    Accomplished
                  </h3>
                  <div className="space-y-1">
                    {eod.accomplished.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 px-3 py-2 rounded-md bg-[#272C33] border border-[#3a424d]"
                      >
                        <span className="text-green-400 shrink-0 mt-0.5">&#10003;</span>
                        <span className="text-sm text-neutral-200">{item}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Rolling Over */}
              {eod.rolling_over.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-widest font-semibold mb-2 text-orange-400">
                    Rolling Over ({eod.rolling_over.length})
                  </h3>
                  {renderTaskList(eod.rolling_over)}
                </section>
              )}

              {/* Insights */}
              {eod.insights && (
                <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
                  <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-2">
                    N.O.V.A Insights
                  </h3>
                  <p className="text-sm text-neutral-300 leading-relaxed italic">{eod.insights}</p>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs text-neutral-400 uppercase tracking-widest font-semibold mb-1.5">
                  End of Day Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reflect on the day..."
                  className="w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none resize-none h-20"
                />
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button
                  onClick={saveEod}
                  className="px-5 py-2.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors text-sm"
                >
                  Save & Close
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ========== HISTORY ========== */}
      <div className="border-t border-[#3a424d] pt-4">
        <button
          onClick={loadHistory}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors uppercase tracking-widest font-semibold"
        >
          {showHistory ? 'Hide History' : 'Show History'}
        </button>

        {showHistory && history.length > 0 && (
          <div className="mt-3 space-y-2">
            {history.map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-3 px-4 py-3 rounded-md bg-[#2f353d] border border-[#3a424d]"
              >
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded text-white shrink-0 ${
                  r.type === 'morning' ? 'bg-amber-600' : 'bg-indigo-600'
                }`}>
                  {r.type === 'morning' ? 'AM' : 'EOD'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-neutral-500">{r.date}</div>
                  {r.summary_md && (
                    <p className="text-sm text-neutral-300 mt-0.5 line-clamp-2">{r.summary_md}</p>
                  )}
                </div>
                <span className="text-[10px] text-neutral-600 shrink-0">
                  {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}

        {showHistory && history.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500 italic">No past standups yet.</p>
        )}
      </div>
    </div>
  );
}
