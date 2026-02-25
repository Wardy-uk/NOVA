import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskCard } from './TaskCard.js';
import { TaskDrawer } from './TaskDrawer.js';

interface MilestoneSummary {
  overdueCount: number;
  totalCount: number;
  completeCount: number;
  nextOverdue: string | null;
}

interface DeliveryEntry {
  id: number;
  onboarding_id: string | null;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  order_date: string | null;
  go_live_date: string | null;
  predicted_delivery: string | null;
  training_date: string | null;
  branches: number | null;
  mrr: number | null;
  is_starred: number;
  star_scope: 'me' | 'all';
  notes: string | null;
  milestone_summary: MilestoneSummary | null;
}

interface Props {
  tasks: Task[];
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
}

const STATUS_COLORS: Record<string, string> = {
  'wip': 'text-blue-400',
  'in progress': 'text-blue-400',
  'live': 'text-green-400',
  'complete': 'text-green-400',
  'dead': 'text-red-400',
  'on hold': 'text-amber-400',
  'pending': 'text-amber-400',
};

function statusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? 'text-neutral-400';
}

export function MyFocusView({ tasks, onUpdateTask }: Props) {
  const focused = useMemo(() => tasks.filter((t) => t.is_pinned), [tasks]);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryEntry[]>([]);

  // Fetch my-focus delivery entries
  useEffect(() => {
    fetch('/api/delivery/entries/my-focus')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data)) setDeliveries(json.data);
      })
      .catch(() => {});
  }, []);

  const drawerIndex = useMemo(() => {
    if (!drawerTaskId) return -1;
    return focused.findIndex((t) => t.id === drawerTaskId);
  }, [drawerTaskId, focused]);

  const drawerTask = drawerIndex >= 0 ? focused[drawerIndex] : null;

  const openDrawer = useCallback((taskId: string) => setDrawerTaskId(taskId), []);
  const closeDrawer = useCallback(() => setDrawerTaskId(null), []);
  const prevDrawer = useCallback(() => {
    if (drawerIndex > 0) setDrawerTaskId(focused[drawerIndex - 1].id);
  }, [drawerIndex, focused]);
  const nextDrawer = useCallback(() => {
    if (drawerIndex < focused.length - 1) setDrawerTaskId(focused[drawerIndex + 1].id);
  }, [drawerIndex, focused]);

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const isEmpty = focused.length === 0 && deliveries.length === 0;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
          My Focus
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">{today}</p>
      </div>

      {isEmpty ? (
        <div className="border border-[#3a424d] rounded-lg px-6 py-12 bg-[#2f353d] text-center">
          <div className="text-neutral-400 text-sm mb-2">No focused tasks yet</div>
          <p className="text-xs text-neutral-500">
            Add tasks from the Tasks view, Ask N.O.V.A, or Standup to build your workstream.
            Star deliveries or get assigned as onboarder to see them here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pinned tasks */}
          {focused.length > 0 && (
            <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
                  Focused Tasks
                </h3>
                <span className="text-xs text-neutral-500">
                  {focused.length} {focused.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>
              <div className="space-y-1">
                {focused.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onUpdate={onUpdateTask}
                    onClick={() => openDrawer(task.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Delivery entries */}
          {deliveries.length > 0 && (
            <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
                  My Deliveries
                </h3>
                <span className="text-xs text-neutral-500">
                  {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'}
                </span>
              </div>
              <div className="space-y-1.5">
                {deliveries.map((d) => {
                  const ms = d.milestone_summary;
                  const progress = ms ? Math.round((ms.completeCount / ms.totalCount) * 100) : 0;

                  return (
                    <div
                      key={d.id}
                      className={`px-3 py-2.5 rounded-md bg-[#272C33] border transition-colors ${
                        ms && ms.overdueCount > 0 ? 'border-red-900/60' : 'border-[#3a424d]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Star / overdue indicator */}
                        {d.is_starred ? (
                          <span className="text-amber-400 text-sm shrink-0" title={d.star_scope === 'all' ? 'Team star' : 'My star'}>
                            &#9733;
                          </span>
                        ) : ms && ms.overdueCount > 0 ? (
                          <span className="text-red-400 text-sm shrink-0" title={`${ms.overdueCount} overdue milestone(s)`}>
                            &#9888;
                          </span>
                        ) : (
                          <span className="text-neutral-600 text-sm shrink-0" title="Assigned">
                            &#9679;
                          </span>
                        )}

                        {/* Product badge */}
                        <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#0052CC] text-white shrink-0">
                          {d.product}
                        </span>

                        {/* Account + ID */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-neutral-100 font-medium truncate">
                            {d.account}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-0.5">
                            {d.onboarding_id && <span className="text-neutral-400">{d.onboarding_id}</span>}
                            {d.onboarder && <span>Onboarder: {d.onboarder}</span>}
                          </div>
                        </div>

                        {/* Status */}
                        <span className={`text-[11px] font-medium shrink-0 ${statusColor(d.status)}`}>
                          {d.status || 'No status'}
                        </span>

                        {/* Dates */}
                        <div className="text-[10px] text-neutral-500 shrink-0 text-right leading-relaxed">
                          {d.go_live_date && <div>Go-live: {d.go_live_date}</div>}
                          {d.training_date && <div>Training: {d.training_date}</div>}
                          {!d.go_live_date && d.predicted_delivery && <div>Est: {d.predicted_delivery}</div>}
                        </div>
                      </div>

                      {/* Milestone progress row */}
                      {ms && ms.totalCount > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-[#1f242b] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${progress}%`,
                                backgroundColor: progress === 100 ? '#22c55e' : ms.overdueCount > 0 ? '#ef4444' : '#5ec1ca',
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-neutral-500 shrink-0">
                            {ms.completeCount}/{ms.totalCount}
                          </span>
                          {ms.overdueCount > 0 && (
                            <span className="text-[10px] text-red-400 shrink-0">
                              {ms.overdueCount} overdue{ms.nextOverdue ? ` — ${ms.nextOverdue}` : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          index={drawerIndex}
          total={focused.length}
          onClose={closeDrawer}
          onPrev={prevDrawer}
          onNext={nextDrawer}
          onTaskUpdated={() => {
            onUpdateTask(drawerTask.id, {});
          }}
        />
      )}
    </div>
  );
}
