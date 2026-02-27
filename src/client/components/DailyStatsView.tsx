import { useState, useEffect } from 'react';
import type { Task } from '../../shared/types.js';

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

  const copyDebug = () => {
    const debug = {
      _debug: 'DailyStatsView',
      tasksFromProp: tasks.length,
      taskSourcesFromProp: tasks.reduce((acc, t) => { acc[t.source] = (acc[t.source] ?? 0) + 1; return acc; }, {} as Record<string, number>),
      focusCount,
      statsFromApi: stats,
    };
    navigator.clipboard.writeText(JSON.stringify(debug, null, 2));
    alert('Dashboard debug copied to clipboard');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">Command Centre</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">{today}</p>
        </div>
        <button onClick={copyDebug} className="text-[10px] text-neutral-600 hover:text-neutral-400 border border-[#3a424d] rounded px-2 py-1" title="Copy dashboard debug data">
          Debug
        </button>
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
    </div>
  );
}
