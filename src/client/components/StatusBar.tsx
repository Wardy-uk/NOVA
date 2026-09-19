import { useEffect, useState } from 'react';
import type { HealthResponse } from '../../shared/types.js';

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

interface SyncStatus {
  lastAutoSync: string | null;
  intervalMinutes: number;
}

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
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [odRes, syncRes] = await Promise.all([
          fetch('/api/onedrive/status'),
          fetch('/api/sync/status'),
        ]);
        const odJson = await odRes.json();
        if (odJson.ok && odJson.data) setOneDrive(odJson.data);
        const syncJson = await syncRes.json();
        if (syncJson.ok && syncJson.data) setSyncStatus(syncJson.data);
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
        {health?.servers ? (
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
      <div className="flex items-center gap-4">
        {syncStatus && (
          <span>
            Synced: {formatSince(syncStatus.lastAutoSync)} | Every {syncStatus.intervalMinutes}m
          </span>
        )}
        {health && (
          <span>
            Uptime: {Math.floor(health.uptime / 60)}m | {health.status} |{' '}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('nova-show-release-notes'))}
              className="hover:text-[#5ec1ca] transition-colors cursor-pointer"
              title="View release notes"
            >
              v{__APP_VERSION__} ({__GIT_HASH__})
            </button>
          </span>
        )}
        {/* A tab left open across a deploy keeps running the bundle it loaded with. The
            service worker updates underneath it, but the rendered UI does not change — so the
            page can be several releases behind while looking entirely normal. Twice on
            19 Sep 2026 that led to a missing nav tab and a version read three deploys stale,
            and both were mistaken for the deploy having failed. Say it plainly instead. */}
        {health?.version && health.version !== __APP_VERSION__ && (
          <button
            onClick={() => window.location.reload()}
            title={`This tab is running v${__APP_VERSION__}; the server is on v${health.version}. Click to reload.`}
            className="ml-2 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
          >
            v{health.version} available — reload
          </button>
        )}
      </div>
    </footer>
  );
}
