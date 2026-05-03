import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskDrawer } from './TaskDrawer.js';
import { useMyTicketsQueue, type RankedTicket } from '../hooks/useMyTicketsQueue.js';
import { TaskListHeader } from './TaskListHeader.js';
import { TicketBriefCard, briefPropsFromTask } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { DeferReasonModal } from './DeferReasonModal.js';
import { EscalationWizardModal } from './EscalationWizardModal.js';
import { SLATimer } from './SLATimer.js';

interface Props {
  tasks: Task[];
  loading: boolean;
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  /** Hide filters/grouping — show a flat sorted list (service desk table mode) */
  minimal?: boolean;
  /** Agent username for queue fetch — enables banded view */
  agentUsername?: string;
  /** Agent display name for header */
  agentDisplayName?: string;
  /** Team name for header */
  teamName?: string;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

// --- Minimal mode helpers (service desk table view) ---

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

const SOURCE_LABELS: Record<string, string> = {
  jira: 'JIRA', planner: 'PLAN', todo: 'TODO', monday: 'MON',
  email: 'EMAIL', calendar: 'CAL', milestone: 'OB',
};

const SOURCE_COLORS: Record<string, string> = {
  jira: 'bg-[#0052CC]', planner: 'bg-[#31752F]', todo: 'bg-[#797673]',
  monday: 'bg-[#FF6D00]', email: 'bg-[#0078D4]', calendar: 'bg-[#8764B8]',
  milestone: 'bg-emerald-600',
};

// --- Banded view sub-components ---

function BandAccordion({ label, count, defaultOpen, children }: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 bg-[#1A1F26] border border-[#2A2F38] rounded-lg hover:bg-[#1E232B] transition-colors"
      >
        <span className="text-[10px] text-neutral-500">{open ? '▼' : '▶'}</span>
        <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">{label}</span>
        <span className="text-[10px] text-neutral-500">({count})</span>
      </button>
      {open && <div className="mt-2 space-y-2 pl-2">{children}</div>}
    </div>
  );
}

function NextTicketRow({ ticket, task, onClick }: {
  ticket: RankedTicket;
  task: Task | undefined;
  onClick: () => void;
}) {
  const statusColor = task?.status?.toLowerCase().includes('progress')
    ? 'text-blue-400'
    : task?.status?.toLowerCase().includes('waiting')
    ? 'text-amber-400'
    : 'text-neutral-400';

  const age = task?.created_at ? daysOpen(task.created_at) : '-';

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg border border-[#2A2F38] bg-[#141820]/60 opacity-60 hover:opacity-80 hover:bg-[#1A1F26] transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-blue-400 shrink-0">{ticket.ticketKey}</span>
          <span className="text-sm text-neutral-200 truncate">{task?.title ?? ticket.ticketKey}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          {task?.status && (
            <span className={`text-[10px] ${statusColor}`}>{task.status}</span>
          )}
          <span className="text-[10px] text-neutral-500">{ticket.rankReason}</span>
          <span className="text-[10px] text-neutral-600 font-mono">{ticket.score}</span>
          <span className="text-[10px] text-neutral-600">{age}</span>
        </div>
      </div>
    </button>
  );
}

function DeferredRow({ ticket, task, onClick }: {
  ticket: RankedTicket;
  task: Task | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg border border-[#2A2F38] bg-[#141820] hover:bg-[#1A1F26] transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-blue-400 shrink-0">{ticket.ticketKey}</span>
          <span className="text-sm text-neutral-200 truncate">{task?.title ?? ticket.ticketKey}</span>
        </div>
        <span className="text-[10px] text-neutral-500 shrink-0 ml-3">{ticket.rankReason}</span>
      </div>
    </button>
  );
}

// --- Main component ---

export function TaskList({ tasks, loading, onUpdateTask, minimal, agentUsername, agentDisplayName, teamName }: Props) {
  const { queue, loading: queueLoading, refresh } = useMyTicketsQueue(agentUsername ?? null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [deferTicketKey, setDeferTicketKey] = useState<string | null>(null);
  const [escalateTicket, setEscalateTicket] = useState<{ ticketKey: string; aiContext?: { headline?: string; body?: string } } | null>(null);

  // --- Minimal mode state (service desk table) ---
  const [sortBy, setSortBy] = useState<SortField>(() => {
    if (typeof window === 'undefined') return 'priority';
    return (window.localStorage.getItem('nova_task_sort') as SortField) || 'priority';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('nova_task_sort', sortBy);
  }, [sortBy]);

  const sortTasks = (list: Task[]): Task[] => {
    return [...list].sort((a, b) => {
      if (sortBy === 'priority') return a.priority - b.priority;
      if (sortBy === 'due_date') {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  };

  // --- Banded view data ---
  const taskByKey = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) {
      if (t.source_id) map.set(t.source_id, t);
    }
    return map;
  }, [tasks]);

  const bands = useMemo(() => {
    if (!queue) return { now: null, next: [], deferred: [], hygiene: [], waiting: [] };
    const now = queue.tickets.find(t => t.band === 'NOW') ?? null;
    return {
      now,
      next: queue.tickets.filter(t => t.band === 'NEXT'),
      deferred: queue.tickets.filter(t => t.band === 'DEFERRED'),
      hygiene: queue.tickets.filter(t => t.band === 'HYGIENE'),
      waiting: queue.tickets.filter(t => t.band === 'WAITING'),
    };
  }, [queue]);

  const handleClickNext = useCallback((ticket: RankedTicket, originalRank: number) => {
    const task = taskByKey.get(ticket.ticketKey);
    if (task) {
      setDrawerTaskId(task.id);
      fetch('/api/my-tickets/events', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          event_type: 'rank_override',
          ticket_key: ticket.ticketKey,
          payload: {
            original_rank: originalRank,
            picked_rank: 0,
            override_reason: 'Agent clicked NEXT ticket instead of NOW',
          },
        }),
      }).catch(() => {});
    }
  }, [taskByKey]);

