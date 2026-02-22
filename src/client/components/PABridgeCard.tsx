import { useEffect, useState } from 'react';

interface SourceSync {
  source: string;
  label: string;
  lastSynced: string | null;
  count: number;
}

const M365_SOURCES = [
  { source: 'planner', label: 'Planner' },
  { source: 'todo', label: 'To-Do' },
  { source: 'calendar', label: 'Calendar' },
  { source: 'email', label: 'Email' },
];

export function PABridgeCard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [sources, setSources] = useState<SourceSync[]>([]);

  useEffect(() => {
    // Check ingest endpoint status
    fetch('/api/ingest/status')
      .then((r) => r.json())
      .then((d) => setReady(d.ok === true))
      .catch(() => setReady(false));

    // Get last-synced info per M365 source
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((d) => {
        const tasks = d.data ?? d;
        const result: SourceSync[] = M365_SOURCES.map(({ source, label }) => {
          const sourceTasks = tasks.filter(
            (t: { source: string }) => t.source === source
          );
          const lastSynced = sourceTasks.reduce(
            (latest: string | null, t: { last_synced: string | null }) => {
              if (!t.last_synced) return latest;
              if (!latest) return t.last_synced;
              return t.last_synced > latest ? t.last_synced : latest;
            },
            null
          );
          return { source, label, lastSynced, count: sourceTasks.length };
        });
        setSources(result);
      })
      .catch(() => {});
  }, []);

  const statusDot =
    ready === null
      ? 'bg-neutral-500'
      : ready
        ? 'bg-green-500'
        : 'bg-red-500';

  const statusText =
    ready === null ? 'Checking...' : ready ? 'Ready' : 'Unreachable';

  return (
    <div className="border border-[#3a424d] rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-neutral-100">
            Power Automate Desktop Bridge
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Push M365 tasks via PA Desktop flows to bypass admin consent
            requirements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-xs text-neutral-400">{statusText}</span>
        </div>
      </div>

      <div className="text-xs text-neutral-500 bg-[#2f353d] rounded px-3 py-2 font-mono">
        POST http://localhost:3001/api/ingest
      </div>

      {sources.some((s) => s.count > 0 || s.lastSynced) && (
        <div className="grid grid-cols-2 gap-2">
          {sources.map((s) => (
            <div
              key={s.source}
              className="flex items-center justify-between px-2 py-1 rounded bg-[#2f353d]"
            >
              <span className="text-xs text-neutral-300">{s.label}</span>
              <span className="text-[10px] text-neutral-500">
                {s.count > 0
                  ? `${s.count} tasks`
                  : 'No tasks'}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-neutral-600">
        See docs/power-automate-bridge.md for setup instructions.
      </p>
    </div>
  );
}
