import type { Task } from '../../shared/types.js';
import { SLATimer } from './SLATimer.js';
import { getTier } from '../utils/taskHelpers.js';

interface Props {
  task: Task;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onClick?: () => void;
}

const SOURCE_COLORS: Record<string, string> = {
  jira: 'bg-[#0052CC]',
  planner: 'bg-[#31752F]',
  todo: 'bg-[#797673]',
  monday: 'bg-[#FF6D00]',
  email: 'bg-[#0078D4]',
  calendar: 'bg-[#8764B8]',
  milestone: 'bg-emerald-600',
};

const SOURCE_LABELS: Record<string, string> = {
  jira: 'JIRA',
  planner: 'PLANNER',
  todo: 'TODO',
  monday: 'MON',
  email: 'EMAIL',
  calendar: 'CAL',
  milestone: 'OB',
};

function parseDescMeta(description: string | null): Record<string, string> {
  if (!description) return {};
  const meta: Record<string, string> = {};
  for (const line of description.split('\n')) {
    const match = line.match(/^(Status|Priority|Created|Assignee):\s*(.+)/);
    if (match) meta[match[1]] = match[2].trim();
  }
  return meta;
}

function getDescriptionText(description: string | null): string | null {
  if (!description) return null;
  // Strip metadata lines (Jira format) and return remaining text
  const lines = description.split('\n').filter(
    (line) => !line.match(/^(Status|Priority|Created|Assignee):\s*/)
  );
  const text = lines.join(' ').trim();
  if (!text) return null;
  // Truncate to ~150 chars
  return text.length > 150 ? text.slice(0, 147) + '...' : text;
}

function getStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('closed') || s.includes('resolved')) return 'bg-green-600 text-green-100';
  if (s.includes('progress') || s.includes('review') || s.includes('working')) return 'bg-blue-600 text-blue-100';
  if (s.includes('waiting') || s.includes('hold') || s.includes('blocked')) return 'bg-amber-600 text-amber-100';
  return 'bg-neutral-600 text-neutral-200';
}

function getPriorityColor(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes('critical') || p.includes('highest') || p.includes('blocker')) return 'bg-red-600 text-red-100';
  if (p.includes('high')) return 'bg-orange-600 text-orange-100';
  if (p.includes('medium') || p.includes('normal')) return 'bg-amber-600 text-amber-100';
  if (p.includes('low') || p.includes('lowest')) return 'bg-green-600 text-green-100';
  return 'bg-neutral-600 text-neutral-200';
}

function getAgeColor(dateStr: string): string {
  const created = new Date(dateStr);
  if (isNaN(created.getTime())) return 'bg-neutral-600 text-neutral-200';
  const days = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 2) return 'bg-green-600 text-green-100';
  if (days <= 5) return 'bg-amber-600 text-amber-100';
  return 'bg-red-600 text-red-100';
}

function getDueDateInfo(dateStr: string): { label: string; className: string } {
  const due = new Date(dateStr);
  if (isNaN(due.getTime())) return { label: dateStr, className: 'text-neutral-600' };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const formatted = due.toLocaleDateString();

  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return {
      label: `Overdue ${abs}d — ${formatted}`,
      className: 'text-red-400 font-semibold',
    };
  }
  if (diffDays === 0) return { label: `Due today`, className: 'text-amber-400 font-semibold' };
  if (diffDays === 1) return { label: `Due tomorrow`, className: 'text-amber-300' };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d — ${formatted}`, className: 'text-yellow-400/80' };
  return { label: `Due: ${formatted}`, className: 'text-neutral-600' };
}

export function TaskCard({ task, onUpdate, onClick }: Props) {
  const meta = parseDescMeta(task.description);
  const descText = getDescriptionText(task.description);
  const tier = getTier(task);

  return (
    <div
      onClick={onClick}
      className={`group flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-[#2f353d] border border-[#3a424d]/40 hover:border-[#3a424d] transition-colors ${onClick ? 'cursor-pointer' : ''}`}
    >
      {/* Source badge */}
      <span
        className={`mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded ${SOURCE_COLORS[task.source] ?? 'bg-neutral-700'} text-white shrink-0`}
      >
        {SOURCE_LABELS[task.source] ?? task.source.toUpperCase()}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-100 truncate">
            {task.source === 'jira' && task.source_id && (
              <span className="text-neutral-500 mr-1.5">
                {task.source_id}
              </span>
            )}
            {task.title}
          </span>
          {task.is_pinned && (
            <span className="text-[10px] text-amber-400">FOCUSED</span>
          )}
        </div>

        {/* Description */}
        {descText && (
          <p className="text-xs text-neutral-500 mt-0.5 truncate">{descText}</p>
        )}

        {/* SLA timer */}
        {task.sla_breach_at && <SLATimer breachAt={task.sla_breach_at} />}

        {/* Metadata badges */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {meta.Status && (
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${getStatusColor(meta.Status)}`}>
              {meta.Status}
            </span>
          )}
          {meta.Priority && (
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${getPriorityColor(meta.Priority)}`}>
              {meta.Priority}
            </span>
          )}
          {tier && (
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-indigo-900/40 text-indigo-300" title={tier}>
              {tier}
            </span>
          )}
          {meta.Created && (
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${getAgeColor(meta.Created)}`}>
              Created: {meta.Created}
            </span>
          )}
          {meta.Assignee && (
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-neutral-700 text-neutral-300">
              Assignee: {meta.Assignee}
            </span>
          )}
        </div>

        {/* Due date */}
        {task.due_date && (() => {
          const info = getDueDateInfo(task.due_date);
          return (
            <div className={`mt-1 text-xs ${info.className}`}>
              {info.label}
            </div>
          );
        })()}
      </div>

      {/* Actions (visible on hover) */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
        {onClick && (
          <span
            className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-[#5ec1ca] transition-colors text-xs"
          >
            Edit
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(task.id, { is_pinned: !task.is_pinned }); }}
          className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-amber-400 transition-colors text-xs"
          title={task.is_pinned ? 'Unfocus' : 'Focus'}
        >
          {task.is_pinned ? 'Unfocus' : 'Focus'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(task.id, { status: 'done' }); }}
          className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-green-400 transition-colors text-xs"
          title="Mark as done"
        >
          Done
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(task.id, { status: 'dismissed' }); }}
          className="p-1 rounded hover:bg-[#363d47] text-neutral-500 hover:text-red-400 transition-colors text-xs"
          title="Dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