  const openDrawer = useCallback((ticketKey: string) => {
    const task = taskByKey.get(ticketKey);
    if (task) setDrawerTaskId(task.id);
  }, [taskByKey]);

  const openDrawerById = useCallback((taskId: string) => setDrawerTaskId(taskId), []);
  const closeDrawer = useCallback(() => setDrawerTaskId(null), []);

  const drawerTask = useMemo(() => {
    if (!drawerTaskId) return null;
    return tasks.find(t => t.id === drawerTaskId) ?? null;
  }, [drawerTaskId, tasks]);

  // Flat tasks for drawer prev/next in minimal mode
  const flatTasks = useMemo(() => sortTasks(tasks), [tasks, sortBy]);
  const drawerIndex = useMemo(() => {
    if (!drawerTaskId) return -1;
    return flatTasks.findIndex(t => t.id === drawerTaskId);
  }, [drawerTaskId, flatTasks]);

  const prevDrawer = useCallback(() => {
    if (drawerIndex > 0) setDrawerTaskId(flatTasks[drawerIndex - 1].id);
  }, [drawerIndex, flatTasks]);
  const nextDrawer = useCallback(() => {
    if (drawerIndex < flatTasks.length - 1) setDrawerTaskId(flatTasks[drawerIndex + 1].id);
  }, [drawerIndex, flatTasks]);

  // --- Loading states ---
  const isLoading = loading || queueLoading;

