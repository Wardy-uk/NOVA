import { useState, useEffect } from 'react';
import type { Task } from '../../shared/types.js';

interface OnboardingRunSummary {
  id: number;
  ref: string;
  status: string;
  parentKey: string | null;
  createdCount: number;
  dryRun: boolean;
  createdAt: string;
}

interface Stats {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  completedToday: number;
  completedThisWeek: number;
  completionRate: number;
  avgAgeDays: number;
  highPriorityOpen: number;
  slaBreach: number;
  onboarding?: {
    milestones: { total: number; pending: number; in_progress: number; complete: number; overdue: number } | null;
    recentRuns: OnboardingRunSummary[];
  };
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

function KpiCard({ value, label, color = 'text-neutral-100', large }: {
  value: number | string; label: string; color?: string; large?: boolean;
}) {
  return (
    <div className="border border-[#3a424d] rounded-lg px-4 py-3 bg-[#2f353d]">
      <div className={`${large ? 'text-3xl' : 'text-2xl'} font-bold font-[var(--font-heading)] ${color}`}>
        {value}
      </div>
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );
}

function ProgressBar({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-400 w-24 text-right">{label}</span>
      <div className="flex-1 h-5 bg-[#272C33] rounded-full overflow-hidden border border-[#3a424d]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="text-xs text-neutral-300 w-12 text-right font-mono">{count}</span>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DailyStatsView({ tasks, onNavigate }: { tasks: Task[]; onNavigate?: (view: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const focusCount = tasks.filter((t) => t.is_pinned).length;

  useEffect(() => {
    fetch('/api/tasks/stats')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setStats(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tasks.length]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-neutral-500">Loading stats...</div>;
  }
  if (!stats) {
    return <div className="flex items-center justify-center py-20 text-neutral-500">Could not load stats</div>;
  }

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const sources = Object.keys(SOURCE_META).filter((s) => (stats.bySource[s] ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">Command Centre</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">{today}</p>
        </div>
      </div>

      {/* My Focus card */}
      {focusCount > 0 && (
        <button
          onClick={() => onNavigate?.('focus')}
          className="w-full border border-[#3a424d] rounded-lg px-4 py-3 bg-[#2f353d] hover:bg-[#363d47] transition-colors text-left group"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold font-[var(--font-heading)] text-amber-400">
                {focusCount}
              </div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
                My Focus
              </div>
            </div>
            <span className="text-xs text-neutral-600 group-hover:text-neutral-400 transition-colors">
              View &rarr;
            </span>
          </div>
        </button>
      )}

      {/* Today's snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <KpiCard value={stats.overdue} label="Overdue" color={stats.overdue > 0 ? 'text-red-400' : 'text-green-400'} large />
        <KpiCard value={stats.dueToday} label="Due Today" color={stats.dueToday > 0 ? 'text-amber-400' : 'text-neutral-100'} large />
        <KpiCard value={stats.completedToday} label="Done Today" color="text-green-400" large />
        <KpiCard value={stats.dueThisWeek} label="Due This Week" color={stats.dueThisWeek > 0 ? 'text-amber-300' : 'text-neutral-100'} large />
        <KpiCard value={stats.completedThisWeek} label="Done This Week" color="text-green-400" large />
      </div>

      {/* Urgency summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard value={stats.highPriorityOpen} label="High Priority Open" color={stats.highPriorityOpen > 0 ? 'text-red-400' : 'text-neutral-100'} />
        <KpiCard value={stats.slaBreach} label="SLA Breached" color={stats.slaBreach > 0 ? 'text-red-400' : 'text-neutral-100'} />
        <KpiCard value={stats.active - stats.overdue} label="On Track" color="text-green-400" />
        <KpiCard value={stats.active} label="Active Tasks" color="text-[#5ec1ca]" />
      </div>

      {/* By Status */}
      <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
        <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-3">
          Tasks by Status
        </h3>
        <div className="space-y-2">
          {Object.entries(stats.byStatus)
            .sort(([, a], [, b]) => b - a)
            .map(([status, count]) => {
              const colors: Record<string, string> = {
                open: 'bg-blue-500',
                in_progress: 'bg-[#5ec1ca]',
                done: 'bg-green-500',
                dismissed: 'bg-neutral-600',
                snoozed: 'bg-amber-500',
              };
              return (
                <ProgressBar
                  key={status}
                  label={status.replace('_', ' ')}
                  count={count}
                  total={stats.total}
                  color={colors[status] ?? 'bg-neutral-500'}
                />
              );
            })}
        </div>
      </div>

      {/* By Source */}
      <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
        <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-3">
          Tasks by Source
        </h3>
        <div className="space-y-2">
          {sources.map((source) => (
            <ProgressBar
              key={source}
              label={SOURCE_META[source]?.label ?? source}
              count={stats.bySource[source] ?? 0}
              total={stats.total}
              color={`bg-[${SOURCE_META[source]?.color ?? '#666'}]`}
            />
          ))}
        </div>
      </div>

      {/* Onboarding Milestones */}
      {stats.onboarding?.milestones && stats.onboarding.milestones.total > 0 && (() => {
        const ms = stats.onboarding!.milestones!;
        const pctComplete = ms.total > 0 ? Math.round((ms.complete / ms.total) * 100) : 0;
        return (
          <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
                Onboarding Milestones
              </h3>
              <span className="text-xs text-neutral-400">{pctComplete}% complete</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <KpiCard value={ms.overdue} label="Overdue" color={ms.overdue > 0 ? 'text-red-400' : 'text-green-400'} />
              <KpiCard value={ms.in_progress} label="In Progress" color="text-[#5ec1ca]" />
              <KpiCard value={ms.pending} label="Pending" color="text-amber-300" />
              <KpiCard value={ms.complete} label="Complete" color="text-green-400" />
            </div>
            {/* Progress bar */}
            <div className="h-3 bg-[#272C33] rounded-full overflow-hidden border border-[#3a424d] flex">
              {ms.complete > 0 && (
                <div className="h-full bg-green-500" style={{ width: `${(ms.complete / ms.total) * 100}%` }} />
              )}
              {ms.in_progress > 0 && (
                <div className="h-full bg-[#5ec1ca]" style={{ width: `${(ms.in_progress / ms.total) * 100}%` }} />
              )}
              {ms.overdue > 0 && (
                <div className="h-full bg-red-500" style={{ width: `${(ms.overdue / ms.total) * 100}%` }} />
              )}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-neutral-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Complete</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#5ec1ca] inline-block" /> In Progress</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Overdue</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300 inline-block" /> Pending</span>
            </div>
          </div>
        );
      })()}

      {/* Recent Onboarding Runs */}
      {stats.onboarding?.recentRuns && stats.onboarding.recentRuns.length > 0 && (
        <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
          <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-3">
            Recent Onboarding Runs
          </h3>
          <div className="space-y-1.5">
            {stats.onboarding.recentRuns.map((run) => (
              <div key={run.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    run.status === 'success' ? 'bg-green-400' :
                    run.status === 'error' ? 'bg-red-500' :
                    run.status === 'partial' ? 'bg-amber-400' : 'bg-neutral-500'
                  }`} />
                  <span className="text-neutral-200 font-mono">{run.ref}</span>
                  {run.parentKey && <span className="text-neutral-500">{run.parentKey}</span>}
                  {run.dryRun && <span className="text-amber-500 text-[10px]">(dry run)</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-neutral-400">{run.createdCount} tickets</span>
                  <span className="text-neutral-500">{timeAgo(run.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
