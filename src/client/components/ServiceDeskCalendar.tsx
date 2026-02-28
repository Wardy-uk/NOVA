import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskDrawer } from './TaskDrawer.js';
import { getAssignee, getTier } from '../utils/taskHelpers.js';

interface Props {
  tasks: Task[];
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
}

interface PendingReschedule {
  task: Task;
  newDate: string;       // ISO date e.g. "2026-02-25"
  newDateLabel: string;   // e.g. "25 Feb 2026"
  oldDateLabel: string;   // e.g. "20 Feb 2026" or "No date"
  clearDate?: boolean;    // true when dropping to no-date
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PRIORITY_COLORS: Record<string, string> = {
  p1: 'border-l-red-500',
  p2: 'border-l-amber-500',
  p3: 'border-l-neutral-500',
  p4: 'border-l-neutral-700',
};

function getPriorityClass(priority: number): string {
  if (priority >= 80) return PRIORITY_COLORS.p1;
  if (priority >= 60) return PRIORITY_COLORS.p2;
  if (priority >= 40) return PRIORITY_COLORS.p3;
  return PRIORITY_COLORS.p4;
}

export function ServiceDeskCalendar({ tasks, onUpdateTask }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskList, setSelectedTaskList] = useState<Task[]>([]);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<PendingReschedule | null>(null);

