import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskCard } from './TaskCard.js';
import { TaskDrawer } from './TaskDrawer.js';
import { CreateTaskForm } from './CreateTaskForm.js';
import { getTier } from '../utils/taskHelpers.js';
import { SLATimer } from './SLATimer.js';

interface Props {
  tasks: Task[];
  loading: boolean;
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  /** Hide filters/grouping — show a flat sorted list */
  minimal?: boolean;
}

const SOURCE_META: Record<string, { label: string; color: string }> = {
  jira: { label: 'Jira', color: '#0052CC' },
  planner: { label: 'Planner', color: '#31752F' },
  todo: { label: 'To-Do', color: '#797673' },
  monday: { label: 'Monday', color: '#FF6D00' },
  email: { label: 'Email', color: '#0078D4' },
  calendar: { label: 'Calendar', color: '#8764B8' },
  milestone: { label: 'Onboarding', color: '#10B981' },
};

// Ordered source list for consistent display
const SOURCE_ORDER = ['jira', 'planner', 'todo', 'monday', 'email', 'calendar', 'milestone'];

const SOURCE_LABELS: Record<string, string> = {
  jira: 'JIRA', planner: 'PLAN', todo: 'TODO', monday: 'MON',
  email: 'EMAIL', calendar: 'CAL', milestone: 'OB',
};

const SOURCE_COLORS: Record<string, string> = {
  jira: 'bg-[#0052CC]', planner: 'bg-[#31752F]', todo: 'bg-[#797673]',
  monday: 'bg-[#FF6D00]', email: 'bg-[#0078D4]', calendar: 'bg-[#8764B8]',
  milestone: 'bg-emerald-600',
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

function getStatusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('closed') || s.includes('resolved')) return 'bg-green-900/40 text-green-400';
  if (s.includes('progress') || s.includes('review') || s.includes('working')) return 'bg-blue-900/40 text-blue-400';
  if (s.includes('waiting') || s.includes('hold') || s.includes('blocked')) return 'bg-amber-900/40 text-amber-400';
  return 'bg-[#272C33] text-neutral-400';
}

function getPriorityBadge(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes('critical') || p.includes('highest') || p.includes('blocker')) return 'bg-red-900/40 text-red-400';
  if (p.includes('high')) return 'bg-orange-900/40 text-orange-400';
  if (p.includes('medium') || p.includes('normal')) return 'bg-amber-900/40 text-amber-400';
  if (p.includes('low') || p.includes('lowest')) return 'bg-green-900/40 text-green-400';
  return 'bg-[#272C33] text-neutral-400';
}

function daysOpen(dateStr: string | null): string {
  if (!dateStr) return '-';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return '-';
  return `${Math.floor(ms / (1000 * 60 * 60 * 24))}d`;
}

function dueDateDisplay(dateStr: string | null): { text: string; className: string } {
  if (!dateStr) return { text: '-', className: 'text-neutral-600' };
  const due = new Date(dateStr);
  if (isNaN(due.getTime())) return { text: dateStr, className: 'text-neutral-600' };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, className: 'text-red-400 font-bold' };
  if (diffDays === 0) return { text: 'Today', className: 'text-amber-400 font-bold' };
  if (diffDays === 1) return { text: 'Tomorrow', className: 'text-amber-400' };
  if (diffDays <= 3) return { text: `${diffDays}d`, className: 'text-yellow-400' };
  return { text: due.toLocaleDateString(), className: 'text-neutral-400' };
}

type SortField = 'priority' | 'due_date' | 'updated_at';

