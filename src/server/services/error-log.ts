import { query, execute } from './database.js';

export type ErrorSeverity = 'error' | 'critical';

export interface LogErrorOptions {
  /** 'critical' = business-critical failure that should surface proactively. */
  severity?: ErrorSeverity;
  /** Arbitrary structured context (serialised to JSON). */
  context?: Record<string, unknown>;
  /** A related entity, e.g. a Jira ticket key, org id, onboarding ref. */
  entityRef?: string;
}

export interface ErrorLogRow {
  id: number;
  occurred_at: string;
  source: string;
  severity: ErrorSeverity;
  message: string;
  stack: string | null;
  context: string | null;
  entity_ref: string | null;
  resolved: boolean;
}

const trunc = (s: string | null | undefined, n: number): string | null =>
  s == null ? null : (s.length > n ? s.slice(0, n) : s);

/** Record an error centrally. Never throws — logging must not break the caller.
 *  `source` is the subsystem (e.g. 'llm', 'jira-sync', 'agent', 'kpi-pipeline',
 *  'portal-intake'). Also mirrors to console so existing log tails still work. */
export async function logError(source: string, err: unknown, opts: LogErrorOptions = {}): Promise<void> {
  const severity = opts.severity ?? 'error';
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? null : null;

  // Always mirror to console (keeps stdout/stderr diagnostics intact).
  const tag = severity === 'critical' ? '[error-log:CRITICAL]' : '[error-log]';
  console.error(`${tag} ${source}: ${message}${opts.entityRef ? ` (${opts.entityRef})` : ''}`);

  try {
    await execute(
      `INSERT INTO error_log (source, severity, message, stack, context, entity_ref)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        trunc(source, 100),
        severity,
        trunc(message, 4000) ?? '(no message)',
        trunc(stack, 8000),
        opts.context ? trunc(JSON.stringify(opts.context), 8000) : null,
        trunc(opts.entityRef, 200),
      ],
    );
  } catch (e) {
    // Swallow — a logging failure (e.g. DB down) must not cascade.
    console.error('[error-log] failed to persist error:', e instanceof Error ? e.message : e);
  }
}

/** Fire-and-forget variant for sync contexts (global handlers, etc.). */
export function captureError(source: string, err: unknown, opts: LogErrorOptions = {}): void {
  void logError(source, err, opts);
}

export interface RecentErrorsFilter {
  source?: string;
  severity?: ErrorSeverity;
  resolved?: boolean;
  sinceHours?: number;
  limit?: number;
}

/** Recent errors for the admin view and the MCP query tool. */
export async function getRecentErrors(filter: RecentErrorsFilter = {}): Promise<ErrorLogRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.source) { where.push('source = ?'); params.push(filter.source); }
  if (filter.severity) { where.push('severity = ?'); params.push(filter.severity); }
  if (typeof filter.resolved === 'boolean') { where.push('resolved = ?'); params.push(filter.resolved ? 1 : 0); }
  if (filter.sinceHours && filter.sinceHours > 0) {
    where.push('occurred_at >= DATEADD(HOUR, ?, GETUTCDATE())');
    params.push(-Math.floor(filter.sinceHours));
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query<ErrorLogRow>(
    `SELECT TOP (${limit}) id, occurred_at, source, severity, message, stack, context, entity_ref, resolved
     FROM error_log ${clause} ORDER BY occurred_at DESC`,
    params,
  );
  return rows;
}

/** Counts by source+severity over a window — quick health snapshot. */
export async function getErrorSummary(sinceHours = 24): Promise<Array<{ source: string; severity: string; count: number }>> {
  return query(
    `SELECT source, severity, COUNT(*) AS count
     FROM error_log
     WHERE occurred_at >= DATEADD(HOUR, ?, GETUTCDATE())
     GROUP BY source, severity
     ORDER BY count DESC`,
    [-Math.floor(sinceHours)],
  );
}

export async function resolveError(id: number): Promise<void> {
  await execute(`UPDATE error_log SET resolved = 1, resolved_at = GETUTCDATE() WHERE id = ?`, [id]);
}
