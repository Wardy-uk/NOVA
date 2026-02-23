import { useEffect, useState, useCallback } from 'react';

interface SourceSync {
  source: string;
  label: string;
  lastSynced: string | null;
  count: number;
  enabled: boolean;
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
  const [bridgeEnabled, setBridgeEnabled] = useState(true);

  const loadData = useCallback(() => {
    fetch('/api/ingest/status')
      .then((r) => r.json())
      .then((d) => setReady(d.ok === true))
      .catch(() => setReady(false));

    Promise.all([
      fetch('/api/tasks').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ])
      .then(([tasksRes, settingsRes]) => {
        const tasks = tasksRes.data ?? tasksRes;
        const settings: Record<string, string> = settingsRes.data ?? settingsRes;
        setBridgeEnabled(settings['pa_bridge_enabled'] !== 'false');
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
          // Default to enabled if no setting exists
          const enabled = settings[`sync_${source}_enabled`] !== 'false';
          return { source, label, lastSynced, count: sourceTasks.length, enabled };
        });
        setSources(result);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleBridge = async (enabled: boolean) => {
    setBridgeEnabled(enabled);
    try {
      await fetch('/api/settings/pa_bridge_enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: enabled ? 'true' : 'false' }),
      });
    } catch {
      setBridgeEnabled(!enabled);
    }
  };

  const toggleSource = async (source: string, enabled: boolean) => {
    // Optimistic update
    setSources((prev) =>
      prev.map((s) => (s.source === source ? { ...s, enabled } : s))
    );
    try {
      await fetch(`/api/settings/sync_${source}_enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: enabled ? 'true' : 'false' }),
      });
    } catch {
      // Revert on failure
      setSources((prev) =>
        prev.map((s) => (s.source === source ? { ...s, enabled: !enabled } : s))
      );
    }
  };

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
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${bridgeEnabled ? statusDot : 'bg-neutral-600'}`} />
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">
              Power Automate Bridge
            </h3>
            <span className="text-xs text-neutral-500">{bridgeEnabled ? statusText : 'Disabled'}</span>
          </div>
        </div>
        <button
          onClick={() => toggleBridge(!bridgeEnabled)}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
            bridgeEnabled ? 'bg-[#5ec1ca]' : 'bg-neutral-700'
          }`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
            bridgeEnabled ? 'left-[18px]' : 'left-0.5'
          }`} />
        </button>
      </div>

      <p className="text-xs text-neutral-500 mt-0.5">
        Push M365 tasks via PA flows to bypass admin consent requirements.
      </p>

      {bridgeEnabled && (
      <div className="text-xs text-neutral-500 bg-[#2f353d] rounded px-3 py-2 font-mono">
        POST http://localhost:3001/api/ingest
      </div>
      )}

      {bridgeEnabled && sources.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
            PA Sync Sources
          </div>
          {sources.map((s) => (
            <div
              key={s.source}
              className="flex items-center justify-between px-3 py-2 rounded bg-[#2f353d]"
            >
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => toggleSource(s.source, !s.enabled)}
                  className={`relative w-8 h-[18px] rounded-full transition-colors ${
                    s.enabled ? 'bg-[#5ec1ca]' : 'bg-[#3a424d]'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                      s.enabled ? 'left-[16px]' : 'left-[2px]'
                    }`}
                  />
                </button>
                <span className={`text-xs ${s.enabled ? 'text-neutral-200' : 'text-neutral-500'}`}>
                  {s.label}
                </span>
              </div>
              <span className="text-[10px] text-neutral-500">
                {s.count > 0 ? `${s.count} tasks` : 'No tasks'}
              </span>
            </div>
          ))}
        </div>
      )}

      {bridgeEnabled && (
      <p className="text-[10px] text-neutral-600">
        See docs/power-automate-bridge.md for setup instructions.
      </p>
      )}
    </div>
  );
}
