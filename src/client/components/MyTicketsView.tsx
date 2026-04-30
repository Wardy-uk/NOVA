import { useState, useMemo, useCallback } from 'react';
import type { Task } from '../../shared/types.js';
import { useMyTicketsQueue, type RankedTicket } from '../hooks/useMyTicketsQueue.js';
import { TaskListHeader } from './TaskListHeader.js';
import { TicketBriefCard, briefPropsFromTask } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { DeferReasonModal } from './DeferReasonModal.js';
import { TaskDrawer } from './TaskDrawer.js';

interface Props {
  tasks: Task[];
  loading: boolean;
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  agentUsername: string;
  agentDisplayName: string;
  teamName?: string;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

function BandHeader({ label, count, defaultOpen, children }: {
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

function TicketRow({ ticket, task, dimmed, onClick }: {
  ticket: RankedTicket;
  task: Task | undefined;
  dimmed?: boolean;
  onClick: () => void;
}) {
  const statusColor = task?.status?.toLowerCase().includes('progress')
    ? 'text-blue-400'
    : task?.status?.toLowerCase().includes('waiting')
    ? 'text-amber-400'
    : 'text-neutral-400';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg border border-[#2A2F38] transition-colors ${
        dimmed
          ? 'bg-[#141820]/60 hover:bg-[#1A1F26] opacity-70'
          : 'bg-[#141820] hover:bg-[#1A1F26]'
      }`}
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
        </div>
      </div>
    </button>
  );
}

export function MyTicketsView({ tasks, loading, onUpdateTask, agentUsername, agentDisplayName, teamName }: Props) {
  const { queue, loading: queueLoading, refresh } = useMyTicketsQueue(agentUsername);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [deferTicketKey, setDeferTicketKey] = useState<string | null>(null);

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
      // Emit rank_override event
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

  const drawerTask = useMemo(() => {
    if (!drawerTaskId) return null;
    return tasks.find(t => t.id === drawerTaskId) ?? null;
  }, [drawerTaskId, tasks]);

  const isLoading = loading || queueLoading;

  if (isLoading && !queue) {
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

  const nowTask = bands.now ? taskByKey.get(bands.now.ticketKey) : null;
  const nowBrief = nowTask ? briefPropsFromTask(nowTask) : null;

  return (
    <div className="max-w-5xl mx-auto">
      <TaskListHeader
        agentName={agentDisplayName}
        teamName={teamName}
        ticketCount={queue?.tickets.length ?? 0}
      />

      {/* NOW band */}
      {bands.now && (
        <div className="mb-4">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Now</span>
            <span className="text-[10px] text-neutral-500">(1)</span>
          </div>
          <div className="bg-[#141820] border border-emerald-900/40 rounded-xl p-4 space-y-3">
            {nowBrief && (
              <TicketBriefCard {...nowBrief} />
            )}
            {bands.now.ticketKey && (
              <AINextActionCard ticketKey={bands.now.ticketKey} />
            )}
            <div className="flex gap-2 pt-2 border-t border-[#2A2F38]">
              <button
                onClick={() => setDeferTicketKey(bands.now!.ticketKey)}
                className="px-3 py-1.5 text-xs bg-[#272C33] hover:bg-[#2A2F38] text-neutral-300 rounded-lg transition-colors"
              >
                Defer with reason
              </button>
            </div>
          </div>
        </div>
      )}

      {!bands.now && !isLoading && (
        <div className="mb-4 px-4 py-8 text-center bg-[#141820] border border-[#2A2F38] rounded-xl">
          <p className="text-sm text-neutral-400">No tickets in queue</p>
          <p className="text-xs text-neutral-600 mt-1">All caught up, or no tickets assigned to you</p>
        </div>
      )}

      {/* NEXT band */}
      {bands.next.length > 0 && (
        <BandHeader label="Next" count={bands.next.length} defaultOpen>
          {bands.next.map((ticket, i) => (
            <TicketRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              dimmed
              onClick={() => handleClickNext(ticket, i + 1)}
            />
          ))}
        </BandHeader>
      )}

      {/* DEFERRED band */}
      {bands.deferred.length > 0 && (
        <BandHeader label="Deferred" count={bands.deferred.length}>
          {bands.deferred.map(ticket => (
            <TicketRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              onClick={() => {
                const task = taskByKey.get(ticket.ticketKey);
                if (task) setDrawerTaskId(task.id);
              }}
            />
          ))}
        </BandHeader>
      )}

      {/* HYGIENE QUEUE band */}
      <BandHeader label="Hygiene Queue" count={bands.hygiene.length}>
        {bands.hygiene.length === 0 ? (
          <p className="text-xs text-neutral-600 px-3 py-2">
            No hygiene items — hygiene pass not yet active
          </p>
        ) : (
          bands.hygiene.map(ticket => (
            <TicketRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              onClick={() => {
                const task = taskByKey.get(ticket.ticketKey);
                if (task) setDrawerTaskId(task.id);
              }}
            />
          ))
        )}
      </BandHeader>

      {/* WAITING ON OTHERS band */}
      {bands.waiting.length > 0 && (
        <BandHeader label="Waiting on Others" count={bands.waiting.length}>
          {bands.waiting.map(ticket => (
            <TicketRow
              key={ticket.ticketKey}
              ticket={ticket}
              task={taskByKey.get(ticket.ticketKey)}
              onClick={() => {
                const task = taskByKey.get(ticket.ticketKey);
                if (task) setDrawerTaskId(task.id);
              }}
            />
          ))}
        </BandHeader>
      )}

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

      {/* Task drawer for NEXT/DEFERRED/etc clicks */}
      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          index={0}
          total={1}
          onClose={() => setDrawerTaskId(null)}
          onPrev={() => {}}
          onNext={() => {}}
        />
      )}
    </div>
  );
}
