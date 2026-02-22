import { useEffect, useState } from 'react';
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
  const [oneDrive, setOneDrive] = useState<{
    watchDir: string;
    lastScanAt: string | null;
    lastIngestAt: string | null;
    lastIngestFile: string | null;
    lastIngestSource: string | null;
    lastError: string | null;
  } | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/onedrive/status');
        const json = await res.json();
        if (json.ok && json.data) {
          setOneDrive(json.data);
        }
      } catch {
        /* ignore */
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatSince = (iso: string | null) => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff)) return 'unknown';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  };

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
        {oneDrive && (
          <div
            className="flex items-center gap-1.5"
            title={oneDrive.watchDir}
          >
            <div className={`w-2 h-2 rounded-full ${oneDrive.lastError ? 'bg-red-500' : 'bg-green-400'}`} />
            <span>onedrive</span>
            <span className="text-neutral-400">
              last: {formatSince(oneDrive.lastIngestAt)}
              {oneDrive.lastIngestFile ? ` (${oneDrive.lastIngestFile})` : ''}
            </span>
            {oneDrive.lastError && (
              <span className="text-red-500 max-w-[200px] truncate">
                ({oneDrive.lastError})
              </span>
            )}
          </div>
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
