/**
 * In-memory SSO event logger — ring buffer for debugging SSO flow.
 * Keeps the last MAX_ENTRIES events. Cleared on server restart.
 */

export interface SsoLogEntry {
  id: number;
  timestamp: string;
  event: string;      // e.g. 'login_start', 'callback', 'token_exchange', 'user_resolved', 'error'
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

const MAX_ENTRIES = 200;
let nextId = 1;
const entries: SsoLogEntry[] = [];

export const ssoLogger = {
  log(event: string, message: string, details?: Record<string, unknown>, level: SsoLogEntry['level'] = 'info') {
    const entry: SsoLogEntry = {
      id: nextId++,
      timestamp: new Date().toISOString(),
      event,
      level,
      message,
      details,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    // Also log to console for server-side visibility
    const prefix = `[SSO:${event}]`;
    if (level === 'error') {
      console.error(prefix, message, details ?? '');
    } else if (level === 'warn') {
      console.warn(prefix, message, details ?? '');
    } else {
      console.log(prefix, message, details ?? '');
    }
  },

  error(event: string, message: string, details?: Record<string, unknown>) {
    this.log(event, message, details, 'error');
  },

  warn(event: string, message: string, details?: Record<string, unknown>) {
    this.log(event, message, details, 'warn');
  },

  getAll(): SsoLogEntry[] {
    return [...entries].reverse(); // newest first
  },

  clear() {
    entries.length = 0;
  },

  count(): number {
    return entries.length;
  },
};
