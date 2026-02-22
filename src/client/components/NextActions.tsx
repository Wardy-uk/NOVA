import { useState } from 'react';
import type { Task } from '../../shared/types.js';

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

  const suggest = async () => {
    setLoading(true);
    setError(null);
    setDismissed(false);
    try {
      const res = await fetch('/api/actions/suggest', { method: 'POST' });
      const json = await res.json();
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

  const handleAction = (id: string, updates: Record<string, unknown>) => {
    onUpdateTask(id, updates);
    // Remove from suggestions list
    setSuggestions((prev) => prev.filter((s) => s.task_id !== id));
  };

  if (dismissed) return null;

  return (
    <div className="mb-6">
      {suggestions.length === 0 && !loading && !error && (
        <button
          onClick={suggest}
          className="px-4 py-2 text-sm bg-[#2f353d] hover:bg-[#363d47] text-neutral-300 hover:text-[#5ec1ca] rounded-lg border border-[#3a424d] transition-colors"
        >
          Ask N.O.V.A
        </button>
      )}

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
    </div>
  );
}
