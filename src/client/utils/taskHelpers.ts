import type { Task } from '../../shared/types.js';

export type OwnershipFilter = 'mine' | 'unassigned' | 'all';

/** Extract assignee name from task description metadata line "Assignee: ..." */
export function getAssignee(task: Task): string {
  if (!task.description) return 'Unassigned';
  const match = task.description.match(/^Assignee:\s*(.+)/m);
  if (!match) return 'Unassigned';
  const name = match[1].trim();
  return name || 'Unassigned';
}

/** Filter tasks by ownership relative to the current user */
export function filterByOwnership(
  tasks: Task[],
  filter: OwnershipFilter,
  userName: string,
): Task[] {
  if (filter === 'all') return tasks;

  if (filter === 'unassigned') {
    return tasks.filter((t) => {
      const assignee = getAssignee(t);
      return assignee === 'Unassigned' || assignee === '';
    });
  }

  // 'mine' — case-insensitive partial match against user's display name or username
  const lower = userName.toLowerCase();
  return tasks.filter((t) => {
    const assignee = getAssignee(t).toLowerCase();
    if (assignee === 'unassigned' || assignee === '') return false;
    return assignee.includes(lower) || lower.includes(assignee);
  });
}

// ── Date helpers for Kanban date grouping ──

export type DateGroup = 'overdue' | 'today' | 'this_week' | 'next_week' | 'future' | 'no_date';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as start of week
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return result;
}

export function getDateGroup(task: Task): DateGroup {
  if (!task.due_date) return 'no_date';
  const due = new Date(task.due_date);
  if (isNaN(due.getTime())) return 'no_date';

  const today = startOfDay(new Date());
  const dueDay = startOfDay(due);

  if (dueDay < today) return 'overdue';
  if (dueDay.getTime() === today.getTime()) return 'today';

  const weekStart = startOfWeek(today);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000); // end of this week (next Monday)
  const nextWeekEnd = new Date(weekEnd.getTime() + 7 * 86400000);

  if (dueDay < weekEnd) return 'this_week';
  if (dueDay < nextWeekEnd) return 'next_week';
  return 'future';
}

export const DATE_GROUP_ORDER: DateGroup[] = ['overdue', 'today', 'this_week', 'next_week', 'future', 'no_date'];

export const DATE_GROUP_LABELS: Record<DateGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  this_week: 'This Week',
  next_week: 'Next Week',
  future: 'Future',
  no_date: 'No Date',
};

export const DATE_GROUP_COLORS: Record<DateGroup, string> = {
  overdue: '#ef4444',
  today: '#f59e0b',
  this_week: '#3b82f6',
  next_week: '#8b5cf6',
  future: '#6b7280',
  no_date: '#4b5563',
};
