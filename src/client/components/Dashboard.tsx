import type { Task } from '../../shared/types.js';

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
};

export function Dashboard({ tasks }: Props) {
  // Count tasks per source
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.source] = (counts[t.source] ?? 0) + 1;
  }

  // Only show sources that have tasks or are known
  const sources = Object.keys(SOURCE_META).filter(
    (s) => (counts[s] ?? 0) > 0
  );

  if (sources.length === 0) return null;

  const total = tasks.length;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {/* Total card */}
        <div className="border border-[#3a424d] rounded-lg px-4 py-3 bg-[#2f353d]">
          <div className="text-2xl font-bold font-[var(--font-heading)] text-neutral-100">
            {total}
          </div>
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
            Total Tasks
          </div>
        </div>

        {/* Per-source cards */}
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