  if (isLoading && !queue && !minimal) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-[#1A1F26] rounded-lg" />
          <div className="h-48 bg-[#1A1F26] rounded-lg" />
          <div className="h-24 bg-[#1A1F26] rounded-lg" />
        </div>
      </div>
    );
  }

  if (loading && minimal) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        Loading tasks...
      </div>
    );
  }

  // ================================================================
  // MINIMAL MODE — service desk table view (unchanged)
  // ================================================================
  if (minimal) {
    const allSorted = sortTasks(tasks);
    return (
      <div className="space-y-3">
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
                  const due = dueDateDisplay(task.due_date);

                  return (
                      <tr
                        key={task.id}
                        className="bg-[#2f353d] hover:bg-[#363d47] transition-colors cursor-pointer"
                        onClick={() => openDrawerById(task.id)}
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
                      </tr>
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

  // ================================================================
  // BANDED MODE — My Tickets ranked queue view
  // ================================================================

  const nowTicket = bands.now;
  const nowTask = nowTicket ? taskByKey.get(nowTicket.ticketKey) : null;
  const nowBrief = nowTask ? briefPropsFromTask(nowTask) : null;

  if (tasks.length === 0 && !queue) {
    return (
      <div className="max-w-5xl mx-auto">
        <TaskListHeader
          agentName={agentDisplayName ?? 'Agent'}
          teamName={teamName}
          ticketCount={0}
        />
        <div className="px-4 py-12 text-center bg-[#141820] border border-[#2A2F38] rounded-xl">
          <p className="text-sm text-neutral-400">No tickets assigned</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <TaskListHeader
        agentName={agentDisplayName ?? 'Agent'}
        teamName={teamName}
        ticketCount={queue?.tickets.length ?? 0}
      />

      {/* === NOW band === */}
      {nowTicket ? (
        <div className="mb-4">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Now</span>
            <span className="text-[10px] text-neutral-500">(1)</span>
          </div>
          <div className="bg-[#2f353d] border border-[#5ec1ca]/40 rounded-xl p-4 space-y-3">
            {nowBrief && <TicketBriefCard {...nowBrief} />}
            <AINextActionCard
              ticketKey={nowTicket.ticketKey}
              onEscalate={(ctx) => setEscalateTicket({ ticketKey: nowTicket.ticketKey, aiContext: ctx })}
            />
            <div className="flex gap-2 pt-2 border-t border-[#3a424d]">
              {nowTicket.nextAction?.primaryAction && (
                <button
                  onClick={() => {
                    const pa = nowTicket.nextAction!.primaryAction;
                    if (pa.jiraTransition && /escalat/i.test(pa.jiraTransition)) {
                      setEscalateTicket({ ticketKey: nowTicket.ticketKey, aiContext: { headline: nowTicket.nextAction!.headline, body: nowTicket.nextAction!.body } });
                    }
                  }}
                  className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                >
                  {nowTicket.nextAction.primaryAction.label}
                </button>
              )}
              <button
                onClick={() => {
                  const task = nowTask;
                  if (task) setDrawerTaskId(task.id);
                }}
                className="px-3 py-1.5 text-xs bg-[#272C33] hover:bg-[#2A2F38] text-neutral-300 rounded-lg transition-colors"
              >
                Edit first
              </button>
              <button
                onClick={() => setDeferTicketKey(nowTicket.ticketKey)}
                className="px-3 py-1.5 text-xs bg-amber-900/40 hover:bg-amber-900/60 text-amber-300 rounded-lg transition-colors"
              >
                Defer with reason
              </button>
            </div>
          </div>
        </div>
      ) : !isLoading ? (
        <div className="mb-4 px-4 py-8 text-center bg-[#141820] border border-[#2A2F38] rounded-xl">
          <p className="text-sm text-neutral-400">No tickets in queue</p>
          <p className="text-xs text-neutral-600 mt-1">All caught up, or no tickets assigned to you</p>
        </div>
      ) : null}

      {/* === NEXT band === */}
      {bands.next.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2">
            <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">Next</span>
            <span className="text-[10px] text-neutral-500">— soft-locked, ranked</span>
            <span className="text-[10px] text-neutral-500">({bands.next.length})</span>
          </div>
          <div className="space-y-2">
            {bands.next.map((ticket, i) => (
              <NextTicketRow
                key={ticket.ticketKey}
                ticket={ticket}
                task={taskByKey.get(ticket.ticketKey)}
                onClick={() => handleClickNext(ticket, i + 1)}
              />
            ))}
          </div>
        </div>
      )}

      {/* === DEFERRED band === */}
      <BandAccordion label="Deferred" count={bands.deferred.length}>
        {bands.deferred.length === 0 ? (
          <p className="text-xs text-neutral-600 px-3 py-2">No deferred tickets</p>
        ) : (
          bands.deferred.map(ticket => (
            <DeferredRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              onClick={() => openDrawer(ticket.ticketKey)}
            />
          ))
        )}
      </BandAccordion>

      {/* === HYGIENE QUEUE band === */}
      <BandAccordion label="Hygiene Queue" count={bands.hygiene.length}>
        {bands.hygiene.length === 0 ? (
          <p className="text-xs text-neutral-600 px-3 py-2">Hygiene pass not configured</p>
        ) : (
          bands.hygiene.map(ticket => (
            <DeferredRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              onClick={() => openDrawer(ticket.ticketKey)}
            />
          ))
        )}
      </BandAccordion>

      {/* === WAITING ON OTHERS band === */}
      <BandAccordion label="Waiting on Others" count={bands.waiting.length}>
        {bands.waiting.length === 0 ? (
          <p className="text-xs text-neutral-600 px-3 py-2">No tickets waiting on others</p>
        ) : (
          bands.waiting.map(ticket => (
            <DeferredRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              onClick={() => openDrawer(ticket.ticketKey)}
            />
          ))
        )}
      </BandAccordion>

      {/* Defer modal */}
      {deferTicketKey && (
        <DeferReasonModal
          ticketKey={deferTicketKey}
          onClose={() => setDeferTicketKey(null)}
          onDeferred={() => {
            setDeferTicketKey(null);
            refresh();
          }}
        />
      )}

      {/* Escalation wizard */}
      {escalateTicket && (
        <EscalationWizardModal
          ticketKey={escalateTicket.ticketKey}
          aiContext={escalateTicket.aiContext}
          onClose={() => setEscalateTicket(null)}
          onEscalated={() => {
            setEscalateTicket(null);
            refresh();
          }}
        />
      )}

      {/* Task drawer */}
      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          index={0}
          total={1}
          onClose={closeDrawer}
          onPrev={() => {}}
          onNext={() => {}}
        />
      )}
    </div>
  );
}
