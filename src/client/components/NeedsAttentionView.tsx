import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskDrawer } from './TaskDrawer.js';
import { getTier } from '../utils/taskHelpers.js';

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

function slaDisplay(ms: number | null): { text: string; className: string } {
  if (ms === null) return { text: 'No SLA', className: 'text-neutral-600' };
  if (ms < 0) return { text: 'Breached', className: 'text-red-400 font-bold' };
  const hours = ms / (1000 * 60 * 60);
  if (hours < 2) return { text: formatRemaining(ms), className: 'text-red-400 font-bold' };
  if (hours < 8) return { text: formatRemaining(ms), className: 'text-amber-400 font-bold' };
  return { text: formatRemaining(ms), className: 'text-neutral-400' };
}

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

function daysOpen(dateStr: string | null): string {
  if (!dateStr) return '-';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return '-';
  return `${Math.floor(ms / (1000 * 60 * 60 * 24))}d`;
}

const REASON_LABELS: Record<string, string> = {
  sla_breached: 'SLA Breached',
  sla_approaching: 'SLA Approaching',
  overdue_update: 'Overdue Update',
};

const REASON_STYLES: Record<string, string> = {
  sla_breached: 'bg-red-900/40 text-red-400',
  sla_approaching: 'bg-orange-900/40 text-orange-400',
  overdue_update: 'bg-amber-900/40 text-amber-400',
};

export function NeedsAttentionView({ onUpdateTask, scope = 'all' }: Props) {
  const [tasks, setTasks] = useState<AttentionTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
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

  // Unassigned count
  const unassignedCount = useMemo(() => tasks.filter(t => t.description?.startsWith('Assignee: Unassigned')).length, [tasks]);

  // Filtered list
  const filtered = useMemo(() => {
    let result = tasks;
    if (filterMode !== 'all') result = result.filter(t => t.attention_reasons.includes(filterMode));
    if (unassignedOnly) result = result.filter(t => t.description?.startsWith('Assignee: Unassigned'));
    return result;
  }, [tasks, filterMode, unassignedOnly]);

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
      <div className="flex items-center justify-between flex-wrap gap-2">
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
              {unassignedCount > 0 && (
                <button
                  onClick={() => setUnassignedOnly(p => !p)}
                  className={`px-2.5 py-1 text-[11px] rounded-full transition-colors border ${
                    unassignedOnly
                      ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border-[#5ec1ca]/40 font-semibold'
                      : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] border-transparent'
                  }`}
                >
                  Unassigned ({unassignedCount})
                </button>
              )}
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

      {/* Ticket table */}
      {sorted.length > 0 && (
        <div className="border border-[#3a424d] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-[10px]">
                <th className="text-center px-3 py-2">Score</th>
                <th className="text-left px-3 py-2">Issue</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Status</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Assignee</th>
                <th className="text-left px-3 py-2">Reasons</th>
                <th className="text-center px-3 py-2 hidden sm:table-cell">Age</th>
                <th className="text-center px-3 py-2 hidden sm:table-cell">SLA</th>
                <th className="text-center px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {sorted.map(task => {
                const meta = parseDescMeta(task.description);
                const sla = slaDisplay(task.sla_remaining_ms);
                const isExpanded = expandedRows.has(task.id);
                const tier = getTier(task);

                return (
                  <Fragment key={task.id}>
                    <tr
                      className="bg-[#2f353d] hover:bg-[#363d47] transition-colors cursor-pointer"
                      onClick={() => toggleExpandedRow(task.id)}
                    >
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <div className="w-12 h-1.5 bg-[#272C33] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${urgencyColor(task.urgency_score ?? 0)}`}
                              style={{ width: `${Math.min(task.urgency_score ?? 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-neutral-400 text-[10px] w-6">{task.urgency_score ?? 0}</span>
                        </div>
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
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {task.attention_reasons.length > 0 ? task.attention_reasons.map((reason, i) => (
                            <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${REASON_STYLES[reason] ?? 'bg-[#272C33] text-neutral-400'}`}>
                              {REASON_LABELS[reason] ?? reason}
                            </span>
                          )) : <span className="text-neutral-500">-</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-neutral-500 hidden sm:table-cell">
                        {daysOpen(meta.Created)}
                      </td>
                      <td className="px-3 py-2 text-center hidden sm:table-cell">
                        <span className={sla.className}>{sla.text}</span>
                      </td>
                      <td className="px-2 py-2 text-center text-neutral-600">
                        {isExpanded ? '▾' : '▸'}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#272C33]">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="space-y-3">
                            {/* Detail badges */}
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

                            {/* Attention reasons detail */}
                            <div>
                              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">Attention Reasons</div>
                              <div className="flex flex-wrap gap-2">
                                {task.attention_reasons.map((reason, i) => (
                                  <div key={i} className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-300 font-medium">{REASON_LABELS[reason] ?? reason}</span>
                                    {reason === 'sla_approaching' && task.sla_remaining_ms != null && task.sla_remaining_ms > 0 && (
                                      <span className="text-neutral-500 text-[10px]">({formatRemaining(task.sla_remaining_ms)})</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Meta */}
                            <div className="flex items-center gap-4 text-[10px] text-neutral-600">
                              <span>Urgency score: {task.urgency_score ?? 0}</span>
                              {task.sla_remaining_ms != null && (
                                <span>SLA remaining: {task.sla_remaining_ms < 0 ? 'Breached' : formatRemaining(task.sla_remaining_ms)}</span>
                              )}
                              <span>Last updated: {new Date(task.updated_at).toLocaleString()}</span>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setDrawerTaskId(task.id); }}
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
                                  Open in Jira
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
