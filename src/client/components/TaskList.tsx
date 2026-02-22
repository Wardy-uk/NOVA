import { useState, useMemo, useEffect } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskCard } from './TaskCard.js';
import { Dashboard } from './Dashboard.js';
import { NextActions } from './NextActions.js';

interface Props {
  tasks: Task[];
  loading: boolean;
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
}

const SOURCE_META: Record<string, { label: string; color: string }> = {
  jira: { label: 'Jira', color: '#0052CC' },
  planner: { label: 'Planner', color: '#31752F' },
  todo: { label: 'To-Do', color: '#797673' },
  monday: { label: 'Monday', color: '#FF6D00' },
  email: { label: 'Email', color: '#0078D4' },
  calendar: { label: 'Calendar', color: '#8764B8' },
};

// Ordered source list for consistent display
const SOURCE_ORDER = ['jira', 'planner', 'todo', 'monday', 'email', 'calendar'];

type SortField = 'priority' | 'due_date' | 'updated_at';

export function TaskList({ tasks, loading, onUpdateTask }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('priority');
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(true);

  // Available sources (only those with tasks)
  const activeSources = useMemo(() => {
    const set = new Set(tasks.map((t) => t.source));
    return SOURCE_ORDER.filter((s) => set.has(s)).concat(
      [...set].filter((s) => !SOURCE_ORDER.includes(s))
    );
  }, [tasks]);
  
  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const source of activeSources) {
        if (next[source] === undefined) next[source] = true;
      }
      return next;
    });
  }, [activeSources]);

  // Filter + sort tasks
  const filtered = useMemo(() => {
    let result = tasks;

    if (sourceFilter) {
      result = result.filter((t) => t.source === sourceFilter);
    }

    if (showOverdueOnly) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      result = result.filter((t) => {
        if (!t.due_date) return false;
        const due = new Date(t.due_date);
        return !isNaN(due.getTime()) && due < today;
      });
    }

    return result;
  }, [tasks, sourceFilter, showOverdueOnly]);

  // Sort function for tasks within groups
  const sortTasks = (list: Task[]): Task[] => {
    return [...list].sort((a, b) => {
      if (sortBy === 'priority') {
        return a.priority - b.priority; // lower number = higher priority
      }
      if (sortBy === 'due_date') {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      // updated_at — most recent first
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  };

  const pinned = useMemo(() => filtered.filter((t) => t.is_pinned), [filtered]);
  const unpinned = useMemo(() => filtered.filter((t) => !t.is_pinned), [filtered]);

  // Group unpinned tasks by source
  const grouped: Record<string, Task[]> = {};
  for (const task of unpinned) {
    if (!grouped[task.source]) grouped[task.source] = [];
    grouped[task.source].push(task);
  }

  // Sort tasks within each group
  for (const source of Object.keys(grouped)) {
    grouped[source] = sortTasks(grouped[source]);
  }

  // Sort sources by SOURCE_ORDER
  const orderedSources = SOURCE_ORDER.filter((s) => grouped[s]?.length > 0);
  for (const s of Object.keys(grouped)) {
    if (!orderedSources.includes(s)) orderedSources.push(s);
  }

  const toggleGroup = (source: string) => {
    setCollapsed((prev) => ({ ...prev, [source]: !prev[source] }));
  };

  useEffect(() => {
    if (pinned.length === 0) return;
    if (sourceFilter === 'pinned') {
      setPinnedCollapsed(false);
    }
  }, [pinned.length, sourceFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        Loading tasks...
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
        <p className="text-lg mb-2">No tasks</p>
        <p className="text-sm">
          Connect a source and sync to see your tasks here.
        </p>
      </div>
    );
  }

  // Count overdue tasks
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const overdueCount = tasks.filter((t) => {
    if (!t.due_date) return false;
    const due = new Date(t.due_date);
    return !isNaN(due.getTime()) && due < today;
  }).length;

  return (
    <div>
      <Dashboard tasks={tasks} />
      <NextActions onUpdateTask={onUpdateTask} />

      {/* Filter / Sort toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Source filter chips */}
        <button
          onClick={() => setSourceFilter(null)}
          className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
            sourceFilter === null
              ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
              : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
          }`}
        >
          All
        </button>
        {activeSources.map((source) => {
          const meta = SOURCE_META[source] ?? { label: source, color: '#6b7280' };
          const isActive = sourceFilter === source;
          return (
            <button
              key={source}
              onClick={() => setSourceFilter(isActive ? null : source)}
              className={`px-2.5 py-1 text-[11px] rounded-full transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: isActive ? '#272C33' : meta.color }}
              />
              {meta.label}
            </button>
          );
        })}

        {/* Overdue filter */}
        {overdueCount > 0 && (
          <button
            onClick={() => setShowOverdueOnly(!showOverdueOnly)}
            className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
              showOverdueOnly
                ? 'bg-red-500 text-white font-semibold'
                : 'bg-[#2f353d] text-red-400 hover:bg-[#363d47]'
            }`}
          >
            Overdue ({overdueCount})
          </button>
        )}

        {/* Sort control */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-neutral-600 uppercase tracking-wider">Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            className="bg-[#2f353d] text-neutral-300 text-[11px] rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors"
          >
            <option value="priority">Priority</option>
            <option value="due_date">Due Date</option>
            <option value="updated_at">Recently Updated</option>
          </select>
        </div>
      </div>

      {/* Result count when filtered */}
      {(sourceFilter || showOverdueOnly) && (
        <div className="text-[11px] text-neutral-500 mb-3">
          Showing {filtered.length} of {tasks.length} tasks
          {sourceFilter && (
            <button
              onClick={() => { setSourceFilter(null); setShowOverdueOnly(false); }}
              className="ml-2 text-[#5ec1ca] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Pinned section */}
      {pinned.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setPinnedCollapsed((prev) => !prev)}
            className="w-full flex items-center gap-2 py-2 px-1 group text-left"
          >
            <div className="w-2 h-2 rounded-full shrink-0 bg-[#5ec1ca]" />
            <span className="text-xs text-neutral-500 uppercase tracking-widest">
              Pinned
            </span>
            <span className="text-xs text-neutral-600">
              ({pinned.length})
            </span>
            <span className="text-[10px] text-neutral-600 ml-auto group-hover:text-neutral-400 transition-colors">
              {pinnedCollapsed ? '+ Show' : '- Hide'}
            </span>
          </button>
          {!pinnedCollapsed && (
            <div className="space-y-1">
              {pinned.map((task) => (
                <TaskCard key={task.id} task={task} onUpdate={onUpdateTask} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grouped source sections */}
      {orderedSources.map((source) => {
        const sourceTasks = grouped[source];
        const meta = SOURCE_META[source] ?? {
          label: source,
          color: '#6b7280',
        };
        const isCollapsed = sourceFilter === source
          ? false
          : (collapsed[source] ?? true);

        return (
          <div key={source} className="mb-2">
            <button
              onClick={() => toggleGroup(source)}
              className="w-full flex items-center gap-2 py-2 px-1 group text-left"
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: meta.color }}
              />
              <span className="text-xs text-neutral-500 uppercase tracking-widest">
                {meta.label}
              </span>
              <span className="text-xs text-neutral-600">
                ({sourceTasks.length})
              </span>
              <span className="text-[10px] text-neutral-600 ml-auto group-hover:text-neutral-400 transition-colors">
                {isCollapsed ? '+ Show' : '- Hide'}
              </span>
            </button>
            {!isCollapsed && (
              <div className="space-y-1">
                {sourceTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onUpdate={onUpdateTask}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
