import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskDrawer } from './TaskDrawer.js';
import { useMyTicketsQueue, type RankedTicket } from '../hooks/useMyTicketsQueue.js';
import { TaskListHeader } from './TaskListHeader.js';
import { TicketBriefCard, briefPropsFromTask } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { DeferReasonModal } from './DeferReasonModal.js';
import { EscalationWizardModal } from './EscalationWizardModal.js';
import { HoldingUpdatePanel } from './HoldingUpdatePanel.js';
import { CloseTicketPanel } from './CloseTicketPanel.js';
import { HygienePassPanel } from './HygienePassPanel.js';
import { ChasePanel } from './ChasePanel.js';
import { StuckHelperPanel } from './StuckHelperPanel.js';
import { RoutePanel } from './RoutePanel.js';
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
  jira: 'JIRA', milestone: 'OB',
};

const SOURCE_COLORS: Record<string, string> = {
  jira: 'bg-[#0052CC]', milestone: 'bg-emerald-600',
};

// --- ADF text helper ---

function adfToText(adf: unknown): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  try {
    const walk = (node: any): string => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(walk).join('');
      return '';
    };
    return walk(adf);
  } catch { return ''; }
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function getTicketMeta(task: Task | undefined) {
  if (!task) return { status: '', tier: '', tldr: '' };
  const rd = (task.raw_data && typeof task.raw_data === 'object') ? task.raw_data as Record<string, unknown> : null;
  const statusRaw = rd?.status;
  const status = typeof statusRaw === 'string' ? statusRaw : (statusRaw as any)?.name ?? task.status ?? '';
  const tierRaw = rd?.customfield_12981;
  const tier = typeof tierRaw === 'string' ? tierRaw : (tierRaw as any)?.value ?? '';
  const tldr = adfToText(rd?.customfield_13184);
  return { status, tier, tldr };
}

function StatusPill({ status }: { status: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  let bg = 'rgba(100,116,139,0.15)';
  let fg = '#94a3b8';
  if (s.includes('progress') || s.includes('working')) { bg = 'rgba(59,130,246,0.15)'; fg = '#60a5fa'; }
  else if (s.includes('waiting') || s.includes('hold')) { bg = 'rgba(245,158,11,0.15)'; fg = '#f59e0b'; }
  else if (s.includes('done') || s.includes('closed') || s.includes('resolved')) { bg = 'rgba(16,185,129,0.15)'; fg = '#10b981'; }
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color: fg, border: `1px solid ${fg}40` }}
    >
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (!tier) return null;
  return (
    <span
      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
      style={{ background: 'rgba(155,106,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(155,106,237,0.3)' }}
    >
      {tier}
    </span>
  );
}

// --- Banded view sub-components ---

const BAND_ACCENTS: Record<string, string> = {
  now: '#10b981',
  next: '#94a3b8',
  deferred: '#f59e0b',
  hygiene: '#ef4444',
  waiting: '#9b6aed',
};

function BandAccordion({ label, count, defaultOpen, accentKey, children }: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  accentKey?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const accent = BAND_ACCENTS[accentKey ?? ''] ?? '#94a3b8';
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-2.5 w-full text-left px-4 py-2.5 rounded-xl transition-all hover:scale-[1.005]"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span className="text-[10px] text-neutral-500 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>{label}</span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: `${accent}20`, color: accent }}
        >
          {count}
        </span>
      </button>
      {open && <div className="mt-2 space-y-1.5 pl-1">{children}</div>}
    </div>
  );
}

