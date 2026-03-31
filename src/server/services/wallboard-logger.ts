/**
 * In-memory ring-buffer logger for wallboard route diagnostics.
 * Stores the last N requests with timing, status, and error details.
 */

export interface WallboardLogEntry {
  id: number;
  timestamp: string;
  route: string;
  level: 'info' | 'warn' | 'error';
  durationMs: number;
  status: number;
  message: string;
  sqlServer?: string;
  error?: string;
  stack?: string;
}

const MAX_ENTRIES = 200;
let nextId = 1;
const entries: WallboardLogEntry[] = [];

export function logWallboard(
  route: string,
  level: 'info' | 'warn' | 'error',
  status: number,
  durationMs: number,
  message: string,
  opts?: { sqlServer?: string; error?: string; stack?: string },
): WallboardLogEntry {
  const entry: WallboardLogEntry = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    route,
    level,
    durationMs: Math.round(durationMs),
    status,
    message,
    ...opts,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  // Also log to console for server-side visibility
  const prefix = `[Wallboard ${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(prefix, route, `${durationMs}ms`, message, opts?.error ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, route, `${durationMs}ms`, message);
  }

  return entry;
}

export function getWallboardLogs(): WallboardLogEntry[] {
  return [...entries].reverse(); // newest first
}

export function clearWallboardLogs(): void {
  entries.length = 0;
}

/** Log a client-side error reported by the wallboard page itself */
export function logWallboardClient(
  route: string,
  errorStatus: number,
  message: string,
  consecutiveFailures: number,
  downSince?: string,
): WallboardLogEntry {
  return logWallboard(route, 'error', errorStatus, 0, message, {
    error: `Client-reported: ${consecutiveFailures} consecutive failures${downSince ? ` — down since ${downSince}` : ''}`,
  });
}
