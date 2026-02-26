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

function rateColor(rate: number): string {
  if (rate >= 80) return 'text-green-400';
  if (rate >= 50) return 'text-amber-400';
  return 'text-red-400';
}

export function KpisView({ tasks, embedded }: { tasks: Task[]; embedded?: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tasks/stats')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setStats(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tasks.length]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-neutral-500">Loading KPIs...</div>;
  }
  if (!stats) {
    return <div className="flex items-center justify-center py-20 text-neutral-500">Could not load KPIs</div>;
  }

  const sources = Object.keys(SOURCE_META).filter((s) => (stats.bySource[s] ?? 0) > 0);
  const done = stats.byStatus['done'] ?? 0;
  const dismissed = stats.byStatus['dismissed'] ?? 0;
  const onTrack = stats.active - stats.overdue;

  return (
    <div className="space-y-6">
      {!embedded && <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">KPIs</h2>}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#2f353d] col-span-1">
          <div className="text-4xl font-bold font-[var(--font-heading)] text-[#5ec1ca]">{stats.total}</div>
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-1">Total Tasks</div>
        </div>
        <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#2f353d]">
          <div className={`text-4xl font-bold font-[var(--font-heading)] ${rateColor(stats.completionRate)}`}>
            {stats.completionRate}%
          </div>
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-1">Completion Rate</div>
        </div>
        <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#2f353d]">
          <div className="text-4xl font-bold font-[var(--font-heading)] text-neutral-100">{stats.avgAgeDays}d</div>
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-1">Avg Task Age</div>
        </div>
        <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#2f353d]">
          <div className={`text-4xl font-bold font-[var(--font-heading)] ${stats.overdue > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {stats.overdue}
          </div>
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-1">Overdue</div>
        </div>
      </div>

      {/* Status donut-style breakdown */}
      <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
        <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-4">
          Task Pipeline
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: 'Active', value: stats.active, color: 'text-[#5ec1ca]', bg: 'bg-[#5ec1ca]' },
            { label: 'On Track', value: onTrack, color: 'text-green-400', bg: 'bg-green-500' },
            { label: 'Overdue', value: stats.overdue, color: 'text-red-400', bg: 'bg-red-500' },
            { label: 'Completed', value: done, color: 'text-green-400', bg: 'bg-green-600' },
            { label: 'Dismissed', value: dismissed, color: 'text-neutral-500', bg: 'bg-neutral-600' },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <div className={`text-2xl font-bold font-[var(--font-heading)] ${item.color}`}>{item.value}</div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mt-0.5">{item.label}</div>
              <div className="mt-2 h-1.5 rounded-full bg-[#272C33] overflow-hidden">
                <div
                  className={`h-full rounded-full ${item.bg}`}
                  style={{ width: `${stats.total > 0 ? Math.max((item.value / stats.total) * 100, item.value > 0 ? 3 : 0) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-source cards */}
      <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
        <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-4">
          By Source
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {sources.map((source) => {
            const meta = SOURCE_META[source];
            const count = stats.bySource[source] ?? 0;
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            return (
              <div
                key={source}
                className="border border-[#3a424d] rounded-lg px-4 py-3 bg-[#272C33]"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-2xl font-bold font-[var(--font-heading)] text-neutral-100">
                    {count}
                  </div>
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                </div>
                <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                  {meta.label}
                </div>
                <div className="text-[10px] text-neutral-600 mt-0.5">{pct}% of total</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Health indicators */}
      <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
        <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-4">
          Health Indicators
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              label: 'SLA Compliance',
              value: stats.active > 0 ? Math.round(((stats.active - stats.slaBreach) / stats.active) * 100) : 100,
              suffix: '%',
              good: stats.slaBreach === 0,
              desc: stats.slaBreach > 0 ? `${stats.slaBreach} breached` : 'All within SLA',
            },
            {
              label: 'Priority Health',
              value: stats.highPriorityOpen,
              suffix: '',
              good: stats.highPriorityOpen <= 3,
              desc: stats.highPriorityOpen <= 3 ? 'Manageable' : 'Needs attention',
            },
            {
              label: 'Throughput',
              value: stats.completedThisWeek,
              suffix: '/wk',
              good: stats.completedThisWeek >= stats.dueThisWeek,
              desc: stats.completedThisWeek >= stats.dueThisWeek ? 'Keeping pace' : 'Falling behind',
            },
          ].map((h) => (
            <div key={h.label} className="flex items-start gap-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 ${h.good ? 'bg-green-400' : 'bg-red-400'}`} />
              <div>
                <div className="text-sm text-neutral-200 font-medium">
                  {h.value}{h.suffix}
                  <span className="text-[10px] text-neutral-500 ml-2 uppercase">{h.label}</span>
                </div>
                <div className={`text-[10px] ${h.good ? 'text-green-500' : 'text-red-400'}`}>{h.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