export function TaskList({ tasks, loading, onUpdateTask, minimal }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sourceFilter, setSourceFilter] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('nova_task_source') || null;
  });
  const [sortBy, setSortBy] = useState<SortField>(() => {
    if (typeof window === 'undefined') return 'priority';
    return (window.localStorage.getItem('nova_task_sort') as SortField) || 'priority';
  });
  const [showOverdueOnly, setShowOverdueOnly] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('nova_task_overdue') === 'true';
  });
  const [pinnedCollapsed, setPinnedCollapsed] = useState(true);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleExpandedRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Available sources — always show all known sources, plus any extras from tasks
  const activeSources = useMemo(() => {
    const set = new Set(tasks.map((t) => t.source));
    const extras = [...set].filter((s) => !SOURCE_ORDER.includes(s));
    return [...SOURCE_ORDER, ...extras];
  }, [tasks]);
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sourceFilter) window.localStorage.setItem('nova_task_source', sourceFilter);
    else window.localStorage.removeItem('nova_task_source');
  }, [sourceFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('nova_task_sort', sortBy);
  }, [sortBy]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('nova_task_overdue', String(showOverdueOnly));
  }, [showOverdueOnly]);

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

  // Flat list of all visible tasks for drawer navigation
  const flatTasks = useMemo(() => {
    const result: Task[] = [...sortTasks(pinned)];
    for (const source of orderedSources) {
      result.push(...(grouped[source] ?? []));
    }
    return result;
  }, [pinned, orderedSources, grouped]);

  const drawerIndex = useMemo(() => {
    if (!drawerTaskId) return -1;
    return flatTasks.findIndex(t => t.id === drawerTaskId);
  }, [drawerTaskId, flatTasks]);

  const drawerTask = drawerIndex >= 0 ? flatTasks[drawerIndex] : null;

  const openDrawer = useCallback((taskId: string) => setDrawerTaskId(taskId), []);
  const closeDrawer = useCallback(() => setDrawerTaskId(null), []);
  const prevDrawer = useCallback(() => {
    if (drawerIndex > 0) setDrawerTaskId(flatTasks[drawerIndex - 1].id);
  }, [drawerIndex, flatTasks]);
  const nextDrawer = useCallback(() => {
    if (drawerIndex < flatTasks.length - 1) setDrawerTaskId(flatTasks[drawerIndex + 1].id);
  }, [drawerIndex, flatTasks]);

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

  // Minimal mode: table layout matching Problem Tickets view
  if (minimal) {
    const allSorted = sortTasks(tasks);
    return (
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-neutral-500">{tasks.length} tickets</div>
          <div className="flex items-center gap-1.5">
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

        {/* Table */}
        {allSorted.length === 0 ? (
          <div className="text-sm text-neutral-500 py-8 text-center">No tickets to show.</div>
        ) : (
          <div className="border border-[#3a424d] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-[10px]">
                  <th className="text-center px-2 py-2 w-14">Source</th>
                  <th className="text-left px-3 py-2">Issue</th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">Status</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Assignee</th>
                  <th className="text-center px-3 py-2 hidden sm:table-cell">Priority</th>
                  <th className="text-center px-3 py-2 hidden md:table-cell">Age</th>
                  <th className="text-center px-3 py-2 hidden sm:table-cell">SLA</th>
                  <th className="text-center px-3 py-2 hidden md:table-cell">Due</th>
                  <th className="text-center px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3a424d]">
                {allSorted.map(task => {
                  const meta = parseDescMeta(task.description);
                  const tier = getTier(task);
                  const due = dueDateDisplay(task.due_date);
                  const isExpanded = expandedRows.has(task.id);

                  return (
                    <Fragment key={task.id}>
                      <tr
                        className="bg-[#2f353d] hover:bg-[#363d47] transition-colors cursor-pointer"
                        onClick={() => toggleExpandedRow(task.id)}
                      >
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${SOURCE_COLORS[task.source] ?? 'bg-neutral-700'} text-white`}>
                            {SOURCE_LABELS[task.source] ?? task.source.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-neutral-200 font-medium">
                            {task.source === 'jira' && task.source_id && (
                              <span className="text-neutral-500 mr-1.5">{task.source_id}</span>
                            )}
                            {task.source_url ? (
                              <a
                                href={task.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="hover:text-[#5ec1ca] transition-colors"
                              >
                                {task.title} ↗
                              </a>
                            ) : task.title}
                          </div>
                          {task.is_pinned && (
                            <span className="text-[10px] text-amber-400 font-semibold">FOCUSED</span>
                          )}
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          {meta.Status ? (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusBadge(meta.Status)}`}>
                              {meta.Status}
                            </span>
                          ) : <span className="text-neutral-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-neutral-400 hidden md:table-cell">
                          {meta.Assignee ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-center hidden sm:table-cell">
                          {meta.Priority ? (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getPriorityBadge(meta.Priority)}`}>
                              {meta.Priority}
                            </span>
                          ) : <span className="text-neutral-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-neutral-500 hidden md:table-cell">
                          {daysOpen(meta.Created)}
                        </td>
                        <td className="px-3 py-2 text-center hidden sm:table-cell">
                          {task.sla_breach_at ? (
                            <SLATimer breachAt={task.sla_breach_at} />
                          ) : <span className="text-neutral-600">No SLA</span>}
                        </td>
                        <td className="px-3 py-2 text-center hidden md:table-cell">
                          <span className={due.className}>{due.text}</span>
                        </td>
                        <td className="px-2 py-2 text-center text-neutral-600">
                          {isExpanded ? '▾' : '▸'}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-[#272C33]">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="space-y-3">
                              {/* Metadata badges */}
                              <div className="flex flex-wrap gap-2">
                                {meta.Status && (
                                  <div className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-500">Status:</span>
                                    <span className="text-neutral-300 font-medium">{meta.Status}</span>
                                  </div>
                                )}
                                {meta.Priority && (
                                  <div className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-500">Priority:</span>
                                    <span className="text-neutral-300 font-medium">{meta.Priority}</span>
                                  </div>
                                )}
                                {tier && (
                                  <div className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-500">Tier:</span>
                                    <span className="text-neutral-300 font-medium">{tier}</span>
                                  </div>
                                )}
                                {meta.Assignee && (
                                  <div className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-500">Assignee:</span>
                                    <span className="text-neutral-300 font-medium">{meta.Assignee}</span>
                                  </div>
                                )}
                                {meta.Created && (
                                  <div className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-500">Created:</span>
                                    <span className="text-neutral-300 font-medium">{meta.Created}</span>
                                  </div>
                                )}
                              </div>

                              {/* SLA + Due date detail */}
                              <div className="flex items-center gap-4 text-[10px] text-neutral-600">
                                {task.sla_breach_at && <span>SLA Breach: {new Date(task.sla_breach_at).toLocaleString()}</span>}
                                {task.due_date && <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>}
                                <span>Last updated: {new Date(task.updated_at).toLocaleString()}</span>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); openDrawer(task.id); }}
                                  className="px-3 py-1 text-xs bg-[#2f353d] text-neutral-300 rounded hover:text-[#5ec1ca] transition-colors"
                                >
                                  Open Details
                                </button>
                                {task.source_url && (
                                  <a
                                    href={task.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="px-3 py-1 text-xs bg-[#2f353d] text-neutral-300 rounded hover:text-[#5ec1ca] transition-colors"
                                  >
                                    Open in {SOURCE_META[task.source]?.label ?? task.source}
                                  </a>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); onUpdateTask(task.id, { is_pinned: !task.is_pinned }); }}
                                  className="px-3 py-1 text-xs bg-[#363d47] text-neutral-300 rounded hover:bg-[#3a424d] transition-colors"
                                >
                                  {task.is_pinned ? 'Unfocus' : 'Focus'}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onUpdateTask(task.id, { status: 'done' }); }}
                                  className="px-3 py-1 text-xs bg-[#363d47] text-neutral-300 rounded hover:bg-[#3a424d] transition-colors"
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {drawerTask && (
          <TaskDrawer
            task={drawerTask}
            index={drawerIndex}
            total={flatTasks.length}
            onClose={closeDrawer}
            onPrev={prevDrawer}
            onNext={nextDrawer}
            onTaskUpdated={() => onUpdateTask(drawerTask.id, {})}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <CreateTaskForm />

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
              My Focus
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
                <TaskCard key={task.id} task={task} onUpdate={onUpdateTask} onClick={() => openDrawer(task.id)} />
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
                    onClick={() => openDrawer(task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Universal task drawer */}
      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          index={drawerIndex}
          total={flatTasks.length}
          onClose={closeDrawer}
          onPrev={prevDrawer}
          onNext={nextDrawer}
          onTaskUpdated={() => {
            // Trigger a re-sync after drawer edits
            onUpdateTask(drawerTask.id, {});
          }}
        />
      )}
    </div>
  );
}
