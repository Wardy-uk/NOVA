import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskCard } from './TaskCard.js';
import { TaskDrawer } from './TaskDrawer.js';

interface AttentionTask extends Task {
  attention_reasons: ('overdue_update' | 'sla_breached' | 'sla_approaching')[];
  urgency_score: number;
  sla_remaining_ms: number | null;
}

interface Props {
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  scope?: 'mine' | 'all';
}

type FilterMode = 'all' | 'overdue_update' | 'sla_breached' | 'sla_approaching';

/** Format milliseconds into a human-readable remaining time string. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return '0m';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Get urgency colour classes based on score. */
function urgencyColor(score: number): string {
  if (score >= 70) return 'bg-red-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-neutral-500';
}

export function NeedsAttentionView({ onUpdateTask, scope = 'all' }: Props) {
  const [tasks, setTasks] = useState<AttentionTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

  const fetchAttention = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/service-desk/attention?scope=${scope}`);
      const json = await res.json();
      if (json.ok && json.data) {
        setTasks(json.data);
      } else {
        setError(json.error || 'Failed to fetch');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { fetchAttention(); }, [fetchAttention]);

  // Counts
  const overdueCount = useMemo(() => tasks.filter(t => t.attention_reasons.includes('overdue_update')).length, [tasks]);
  const slaCount = useMemo(() => tasks.filter(t => t.attention_reasons.includes('sla_breached')).length, [tasks]);
  const approachingCount = useMemo(() => tasks.filter(t => t.attention_reasons.includes('sla_approaching')).length, [tasks]);

  // Filtered list
  const filtered = useMemo(() => {
    if (filterMode === 'all') return tasks;
    return tasks.filter(t => t.attention_reasons.includes(filterMode));
  }, [tasks, filterMode]);

  // Sort by urgency score descending (server also sorts, client fallback)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0));
  }, [filtered]);

  // Drawer navigation
  const drawerIndex = useMemo(() => {
    if (!drawerTaskId) return -1;
    return sorted.findIndex(t => t.id === drawerTaskId);
  }, [drawerTaskId, sorted]);

  const drawerTask = drawerIndex >= 0 ? sorted[drawerIndex] : null;

  const closeDrawer = useCallback(() => setDrawerTaskId(null), []);
  const prevDrawer = useCallback(() => {
    if (drawerIndex > 0) setDrawerTaskId(sorted[drawerIndex - 1].id);
  }, [drawerIndex, sorted]);
  const nextDrawer = useCallback(() => {
    if (drawerIndex < sorted.length - 1) setDrawerTaskId(sorted[drawerIndex + 1].id);
  }, [drawerIndex, sorted]);

  // ── Render ──

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading tickets...
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-5xl mx-auto">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-neutral-200">
            {tasks.length === 0
              ? 'No tickets need attention'
              : `${tasks.length} ticket${tasks.length !== 1 ? 's' : ''} need${tasks.length === 1 ? 's' : ''} attention`}
          </h3>
          {tasks.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              {overdueCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-900/50 text-amber-300">
                  {overdueCount} overdue update{overdueCount !== 1 ? 's' : ''}
                </span>
              )}
              {slaCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-900/50 text-red-300">
                  {slaCount} SLA breached
                </span>
              )}
              {approachingCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-orange-900/50 text-orange-300">
                  {approachingCount} SLA approaching
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Filter pills */}
          {tasks.length > 0 && (
            <div className="flex items-center gap-1">
              {([
                { value: 'all' as FilterMode, label: 'All' },
                { value: 'overdue_update' as FilterMode, label: 'Overdue Updates' },
                { value: 'sla_breached' as FilterMode, label: 'SLA Breached' },
                { value: 'sla_approaching' as FilterMode, label: 'SLA Approaching' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilterMode(opt.value)}
                  className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
                    filterMode === opt.value
                      ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                      : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Refresh */}
          <button
            onClick={fetchAttention}
            disabled={loading}
            className="p-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-[#2f353d] transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 rounded bg-red-900/30 border border-red-800/50 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tasks.length === 0 && (
        <div className="text-center py-16 text-neutral-500">
          <div className="text-3xl mb-2">&#10003;</div>
          <div className="text-sm">All caught up! No tickets need immediate attention.</div>
        </div>
      )}

      {/* Ticket list */}
      {sorted.length > 0 && (
        <div className="space-y-1">
          {sorted.map((task) => (
            <div key={task.id}>
              {/* Urgency + attention badges */}
              <div className="flex items-center gap-1.5 pl-12 mb-0.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${urgencyColor(task.urgency_score ?? 0)}`}
                  title={`Urgency: ${task.urgency_score ?? 0}`} />
                <span className="text-[10px] text-neutral-500 tabular-nums">
                  {task.urgency_score ?? 0}
                </span>
                {task.attention_reasons.includes('sla_breached') && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-red-600 text-red-100">
                    SLA Breached
                  </span>
                )}
                {task.attention_reasons.includes('sla_approaching') && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-orange-600 text-orange-100">
                    SLA Approaching{task.sla_remaining_ms != null && task.sla_remaining_ms > 0
                      ? ` — ${formatRemaining(task.sla_remaining_ms)}` : ''}
                  </span>
                )}
                {task.attention_reasons.includes('overdue_update') && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-600 text-amber-100">
                    Overdue Update
                  </span>
                )}
              </div>
              <TaskCard
                task={task}
                onUpdate={onUpdateTask}
                onClick={() => setDrawerTaskId(task.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Drawer */}
      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          index={drawerIndex}
          total={sorted.length}
          onClose={closeDrawer}
          onPrev={prevDrawer}
          onNext={nextDrawer}
          onTaskUpdated={() => onUpdateTask(drawerTask.id, {})}
        />
      )}
    </div>
  );
}
