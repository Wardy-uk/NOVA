import type { HealthResponse } from '../../shared/types.js';

interface Props {
  health: HealthResponse | null;
}

const STATUS_DOTS: Record<string, string> = {
  connected: 'bg-green-400',
  connecting: 'bg-yellow-400 animate-pulse',
  disconnected: 'bg-neutral-600',
  unavailable: 'bg-red-500',
  error: 'bg-red-500',
};

export function StatusBar({ health }: Props) {
  return (
    <footer className="border-t border-[#3a424d] px-6 py-2 flex items-center justify-between text-xs text-neutral-500">
      <div className="flex items-center gap-4">
        {health ? (
          health.servers.map((server) => (
            <div
              key={server.name}
              className="flex items-center gap-1.5"
              title={server.lastError ?? `${server.toolCount} tools`}
            >
              <div
                className={`w-2 h-2 rounded-full ${STATUS_DOTS[server.status] ?? 'bg-neutral-600'}`}
              />
              <span className="capitalize">{server.name}</span>
              {server.status !== 'connected' && server.lastError && (
                <span className="text-red-500 max-w-[200px] truncate">
                  ({server.lastError})
                </span>
              )}
            </div>
          ))
        ) : (
          <span>Connecting...</span>
        )}
      </div>
      <div>
        {health && (
          <span>
            Uptime: {Math.floor(health.uptime / 60)}m | Status:{' '}
            {health.status}
          </span>
        )}
      </div>
    </footer>
  );
}