function NextTicketRow({ ticket, task, onClick }: {
  ticket: RankedTicket;
  task: Task | undefined;
  onClick: () => void;
}) {
  const { status, tier, tldr } = getTicketMeta(task);
  const age = task?.created_at ? daysOpen(task.created_at) : '';

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer p-3 rounded-xl transition-all duration-200"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] font-mono font-bold text-[#5ec1ca]">{ticket.ticketKey}</span>
          <StatusPill status={status} />
          <TierBadge tier={tier} />
        </div>
      </div>
      <div className="text-[12px] text-neutral-50 font-semibold truncate mb-1">
        {task?.title ?? ticket.ticketKey}
      </div>
      {tldr && (
        <div className="text-[11px] text-neutral-300 line-clamp-2 mb-2 leading-snug">{tldr}</div>
      )}
      <div className="flex items-center justify-between text-[10px] text-neutral-400">
        <span>{ticket.rankReason}</span>
        <div className="flex items-center gap-2">
          {age && <span>{age} old</span>}
          {task?.updated_at && <span>{timeAgo(task.updated_at)}</span>}
        </div>
      </div>
    </div>
  );
}

function DeferredRow({ ticket, task, onClick, accent }: {
  ticket: RankedTicket;
  task: Task | undefined;
  onClick: () => void;
  accent?: 'amber' | 'purple' | 'red';
}) {
  const { status, tier, tldr } = getTicketMeta(task);
  const borderColor = accent === 'amber' ? 'rgba(245,158,11,0.4)' : accent === 'purple' ? 'rgba(155,106,237,0.4)' : accent === 'red' ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)';

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer p-3 rounded-xl transition-all duration-200 border-l-2"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeftWidth: '3px',
        borderLeftColor: borderColor,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] font-mono font-bold text-[#5ec1ca]">{ticket.ticketKey}</span>
          <StatusPill status={status} />
          <TierBadge tier={tier} />
        </div>
      </div>
      <div className="text-[12px] text-neutral-50 font-semibold truncate mb-1">
        {task?.title ?? ticket.ticketKey}
      </div>
      {tldr && (
        <div className="text-[11px] text-neutral-300 line-clamp-1 mb-1 leading-snug">{tldr}</div>
      )}
      <div className="text-[10px] text-neutral-400">{ticket.rankReason}</div>
    </div>
  );
}

// --- Main component ---

