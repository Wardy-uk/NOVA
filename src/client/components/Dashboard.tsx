import { useState, useEffect } from 'react';
import type { Task } from '../../shared/types.js';

interface Stats {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
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

interface Props {
  tasks: Task[];
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

export function Dashboard({ tasks }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/tasks/stats')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setStats(j.data); })
      .catch(() => {});
  }, [tasks.length]);

  const now = new Date();
  const thirtyMinutesMs = 30 * 60 * 1000;

  const parseDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === 'number') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const dt = obj.dateTime ?? obj.value ?? obj.startedTime ?? obj.displayValue;
      if (typeof dt === 'string') {
        const parsed = new Date(dt);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
    }
    return null;
  };

  const getJiraStatusName = (issue: Record<string, unknown>): string | null => {
    const direct = issue.status;
    if (typeof direct === 'string') return direct;
    if (direct && typeof direct === 'object') {
      const name = (direct as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
    const fields = issue.fields as Record<string, unknown> | undefined;
    const fieldStatus = fields?.status;
    if (typeof fieldStatus === 'string') return fieldStatus;
    if (fieldStatus && typeof fieldStatus === 'object') {
      const name = (fieldStatus as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
    return null;
  };

  const getJiraFieldValue = (
    issue: Record<string, unknown>,
    names: string[]
  ): unknown => {
    const lower = names.map((n) => n.toLowerCase());

    for (const [key, value] of Object.entries(issue)) {
      if (lower.includes(key.toLowerCase())) return value;
    }

    const fields = issue.fields as Record<string, unknown> | undefined;
    if (fields && typeof fields === 'object') {
      for (const [key, value] of Object.entries(fields)) {
        if (lower.includes(key.toLowerCase())) return value;
      }
    }

    const fieldsArray = issue.fields as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(fieldsArray)) {
      for (const field of fieldsArray) {
        const name = field.name ?? field.key ?? field.label;
        if (typeof name === 'string' && lower.includes(name.toLowerCase())) {
          return field.value ?? field.displayValue ?? field;
        }
      }
    }

    return undefined;
  };

  const findSlaObject = (issue: Record<string, unknown>): Record<string, unknown> | null => {
    const fields = issue.fields as Record<string, unknown> | undefined;
    if (!fields || typeof fields !== 'object') return null;

    const checkValue = (value: unknown): Record<string, unknown> | null => {
      if (!value || typeof value !== 'object') return null;
      const obj = value as Record<string, unknown>;
      if (
        obj.ongoingCycle &&
        typeof obj.ongoingCycle === 'object' &&
        ('breached' in (obj.ongoingCycle as Record<string, unknown>) ||
          'remainingTime' in (obj.ongoingCycle as Record<string, unknown>))
      ) {
        return obj;
      }
      if (
        obj.remainingTime &&
        typeof obj.remainingTime === 'object' &&
        'millis' in (obj.remainingTime as Record<string, unknown>)
      ) {
        return obj;
      }
      return null;
    };

    for (const value of Object.values(fields)) {
      const found = checkValue(value);
      if (found) return found;
      if (Array.isArray(value)) {
        for (const item of value) {
          const foundItem = checkValue(item);
          if (foundItem) return foundItem;
        }
      }
    }

    return null;
  };

  const getRemainingTimeMs = (issue: Record<string, unknown>): number | null => {
    const direct = getJiraFieldValue(issue, ['remainingTime', 'Remaining Time']);
    if (direct && typeof direct === 'object') {
      const millis = (direct as Record<string, unknown>).millis;
      if (typeof millis === 'number') return millis;
      if (typeof millis === 'string') {
        const parsed = parseInt(millis, 10);
        return isNaN(parsed) ? null : parsed;
      }
    }

    const sla = findSlaObject(issue);
    if (!sla) return null;
    const remaining = sla.remainingTime as Record<string, unknown> | undefined;
    const millis = remaining?.millis;
    if (typeof millis === 'number') return millis;
    if (typeof millis === 'string') {
      const parsed = parseInt(millis, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const isBreached = (issue: Record<string, unknown>): boolean => {
    const direct = getJiraFieldValue(issue, ['ongoingCycle', 'Ongoing Cycle']);
    if (direct && typeof direct === 'object') {
      const breached = (direct as Record<string, unknown>).breached;
      if (typeof breached === 'boolean') return breached;
    }

    const sla = findSlaObject(issue);
    if (sla?.ongoingCycle && typeof sla.ongoingCycle === 'object') {
      const breached = (sla.ongoingCycle as Record<string, unknown>).breached;
      if (typeof breached === 'boolean') return breached;
    }

    const remainingMs = getRemainingTimeMs(issue);
    return remainingMs !== null && remainingMs < 0;
  };

  const isBreachingNext = (issue: Record<string, unknown>): boolean => {
    const remainingMs = getRemainingTimeMs(issue);
    return remainingMs !== null && remainingMs >= 0 && remainingMs <= thirtyMinutesMs;
  };

  const isNeedingUpdate = (issue: Record<string, unknown>): boolean => {
    const status = (getJiraStatusName(issue) ?? '').toLowerCase();
    if (!status) return false;
    if (['resolved', 'closed'].includes(status)) return false;
    if (['waiting on requestor', 'waiting on partner'].includes(status)) return false;

    const queueValue = getJiraFieldValue(issue, ['queue', 'Queue']);
    const queueName = typeof queueValue === 'string'
      ? queueValue
      : (queueValue as Record<string, unknown> | undefined)?.name;
    if (typeof queueName === 'string' && queueName.toLowerCase() === 'development') {
      return false;
    }

    const requestTypeValue = getJiraFieldValue(issue, ['request type', 'Request Type', 'requestType']);
    const requestTypeName = typeof requestTypeValue === 'string'
      ? requestTypeValue
      : (requestTypeValue as Record<string, unknown> | undefined)?.name;
    if (typeof requestTypeName === 'string' && requestTypeName.toLowerCase() === 'onboarding') {
      return false;
    }

    const nextUpdateRaw = getJiraFieldValue(issue, ['agent next update', 'Agent Next Update']);
    const nextUpdate = parseDate(nextUpdateRaw);
    const lastCommentRaw = getJiraFieldValue(issue, ['last agent public comment', 'Last Agent Public Comment']);
    const lastComment = parseDate(lastCommentRaw);

    const needsUpdateByDue = nextUpdate ? nextUpdate.getTime() < now.getTime() : false;
    const needsUpdateBySilence = lastComment
      ? now.getTime() - lastComment.getTime() > 4 * 60 * 60 * 1000
      : false;

    return needsUpdateByDue || needsUpdateBySilence;
  };

  const jiraTasks = tasks.filter((t) => t.source === 'jira');
  const needingUpdates = jiraTasks.filter((t) => {
    const issue = t.raw_data;
    if (!issue || typeof issue !== 'object') return false;
    return isNeedingUpdate(issue as Record<string, unknown>);
  }).length;
  const breached = jiraTasks.filter((t) => {
    const issue = t.raw_data;
    if (!issue || typeof issue !== 'object') return false;
    return isBreached(issue as Record<string, unknown>);
  }).length;
  const breachingNext = jiraTasks.filter((t) => {
    const issue = t.raw_data;
    if (!issue || typeof issue !== 'object') return false;
    return isBreachingNext(issue as Record<string, unknown>);
  }).length;

  const total = tasks.length;

  // Count tasks per source
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.source] = (counts[t.source] ?? 0) + 1;
  }

  // Only show sources that have tasks or are known
  const sources = Object.keys(SOURCE_META).filter(
    (s) => (counts[s] ?? 0) > 0
  );

  if (sources.length === 0 && total === 0) return null;

  const KpiCard = ({ value, label, color = 'text-neutral-100' }: { value: number | string; label: string; color?: string }) => (
    <div className="border border-[#3a424d] rounded-lg px-4 py-3 bg-[#2f353d]">
      <div className={`text-2xl font-bold font-[var(--font-heading)] ${color}`}>
        {value}
      </div>
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );

  return (
    <div className="mb-6 space-y-3">
      {/* Row 1: Core KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
        <KpiCard value={total} label="Total Tasks" />
        <KpiCard value={stats?.active ?? total} label="Active" color="text-[#5ec1ca]" />
        <KpiCard value={stats?.overdue ?? 0} label="Overdue" color={stats?.overdue ? 'text-red-400' : 'text-neutral-100'} />
        <KpiCard value={stats?.dueToday ?? 0} label="Due Today" color={stats?.dueToday ? 'text-amber-400' : 'text-neutral-100'} />
        <KpiCard value={stats?.completedToday ?? 0} label="Done Today" color="text-green-400" />
        <KpiCard value={`${stats?.completionRate ?? 0}%`} label="Completion Rate" color="text-[#5ec1ca]" />
      </div>

      {/* Row 2: Jira SLA + deeper stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
        <KpiCard value={needingUpdates} label="Needing Updates" color={needingUpdates > 0 ? 'text-amber-400' : 'text-neutral-100'} />
        <KpiCard value={breached} label="SLA Breached" color={breached > 0 ? 'text-red-400' : 'text-neutral-100'} />
        <KpiCard value={breachingNext} label="Breaching Next" color={breachingNext > 0 ? 'text-orange-300' : 'text-neutral-100'} />
        <KpiCard value={stats?.highPriorityOpen ?? 0} label="High Priority" color={stats?.highPriorityOpen ? 'text-red-400' : 'text-neutral-100'} />
        <KpiCard value={stats?.dueThisWeek ?? 0} label="Due This Week" color={stats?.dueThisWeek ? 'text-amber-300' : 'text-neutral-100'} />
        <KpiCard value={`${stats?.avgAgeDays ?? 0}d`} label="Avg Age" />
      </div>

      {/* Row 3: Per-source cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {sources.map((source) => {
          const meta = SOURCE_META[source];
          const count = counts[source] ?? 0;
          return (
            <div
              key={source}
              className="border border-[#3a424d] rounded-lg px-4 py-3 bg-[#2f353d]"
            >
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold font-[var(--font-heading)] text-neutral-100">
                  {count}
                </div>
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
              </div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
                {meta.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
