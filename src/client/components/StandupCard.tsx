import type { Task } from '../../shared/types.js';

interface Props {
  task: Task;
  reason?: string;
  note?: string;
  checked?: boolean;
  onToggle?: (id: string) => void;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
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

export function StandupCard({ task, reason, note, checked, onToggle, onUpdate }: Props) {
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-md border transition-colors ${
      checked
        ? 'bg-[#272C33] border-[#3a424d] opacity-60'
        : 'bg-[#272C33] border-[#3a424d]'
    }`}>
      {onToggle && (
        <button
          onClick={() => onToggle(task.id)}
          className={`mt-0.5 w-4 h-4 rounded border shrink-0 transition-colors ${
            checked
              ? 'bg-[#5ec1ca] border-[#5ec1ca]'
              : 'border-neutral-600 hover:border-[#5ec1ca]'
          }`}
        >
          {checked && (
            <svg className="w-4 h-4 text-[#272C33]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}

      <span
        className={`mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded ${SOURCE_COLORS[task.source] ?? 'bg-neutral-700'} text-white shrink-0`}
      >
        {SOURCE_LABELS[task.source] ?? task.source.toUpperCase()}
      </span>

      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate ${checked ? 'line-through text-neutral-500' : 'text-neutral-100'}`}>
          {task.title}
        </div>
        {(reason || note) && (
          <div className="text-xs text-neutral-400 mt-0.5">
            {reason || note}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {task.source_url && (
          <a
            href={task.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-[#5ec1ca] transition-colors text-xs"
          >
            Open
          </a>
        )}
        <button
          onClick={() => onUpdate(task.id, { status: 'done' })}
          className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-green-400 transition-colors text-xs"
        >
          Done
        </button>
        <button
          onClick={() => onUpdate(task.id, { status: 'dismissed' })}
          className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-red-400 transition-colors text-xs"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