export function TaskList({ tasks, loading, onUpdateTask, minimal, agentUsername, agentDisplayName, teamName }: Props) {
  const { queue, loading: queueLoading, refresh } = useMyTicketsQueue(agentUsername ?? null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [deferTicketKey, setDeferTicketKey] = useState<string | null>(null);
  const [escalateTicket, setEscalateTicket] = useState<{ ticketKey: string; aiContext?: { headline?: string; body?: string } } | null>(null);
  const [holdingUpdateTicket, setHoldingUpdateTicket] = useState<string | null>(null);
  const [closeTicketKey, setCloseTicketKey] = useState<string | null>(null);
  const [chaseTicketKey, setChaseTicketKey] = useState<string | null>(null);
  const [stuckHelperTicket, setStuckHelperTicket] = useState<{ key: string; summary: string } | null>(null);
  const [routeTicket, setRouteTicket] = useState<{ key: string; summary: string } | null>(null);

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
    <div className="relative max-w-5xl mx-auto">
      {/* Ambient background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-60"
        style={{
          background: `
            radial-gradient(ellipse at 12% 18%, rgba(155,106,237,0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 88% 25%, rgba(94,193,202,0.06) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 95%, rgba(16,185,129,0.04) 0%, transparent 55%)
          `,
          animation: 'tlMesh 25s ease-in-out infinite alternate',
          zIndex: 0,
        }}
      />
      <style>{`
        @keyframes tlMesh { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(-1%,1%) scale(1.02); } 100% { transform: translate(1%,-1%) scale(0.99); } }
        @keyframes tlShift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes tlFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .tl-fade { animation: tlFadeIn 0.4s cubic-bezier(0.16,1,0.3,1) both; }
        .tl-scroll::-webkit-scrollbar { width: 5px; }
        .tl-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        .tl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>

      <div className="relative z-10">
        <TaskListHeader
          agentName={agentDisplayName ?? 'Agent'}
          teamName={teamName}
          ticketCount={queue?.tickets.length ?? 0}
        />

        {/* === NOW band === */}
        {nowTicket ? (
          <div className="mb-5 tl-fade">
            <div className="flex items-center gap-2.5 px-4 py-2 mb-2">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Now</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>1</span>
            </div>
            <div
              className="relative rounded-2xl overflow-hidden p-5 space-y-3"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{
                  background: 'linear-gradient(90deg, transparent, #10b981 30%, #5ec1ca 70%, transparent)',
                  backgroundSize: '200% 100%',
                  animation: 'tlShift 6s ease-in-out infinite',
                }}
              />
              {nowBrief && <TicketBriefCard {...nowBrief} />}
              <AINextActionCard
                ticketKey={nowTicket.ticketKey}
                onEscalate={(ctx) => setEscalateTicket({ ticketKey: nowTicket.ticketKey, aiContext: ctx })}
                onHoldingUpdate={() => setHoldingUpdateTicket(nowTicket.ticketKey)}
                onCloseTicket={() => setCloseTicketKey(nowTicket.ticketKey)}
                onRoute={() => {
                  const t = taskByKey.get(nowTicket.ticketKey);
                  setRouteTicket({ key: nowTicket.ticketKey, summary: t?.title ?? nowTicket.ticketKey });
                }}
                onChase={() => setChaseTicketKey(nowTicket.ticketKey)}
                onStuckHelper={() => {
                  const t = taskByKey.get(nowTicket.ticketKey);
                  setStuckHelperTicket({ key: nowTicket.ticketKey, summary: t?.title ?? nowTicket.ticketKey });
                }}
              />
              <div className="flex gap-2 pt-3 border-t border-white/5">
                {nowTicket.nextAction?.primaryAction && (
                  <button
                    onClick={() => {
                      const pa = nowTicket.nextAction!.primaryAction;
                      if (pa.jiraTransition && /escalat/i.test(pa.jiraTransition)) {
                        setEscalateTicket({ ticketKey: nowTicket.ticketKey, aiContext: { headline: nowTicket.nextAction!.headline, body: nowTicket.nextAction!.body } });
                      } else if (/update|holding|hasn.t heard/i.test(pa.label)) {
                        setHoldingUpdateTicket(nowTicket.ticketKey);
                      } else if (/close|resolve|mark.?resolved|confirmed.?fix/i.test(pa.label)) {
                        setCloseTicketKey(nowTicket.ticketKey);
                      }
                    }}
                    className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a]"
                    style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}
                  >
                    {nowTicket.nextAction.primaryAction.label}
                  </button>
                )}
                <button
                  onClick={() => {
                    const task = nowTask;
                    if (task) setDrawerTaskId(task.id);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5 transition-colors"
                >
                  Edit first
                </button>
                <button
                  onClick={() => setDeferTicketKey(nowTicket.ticketKey)}
                  className="px-3 py-1.5 text-xs rounded-lg font-semibold text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                >
                  Defer with reason
                </button>
              </div>
            </div>
          </div>
        ) : !isLoading ? (
          <div className="mb-5 px-4 py-10 text-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-sm text-neutral-400">No tickets in queue</p>
            <p className="text-xs text-neutral-600 mt-1">All caught up, or no tickets assigned to you</p>
          </div>
        ) : null}

        {/* === NEXT band === */}
        {bands.next.length > 0 && (
          <div className="mb-4 tl-fade">
            <div className="flex items-center gap-2.5 px-4 py-2 mb-2">
              <span className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider">Next</span>
              <span className="text-[10px] text-neutral-500">— ranked</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>
                {bands.next.length}
              </span>
            </div>
            <div className="space-y-1.5">
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
        <BandAccordion label="Deferred" count={bands.deferred.length} accentKey="deferred">
          {bands.deferred.length === 0 ? (
            <p className="text-xs text-neutral-600 px-3 py-2">No deferred tickets</p>
          ) : (
            bands.deferred.map(ticket => (
              <DeferredRow
                key={ticket.ticketKey}
                ticket={ticket}
                task={taskByKey.get(ticket.ticketKey)}
                onClick={() => openDrawer(ticket.ticketKey)}
                accent="amber"
              />
            ))
          )}
        </BandAccordion>

        {/* === HYGIENE QUEUE band === */}
        <BandAccordion label="Hygiene Queue" count={bands.hygiene.length} defaultOpen={bands.hygiene.length > 0} accentKey="hygiene">
          <HygienePassPanel
            onOpenTicket={openDrawer}
            onAction={(ticketKey, checkId) => {
              if (checkId === 'sla_risk' || checkId === 'chase_cadence') {
                setHoldingUpdateTicket(ticketKey);
              } else if (checkId === 'next_update_overdue' || checkId === 'customer_waiting') {
                setHoldingUpdateTicket(ticketKey);
              } else {
                openDrawer(ticketKey);
              }
            }}
          />
          {bands.hygiene.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {bands.hygiene.map(ticket => (
                <DeferredRow
                  key={ticket.ticketKey}
                  ticket={ticket}
                  task={taskByKey.get(ticket.ticketKey)}
                  onClick={() => openDrawer(ticket.ticketKey)}
                  accent="red"
                />
              ))}
            </div>
          )}
        </BandAccordion>

        {/* === WAITING ON OTHERS band === */}
        <BandAccordion label="Waiting on Others" count={bands.waiting.length} accentKey="waiting">
          {bands.waiting.length === 0 ? (
            <p className="text-xs text-neutral-600 px-3 py-2">No tickets waiting on others</p>
          ) : (
            bands.waiting.map(ticket => (
              <DeferredRow
                key={ticket.ticketKey}
                ticket={ticket}
                task={taskByKey.get(ticket.ticketKey)}
                onClick={() => openDrawer(ticket.ticketKey)}
                accent="purple"
              />
            ))
          )}
        </BandAccordion>
      </div>

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

      {/* Holding update panel */}
      {holdingUpdateTicket && (
        <HoldingUpdatePanel
          ticketKey={holdingUpdateTicket}
          onClose={() => setHoldingUpdateTicket(null)}
          onSent={() => {
            setHoldingUpdateTicket(null);
            refresh();
          }}
        />
      )}

      {/* Close ticket panel */}
      {closeTicketKey && (
        <CloseTicketPanel
          ticketKey={closeTicketKey}
          onClose={() => setCloseTicketKey(null)}
          onResolved={() => {
            setCloseTicketKey(null);
            refresh();
          }}
        />
      )}

      {/* Chase panel */}
      {chaseTicketKey && (
        <ChasePanel
          ticketKey={chaseTicketKey}
          onClose={() => setChaseTicketKey(null)}
          onSent={() => {
            setChaseTicketKey(null);
            refresh();
          }}
          onRedirectToClose={() => {
            setChaseTicketKey(null);
            setCloseTicketKey(chaseTicketKey);
          }}
        />
      )}

      {/* Route panel */}
      {routeTicket && (
        <RoutePanel
          ticketKey={routeTicket.key}
          ticketSummary={routeTicket.summary}
          onClose={() => setRouteTicket(null)}
          onRouted={() => {
            setRouteTicket(null);
            refresh();
          }}
          onEscalate={() => {
            const key = routeTicket.key;
            setRouteTicket(null);
            setEscalateTicket({ ticketKey: key });
          }}
        />
      )}

      {/* Stuck helper panel */}
      {stuckHelperTicket && (
        <StuckHelperPanel
          ticketKey={stuckHelperTicket.key}
          ticketSummary={stuckHelperTicket.summary}
          onClose={() => setStuckHelperTicket(null)}
          onEscalate={() => {
            const key = stuckHelperTicket.key;
            setStuckHelperTicket(null);
            setEscalateTicket({ ticketKey: key });
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