  // Tasks are pre-filtered to Jira by parent component
  const jiraTasks = tasks;

  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // Build a map of date-string → tasks
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of jiraTasks) {
      if (!task.due_date) continue;
      const d = new Date(task.due_date);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    for (const [, dayTasks] of map) {
      dayTasks.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
    }
    return map;
  }, [jiraTasks]);

  // Tasks with no due date
  const noDateTasks = useMemo(() => jiraTasks.filter((t) => !t.due_date), [jiraTasks]);

  // Calendar grid cells
  const calendarDays = useMemo(() => {
    const first = startOfMonth(currentMonth);
    const last = endOfMonth(currentMonth);

    let dayOfWeek = first.getDay();
    if (dayOfWeek === 0) dayOfWeek = 7;
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - (dayOfWeek - 1));

    let lastDow = last.getDay();
    if (lastDow === 0) lastDow = 7;
    const gridEnd = new Date(last);
    gridEnd.setDate(gridEnd.getDate() + (7 - lastDow));

    const days: Date[] = [];
    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [currentMonth]);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  const goToday = () => setCurrentMonth(startOfMonth(new Date()));

  const openTask = useCallback((task: Task, taskList: Task[]) => {
    setSelectedTask(task);
    setSelectedTaskList(taskList);
    setSelectedTaskIndex(taskList.indexOf(task));
  }, []);

  // ── Drag & drop handlers ──

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(key);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverKey(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    setDragOverKey(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    const task = jiraTasks.find((t) => t.id === taskId);
    if (!task) return;
    const newDate = toISODate(targetDate);
    const oldDate = task.due_date ? new Date(task.due_date) : null;
    // Skip if dropping onto the same date
    if (oldDate && toISODate(oldDate) === newDate) return;
    setPendingReschedule({
      task,
      newDate,
      newDateLabel: targetDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      oldDateLabel: oldDate
        ? oldDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'No date',
    });
  }, [jiraTasks]);

  const handleDropNoDate = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverKey(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    const task = jiraTasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!task.due_date) return; // already has no date
    const oldDate = new Date(task.due_date);
    setPendingReschedule({
      task,
      newDate: '',
      newDateLabel: 'No date',
      oldDateLabel: oldDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      clearDate: true,
    });
  }, [jiraTasks]);

  const monthLabel = currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
          Service Desk — Calendar
        </h2>
        <span className="text-xs text-neutral-500">{jiraTasks.length} ticket{jiraTasks.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <button onClick={prevMonth} className="px-2 py-1 text-xs rounded bg-[#2f353d] text-neutral-400 hover:text-neutral-200 border border-[#3a424d] hover:border-[#5ec1ca]/50 transition-colors">
          &larr; Prev
        </button>
        <button onClick={goToday} className="px-2 py-1 text-xs rounded bg-[#2f353d] text-neutral-400 hover:text-neutral-200 border border-[#3a424d] hover:border-[#5ec1ca]/50 transition-colors">
          Today
        </button>
        <button onClick={nextMonth} className="px-2 py-1 text-xs rounded bg-[#2f353d] text-neutral-400 hover:text-neutral-200 border border-[#3a424d] hover:border-[#5ec1ca]/50 transition-colors">
          Next &rarr;
        </button>
        <span className="text-sm font-semibold text-neutral-200 ml-2">{monthLabel}</span>
        <span className="text-[10px] text-neutral-600 ml-2">Drag tickets to reschedule</span>
      </div>

      <div className="flex gap-4">
        {/* Calendar grid */}
        <div className="flex-1">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-px mb-px">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[10px] text-neutral-500 uppercase tracking-wider py-1.5">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px bg-[#3a424d]">
            {calendarDays.map((day) => {
              const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
              const isToday = isSameDay(day, today);
              const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
              const dayTasks = tasksByDate.get(key) ?? [];
              const hasOverdue = dayTasks.some((t) => t.due_date && new Date(t.due_date) < today);
              const isDragTarget = dragOverKey === key;

              return (
                <div
                  key={key}
                  onDragOver={(e) => handleDragOver(e, key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, day)}
                  className={`min-h-[100px] p-1.5 transition-colors ${
                    isDragTarget
                      ? 'bg-[#5ec1ca]/15 ring-1 ring-inset ring-[#5ec1ca]/50'
                      : isCurrentMonth ? 'bg-[#2f353d]' : 'bg-[#272C33]'
                  } ${isToday && !isDragTarget ? 'ring-1 ring-inset ring-[#5ec1ca]' : ''}`}
                >
                  <div className={`text-[11px] mb-1 ${
                    isToday ? 'text-[#5ec1ca] font-bold' :
                    isCurrentMonth ? 'text-neutral-300' : 'text-neutral-600'
                  }`}>
                    {day.getDate()}
                    {hasOverdue && !isToday && (
                      <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 4).map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onClick={() => openTask(task, dayTasks)}
                        className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate border-l-2 ${getPriorityClass(task.priority ?? 50)} bg-[#272C33] text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors cursor-grab active:cursor-grabbing`}
                        title={`${task.source_id}: ${task.title}${getTier(task) ? ` [${getTier(task)}]` : ''}`}
                      >
                        <span className="text-[#5ec1ca] font-mono">{task.source_id}</span>{' '}
                        {getTier(task) && <span className="text-indigo-300">[{getTier(task)}]</span>}{' '}
                        {task.title}
                      </div>
                    ))}
                    {dayTasks.length > 4 && (
                      <div className="text-[9px] text-neutral-500 pl-1.5">
                        +{dayTasks.length - 4} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* No-date sidebar */}
        <div
          className={`w-56 flex-shrink-0 rounded-lg p-2 transition-colors ${
            dragOverKey === 'no-date'
              ? 'bg-[#5ec1ca]/15 ring-1 ring-[#5ec1ca]/50'
              : ''
          }`}
          onDragOver={(e) => handleDragOver(e, 'no-date')}
          onDragLeave={handleDragLeave}
          onDrop={handleDropNoDate}
        >
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">
            No Due Date ({noDateTasks.length})
          </div>
          {noDateTasks.length > 0 ? (
            <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
              {noDateTasks.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onClick={() => openTask(task, noDateTasks)}
                  className="w-full text-left bg-[#2f353d] border border-[#3a424d] rounded p-2 hover:border-[#5ec1ca]/50 transition-colors cursor-grab active:cursor-grabbing"
                >
                  {task.source_id && (
                    <div className="text-[10px] text-[#5ec1ca] font-mono">{task.source_id}</div>
                  )}
                  <div className="text-[11px] text-neutral-300 truncate">{task.title}</div>
                  {getTier(task) && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-indigo-900/40 text-indigo-300 inline-block mt-0.5">{getTier(task)}</span>
                  )}
                  <div className="text-[10px] text-neutral-500 mt-0.5">{getAssignee(task)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-neutral-600 italic">Drop here to remove due date</div>
          )}
        </div>
      </div>

      {/* Task drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          index={selectedTaskIndex}
          total={selectedTaskList.length}
          onClose={() => setSelectedTask(null)}
          onPrev={() => {
            if (selectedTaskIndex > 0) {
              const prev = selectedTaskList[selectedTaskIndex - 1];
              setSelectedTask(prev);
              setSelectedTaskIndex(selectedTaskIndex - 1);
            }
          }}
          onNext={() => {
            if (selectedTaskIndex < selectedTaskList.length - 1) {
              const next = selectedTaskList[selectedTaskIndex + 1];
              setSelectedTask(next);
              setSelectedTaskIndex(selectedTaskIndex + 1);
            }
          }}
          onTaskUpdated={() => onUpdateTask(selectedTask.id, {})}
        />
      )}

      {/* Reschedule modal */}
      {pendingReschedule && (
        <RescheduleModal
          pending={pendingReschedule}
          onConfirm={(comment) => {
            const { task, newDate, clearDate } = pendingReschedule;
            // Update local state immediately
            onUpdateTask(task.id, { due_date: clearDate ? null : newDate });
            setPendingReschedule(null);
          }}
          onCancel={() => setPendingReschedule(null)}
        />
      )}
    </div>
  );
}

// ── Reschedule Modal ──

function RescheduleModal({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingReschedule;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const issueKey = pending.task.source_id ?? pending.task.id.replace(/^jira:/, '');

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        fields: {
          duedate: pending.clearDate ? null : pending.newDate,
        },
      };
      if (comment.trim()) {
        body.comment = comment.trim();
      }

      const res = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Jira update failed');

      onConfirm(comment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Jira');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-[#2f353d] border border-[#3a424d] rounded-lg shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#3a424d]">
          <h3 className="text-sm font-semibold text-neutral-100">Reschedule Ticket</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Ticket info */}
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[#5ec1ca] font-mono">{issueKey}</div>
              <div className="text-sm text-neutral-200 truncate">{pending.task.title}</div>
            </div>
          </div>

          {/* Date change */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400">{pending.oldDateLabel}</span>
            <span className="text-neutral-600">&rarr;</span>
            <span className="text-[#5ec1ca] font-semibold">{pending.newDateLabel}</span>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-[11px] text-neutral-400 mb-1">
              Customer update <span className="text-neutral-600">(optional)</span>
            </label>
            <textarea
              ref={textareaRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Due date moved to accommodate resource availability..."
              rows={3}
              className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-[#5ec1ca]/50 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#3a424d] flex items-center justify-between">
          <span className="text-[10px] text-neutral-600">Ctrl+Enter to confirm</span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-[#272C33] text-neutral-400 hover:text-neutral-200 border border-[#3a424d] hover:border-[#5ec1ca]/50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="px-4 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-[#272C33]/30 border-t-[#272C33] rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                'Update & Push to Jira'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
