import { useState, useEffect } from 'react';
import type { Task } from '../../shared/types.js';
import { JiraDrawer } from './JiraDrawer.js';

interface Suggestion {
  task_id: string;
  reason: string;
  task: Task;
}

interface Props {
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
}

const SOURCE_COLORS: Record<string, string> = {
  jira: 'bg-[#0052CC]',
  planner: 'bg-[#31752F]',
  todo: 'bg-[#797673]',
  monday: 'bg-[#FF6D00]',
  email: 'bg-[#0078D4]',
  calendar: 'bg-[#8764B8]',
};

const SOURCE_LABELS: Record<string, string> = {
  jira: 'JIRA',
  planner: 'PLANNER',
  todo: 'TODO',
  monday: 'MON',
  email: 'EMAIL',
  calendar: 'CAL',
};

export function NextActions({ onUpdateTask }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return window.localStorage.getItem('nova_source_filter') ?? 'all';
  });

  const suggest = async () => {
    setLoading(true);
    setError(null);
    setDismissed(false);
    try {
      const query = sourceFilter !== 'all'
        ? `?source=${encodeURIComponent(sourceFilter)}`
        : '';
      const res = await fetch(`/api/actions/suggest${query}`, { method: 'POST' });
      const json = await res.json();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          'nova_last_suggest',
          JSON.stringify({
            ts: new Date().toISOString(),
            source: sourceFilter,
            ok: json.ok,
            error: json.error ?? null,
            count: json.data?.suggestions?.length ?? 0,
          })
        );
      }
      if (!json.ok) {
        setError(json.error ?? 'Failed to get suggestions');
        return;
      }
      setSuggestions(json.data.suggestions);
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  // Auto-run on first load
  useEffect(() => {
    suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSourceChange = (value: string) => {
    setSourceFilter(value);
    setSuggestions([]);
    setActiveIndex(null);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('nova_source_filter', sourceFilter);
  }, [sourceFilter]);

  const handleAction = (id: string, updates: Record<string, unknown>) => {
    onUpdateTask(id, updates);
    // Remove from suggestions list
    setSuggestions((prev) => prev.filter((s) => s.task_id !== id));
  };

  const openDrawer = (index: number) => {
    if (suggestions[index]?.task.source !== 'jira') return;
    setActiveIndex(index);
  };

  const closeDrawer = () => {
    setActiveIndex(null);
  };

  const activeSuggestion = activeIndex !== null ? suggestions[activeIndex] : null;

  if (dismissed) return null;

  return (
    <div className="mb-6">
      <div className="mb-3 border border-[#3a424d] rounded-lg px-4 py-3 bg-[#2f353d]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] text-neutral-500 uppercase tracking-widest">
            Recommendation Sources
          </div>
          <button
            onClick={suggest}
            className="px-3 py-1 text-[11px] bg-[#2f353d] hover:bg-[#363d47] text-neutral-300 hover:text-[#5ec1ca] rounded border border-[#3a424d] transition-colors"
          >
            Ask N.O.V.A
          </button>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-neutral-300">
          {[
            { value: 'all', label: 'All' },
            { value: 'jira', label: 'Jira' },
            { value: 'planner', label: 'Planner' },
            { value: 'todo', label: 'To-Do' },
            { value: 'monday', label: 'Monday' },
            { value: 'email', label: 'Email' },
            { value: 'calendar', label: 'Calendar' },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="nova-source"
                value={opt.value}
                checked={sourceFilter === opt.value}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="accent-[#5ec1ca]"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {loading && (
        <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
          <div className="flex items-center gap-3 text-neutral-400 text-sm">
            <div className="w-4 h-4 border-2 border-[#5ec1ca] border-t-transparent rounded-full animate-spin" />
            N.O.V.A is analysing your tasks...
          </div>
        </div>
      )}

      {error && (
        <div className="border border-red-900/50 rounded-lg px-5 py-4 bg-red-950/30">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={suggest}
            className="mt-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {suggestions.length > 0 && !loading && (
        <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
              N.O.V.A Recommendations
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={suggest}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Refresh
              </button>
              <button
                onClick={() => {
                  const firstJira = suggestions.findIndex((s) => s.task.source === 'jira');
                  if (firstJira >= 0) openDrawer(firstJira);
                }}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                disabled={suggestions.every((s) => s.task.source !== 'jira')}
              >
                Open Focus
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div
                key={s.task_id}
                className="flex items-start gap-3 px-3 py-2.5 rounded-md bg-[#272C33] border border-[#3a424d]"
              >
                <span className="text-[#5ec1ca] font-bold text-sm shrink-0 mt-0.5">
                  {i + 1}.
                </span>

                <span
                  className={`mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded ${SOURCE_COLORS[s.task.source] ?? 'bg-neutral-700'} text-white shrink-0`}
                >
                  {SOURCE_LABELS[s.task.source] ?? s.task.source.toUpperCase()}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-neutral-100 font-medium truncate">
                    {s.task.title}
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    {s.reason}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {s.task.source === 'jira' && (
                    <button
                      onClick={() => openDrawer(i)}
                      className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-[#5ec1ca] transition-colors text-xs"
                    >
                      Edit
                    </button>
                  )}
                  {s.task.source_url && (
                    <a
                      href={s.task.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-[#5ec1ca] transition-colors text-xs"
                    >
                      Open
                    </a>
                  )}
                  <button
                    onClick={() => handleAction(s.task_id, { status: 'done' })}
                    className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-green-400 transition-colors text-xs"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => handleAction(s.task_id, { status: 'dismissed' })}
                    className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-red-400 transition-colors text-xs"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSuggestion && activeSuggestion.task.source === 'jira' && (
        <JiraDrawer
          task={activeSuggestion.task}
          index={activeIndex ?? 0}
          total={suggestions.length}
          onClose={closeDrawer}
          onPrev={() => setActiveIndex((prev) => (prev && prev > 0 ? prev - 1 : 0))}
          onNext={() => setActiveIndex((prev) => (prev !== null && prev < suggestions.length - 1 ? prev + 1 : prev))}
        />
      )}
    </div>
  );
}
