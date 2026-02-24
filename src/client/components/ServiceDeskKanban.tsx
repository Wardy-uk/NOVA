import { useState, useMemo } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskDrawer } from './TaskDrawer.js';
import {
  getDateGroup,
  DATE_GROUP_ORDER,
  DATE_GROUP_LABELS,
  DATE_GROUP_COLORS,
  type DateGroup,
} from '../utils/taskHelpers.js';

interface Props {
  tasks: Task[];
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
}

type GroupBy = 'status' | 'date';

const STATUS_COLORS: Record<string, string> = {
  'open': '#3b82f6',
  'to do': '#6b7280',
  'in progress': '#f59e0b',
  'in review': '#8b5cf6',
  'waiting for customer': '#ef4444',
  'waiting for support': '#f97316',
  'done': '#22c55e',
  'closed': '#22c55e',
  'resolved': '#22c55e',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? '#6b7280';
}

export function ServiceDeskKanban({ tasks, onUpdateTask }: Props) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');

  // Tasks are pre-filtered to Jira by parent component
  const jiraTasks = tasks;

  // Status-based columns
  const statusColumns = useMemo(() => {
    const statusMap = new Map<string, Task[]>();
    for (const task of jiraTasks) {
      const status = task.status || 'open';
      if (!statusMap.has(status)) statusMap.set(status, []);
      statusMap.get(status)!.push(task);
    }
    const doneStatuses = new Set(['done', 'closed', 'resolved']);
    return [...statusMap.entries()].sort((a, b) => {
      const aIsDone = doneStatuses.has(a[0].toLowerCase());
      const bIsDone = doneStatuses.has(b[0].toLowerCase());
      if (aIsDone !== bIsDone) return aIsDone ? 1 : -1;
      return a[0].localeCompare(b[0]);
    });
  }, [jiraTasks]);

  // Date-based columns
  const dateColumns = useMemo(() => {
    const groups = new Map<DateGroup, Task[]>();
    for (const g of DATE_GROUP_ORDER) groups.set(g, []);
    for (const task of jiraTasks) {
      const group = getDateGroup(task);
      groups.get(group)!.push(task);
    }
    // Sort tasks within each group by due_date (earliest first), no-date tasks by priority
    for (const [, groupTasks] of groups) {
      groupTasks.sort((a, b) => {
        if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return (b.priority ?? 50) - (a.priority ?? 50);
      });
    }
    return [...groups.entries()].filter(([, t]) => t.length > 0);
  }, [jiraTasks]);

  if (jiraTasks.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-neutral-500">
        No Jira tickets found. Sync Jira from Settings to populate the board.
      </div>
    );
  }

  const columns = groupBy === 'status' ? statusColumns : dateColumns;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
          Service Desk — Kanban
        </h2>
        <div className="flex items-center gap-3">
          {/* Group-by toggle */}
          <div className="flex items-center bg-[#2f353d] rounded border border-[#3a424d]">
            <button
              onClick={() => setGroupBy('status')}
              className={`px-3 py-1.5 text-[11px] transition-colors rounded-l ${
                groupBy === 'status'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              By Status
            </button>
            <button
              onClick={() => setGroupBy('date')}
              className={`px-3 py-1.5 text-[11px] transition-colors rounded-r ${
                groupBy === 'date'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              By Date
            </button>
          </div>
          <span className="text-xs text-neutral-500">{jiraTasks.length} ticket{jiraTasks.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {columns.map(([key, columnTasks]) => {
          const isDateMode = groupBy === 'date';
          const label = isDateMode ? DATE_GROUP_LABELS[key as DateGroup] : key;
          const color = isDateMode ? DATE_GROUP_COLORS[key as DateGroup] : getStatusColor(key);

          return (
            <div
              key={key}
              className="flex-shrink-0 w-72 bg-[#2f353d] border border-[#3a424d] rounded-lg flex flex-col"
            >
              {/* Column header */}
              <div className="px-3 py-2.5 border-b border-[#3a424d] flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs font-semibold text-neutral-200 uppercase tracking-wider truncate">
                  {label}
                </span>
                <span className="ml-auto text-[10px] text-neutral-500 bg-[#272C33] px-1.5 py-0.5 rounded">
                  {columnTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                    showStatus={isDateMode}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          index={0}
          total={1}
          onClose={() => setSelectedTask(null)}
          onPrev={() => {}}
          onNext={() => {}}
          onTaskUpdated={() => onUpdateTask(selectedTask.id, {})}
        />
      )}
    </div>
  );
}

function KanbanCard({ task, onClick, showStatus }: { task: Task; onClick: () => void; showStatus?: boolean }) {
  const priority = task.priority ?? 50;
  const isOverdue = task.due_date && new Date(task.due_date) < new Date();
  const isSlaBreached = task.sla_breach_at && new Date(task.sla_breach_at) < new Date();

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#272C33] border border-[#3a424d] rounded-md p-3 hover:border-[#5ec1ca]/50 transition-colors cursor-pointer"
    >
      {/* Source ID */}
      {task.source_id && (
        <div className="text-[10px] text-[#5ec1ca] font-mono mb-1">{task.source_id}</div>
      )}

      {/* Title */}
      <div className="text-xs text-neutral-200 font-medium line-clamp-2 mb-2">
        {task.title}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Priority indicator */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          priority >= 80 ? 'bg-red-900/40 text-red-400' :
          priority >= 60 ? 'bg-amber-900/40 text-amber-400' :
          'bg-[#363d47] text-neutral-500'
        }`}>
          P{priority >= 80 ? '1' : priority >= 60 ? '2' : priority >= 40 ? '3' : '4'}
        </span>

        {/* Status badge (shown in date mode) */}
        {showStatus && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: getStatusColor(task.status) + '30', color: getStatusColor(task.status) }}
          >
            {task.status}
          </span>
        )}

        {/* Due date */}
        {task.due_date && (
          <span className={`text-[10px] ${isOverdue ? 'text-red-400' : 'text-neutral-500'}`}>
            {new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </span>
        )}

        {/* SLA breach indicator */}
        {isSlaBreached && (
          <span className="text-[10px] text-red-400 font-semibold">SLA</span>
        )}
      </div>
    </button>
  );
}
