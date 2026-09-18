import { query, queryOne, getPoolStats } from './database.js';
import type { JobRegistry, RegisteredJob } from './job-registry.js';

/**
 * Self-reporting for NOVA's own machinery — does the platform still do the
 * things it believes it is doing?
 *
 * On 14 Sep 2026 a NOVA fault stopped AI first responses. FRT breaches went from
 * about five a day to forty-five. Nothing in NOVA said a word. That is the
 * failure this service exists to make impossible, and it is a pattern rather
 * than one bug: a writer stops, or never starts, and the absence is silent.
 * Every dashboard in the estate is built to show what happened, so a thing that
 * stops happening renders as a healthy-looking zero.
 *
 * Three layers, because the same silence shows up at three depths:
 *
 * 1. **Tables** — did the rows arrive, and recently enough to matter.
 * 2. **Jobs** — did the scheduled work run. A job that fires every fifteen
 *    minutes and writes nothing for three months is the exact shape of the
 *    incident above, and it looks perfectly healthy in the jobs admin because it
 *    never throws.
 * 3. **Columns** — a column holding one value across every row is nearly always
 *    a broken mapping. `agent_queue_snapshots.sla_at_risk` is 0 on all 3,956
 *    rows while every other column on that table is live and correct.
 *
 * Two rules it is built around, both learned expensively:
 *
 * **Absent is never zero.** A count of nothing and a query that did not run must
 * never render the same. Each check carries its own `ok`, and a failure degrades
 * one row rather than the response — same contract as `flow-signals.ts` and
 * NEURO's weekly-risk sources.
 *
 * **A checker that finds nothing wrong and a checker that is not running look
 * identical.** So the table list carries deliberate positive controls: tables
 * known to be busy, asserted alongside the suspects. If `jira_issue_cache` also
 * reports empty, the fault is in here, not out there.
 *
 * Tuned for hours, not minutes. VANTAGE polls this every 30–60 minutes and Nick
 * opens the screen daily, so a "failing for the last 15 minutes" state would be
 * precision nobody can act on. If a genuinely fast path is ever wanted, the
 * existing Teams webhook is the right carrier, not this.
 *
 * Strictly SELECT. Nothing in this service writes.
 */

/**
 * Stamped into every response so a caller can tell WHICH build answered. A
 * deploy that serves a stale `dist` returns plausible output with new fields
 * silently `undefined`, and a missing field is indistinguishable from a field
 * that is legitimately empty. A version is not.
 *
 * Bump on any change to the shape of the response.
 */
export const HEALTH_SIGNALS_BUILD = '2026-09-18-d';

/**
 * `unknown` is load-bearing. It means the check could not be evaluated, which is
 * a different statement from "evaluated, found nothing wrong" — and the whole
 * point of this service is that those two must never collapse into each other.
 */
export type Severity = 'ok' | 'warn' | 'fail' | 'unknown';

/** Worst of a set, for rolling a section or the whole report up to one word. */
export function worst(severities: Severity[]): Severity {
  if (severities.includes('fail')) return 'fail';
  if (severities.includes('unknown')) return 'unknown';
  if (severities.includes('warn')) return 'warn';
  return 'ok';
}

export interface Signal<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

/** Run one check so its failure degrades a row rather than the whole report. */
async function signal<T>(fn: () => Promise<T>): Promise<Signal<T>> {
  try {
    return { ok: true, error: null, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Query failed', data: null };
  }
}

// ── Table expectations ──────────────────────────────────────────────────────

/**
 * How often a table is supposed to gain rows.
 *
 * `ever` is for tables with no regular cadence — they gain rows when something
 * real happens, so an empty one is a question rather than a finding, and a quiet
 * fortnight proves nothing.
 */
export type Cadence = 'hourly' | 'daily' | 'weekly' | 'ever';

/** Hours of silence before a cadence is a worry, and before it is a fault. */
const CADENCE_THRESHOLDS: Record<Exclude<Cadence, 'ever'>, { warn: number; fail: number }> = {
  hourly: { warn: 3, fail: 12 },
  daily: { warn: 36, fail: 72 },
  weekly: { warn: 10 * 24, fail: 21 * 24 },
};

export interface TableExpectation {
  table: string;
  cadence: Cadence;
  /** What a human should understand is broken if this one goes red. */
  why: string;
  /**
   * A table asserted precisely because it is known-busy. If a control reports
   * empty or stale, distrust the entire report — the fault is in the checker or
   * its connection, not in the thing being checked.
   */
  control?: boolean;
  /**
   * Set where a table has never held a row and we do not yet know whether that
   * is a fault or a deliberately retired feature nobody deleted. It caps the
   * severity at `warn`, so an open question cannot masquerade as a confirmed
   * outage — see the approval-queue note below for why this earns its keep.
   */
  unverified?: boolean;
}

/**
 * The watch list.
 *
 * Provenance: measured against production on 17–18 Sep 2026 by the VANTAGE
 * session, read-only, while establishing why this service was needed.
 *
 * A caution that shaped the `unverified` flag. The AI approval pipeline looks
 * dead — 0 approvals since June — and is not: commit e51a2cd (15 May 2026)
 * deliberately replaced the approval-queue-first model with the conversational
 * first-reply pipeline, retaining the queue only as the close/resolve gate. That
 * one nearly shipped as a high-severity alert on the screen Nick checks daily.
 * An empty table is evidence of absence, not evidence of a fault, and this list
 * must not turn four-month-old design decisions into red lights.
 *
 * So: anything whose intent is not established is `unverified` until somebody
 * confirms it. The never-written entries below are all questions for Nick, not
 * findings. `agent_incidents` is the one worth pushing on — its scan runs every
 * 15 minutes, its query returns ~48 tickets per 4h against a cluster threshold
 * of 5, and the LLM confirmation gate has never once returned true. That is
 * either a threshold nobody calibrated or a prompt that cannot say yes.
 */
export const TABLE_EXPECTATIONS: TableExpectation[] = [
  // ── Positive controls: known-busy, asserted to prove the checker works ──
  { table: 'jira_issue_cache', cadence: 'hourly', control: true, why: 'Jira sync — if this is stale nothing downstream of it can be trusted' },
  { table: 'agent_decisions', cadence: 'daily', control: true, why: 'The AI agent records every decision here; silence means the loop stopped' },
  { table: 'escalation_log', cadence: 'daily', control: true, why: 'Escalation capture — feeds the flow signals and the escalation report' },

  // ── Stopped: had a working state, then regressed. The strongest evidence. ──
  { table: 'agent_flagged_tickets', cadence: 'daily', why: 'Risk scorer output — 739 rows then nothing after 25 Aug 2026' },
  { table: 'agent_capacity_forecasts', cadence: 'weekly', why: 'Monday capacity forecast — 141 rows, last 14 Sep 2026' },
  { table: 'agent_queue_snapshots', cadence: 'hourly', why: 'Queue depth over time; the trend views read this' },

  // ── Never written. Cause unestablished — warn only, until someone says. ──
  { table: 'agent_incidents', cadence: 'ever', unverified: true, why: 'Incident clustering: the scan runs every 15 min and its LLM confirmation gate has never once returned true' },
  { table: 'ticket_trend_snapshots', cadence: 'ever', unverified: true, why: 'Trend snapshots — no row has ever been written' },
  { table: 'agent_escalation_predictions', cadence: 'ever', unverified: true, why: 'Escalation prediction — no row has ever been written' },
  { table: 'agent_sla_interventions', cadence: 'ever', unverified: true, why: 'Proactive SLA intervention log — no row has ever been written' },
  { table: 'portal_escalations', cadence: 'ever', unverified: true, why: 'Customer portal escalations — no row has ever been written' },
];

/**
 * Timestamp columns differ across the estate — `created_at`, `detected_at`,
 * `generated_at`, `snapshot_at`. Resolving from the catalogue rather than a
 * hand-kept map means a renamed column degrades to "no timestamp column" here
 * instead of a check that silently stops covering its table.
 *
 * Order matters: most-specific creation stamps first, `updated_at` last,
 * because an update stamp answers a subtly different question.
 */
const TIMESTAMP_PREFERENCE = [
  'created_at', 'detected_at', 'generated_at', 'snapshot_at', 'captured_at',
  'recorded_at', 'logged_at', 'occurred_at', 'run_at', 'inserted_at',
  // `synced_at` and `flagged_at` were missing from the first version, which blinded
  // the two most important rows on the page: jira_issue_cache — the control that
  // asserts the Jira sync is alive — and agent_flagged_tickets, the clearest
  // stopped-writer we have. Both reported "no timestamp column" while holding
  // eleven datetime columns between them. A discovery list that silently omits a
  // table's actual stamp produces exactly the false all-clear this service exists
  // to prevent, so it is worth being generous here.
  'synced_at', 'flagged_at', 'updated_at',
];

async function resolveTimestampColumn(table: string): Promise<string | null> {
  const cols = await query<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = ? AND DATA_TYPE IN ('datetime', 'datetime2', 'datetimeoffset', 'date', 'smalldatetime')`,
    [table],
  );
  const available = new Set(cols.map(c => c.COLUMN_NAME.toLowerCase()));
  for (const preferred of TIMESTAMP_PREFERENCE) {
    if (available.has(preferred)) return preferred;
  }
  return null;
}

export interface TableHealth {
  table: string;
  cadence: Cadence;
  why: string;
  control: boolean;
  severity: Severity;
  exists: boolean;
  rowCount: number | null;
  lastRowAt: string | null;
  hoursSinceLastRow: number | null;
  /** Which column the recency was measured on, so the number can be argued with. */
  timestampColumn: string | null;
  /**
   * True when the table has never held a row. Kept separate from staleness
   * because the two want different responses: never-written is a feature that
   * may never have been switched on, stopped-writing is a regression.
   */
  neverWritten: boolean;
  /** True where the severity was capped because the intent is not established. */
  unverified: boolean;
  /** One sentence a human can act on without reading the code. */
  verdict: string;
}

async function checkTable(exp: TableExpectation): Promise<TableHealth> {
  const base = {
    table: exp.table, cadence: exp.cadence, why: exp.why,
    control: exp.control ?? false, unverified: exp.unverified ?? false,
  };

  const exists = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sys.objects WHERE object_id = OBJECT_ID(?) AND type = 'U'`,
    [exp.table],
  );
  if (!exists?.n) {
    return {
      ...base, severity: 'fail', exists: false, rowCount: null, lastRowAt: null,
      hoursSinceLastRow: null, timestampColumn: null, neverWritten: false,
      verdict: `Table ${exp.table} does not exist`,
    };
  }

  const tsCol = await resolveTimestampColumn(exp.table);

  // The table name is interpolated because it cannot be parameterised in SQL
  // Server; it is safe because it comes from TABLE_EXPECTATIONS above — a
  // compile-time constant list — and never from a request. The catalogue check
  // immediately above is the second lock: an unknown name cannot reach here.
  const counts = await queryOne<{ n: number; last_at: Date | null }>(
    `SELECT COUNT(*) AS n, ${tsCol ? `MAX([${tsCol}])` : 'NULL'} AS last_at FROM [${exp.table}]`,
  );

  const rowCount = counts?.n ?? 0;
  const lastRow = counts?.last_at ? new Date(counts.last_at) : null;
  const hoursSince = lastRow ? Math.round(((Date.now() - lastRow.getTime()) / 3_600_000) * 10) / 10 : null;
  const neverWritten = rowCount === 0;

  let severity: Severity;
  let verdict: string;

  if (neverWritten) {
    severity = 'fail';
    verdict = `${exp.table} has never been written to`;
  } else if (!tsCol) {
    // Rows exist but recency is unmeasurable. Not a pass — say so plainly rather
    // than reporting a green that rests on nothing.
    severity = 'unknown';
    verdict = `${rowCount.toLocaleString()} rows, but no timestamp column to measure recency on`;
  } else if (exp.cadence === 'ever') {
    severity = 'ok';
    verdict = `${rowCount.toLocaleString()} rows, last ${hoursSince}h ago (no fixed cadence)`;
  } else {
    const t = CADENCE_THRESHOLDS[exp.cadence];
    const h = hoursSince ?? Infinity;
    severity = h >= t.fail ? 'fail' : h >= t.warn ? 'warn' : 'ok';
    verdict = severity === 'ok'
      ? `${rowCount.toLocaleString()} rows, last ${h}h ago`
      : `Stopped: ${rowCount.toLocaleString()} rows but nothing for ${h}h (expected ${exp.cadence})`;
  }

  // An open question must not present as a confirmed outage. Capping here rather
  // than at the call site keeps the rule in one place.
  if (exp.unverified && severity === 'fail') {
    severity = 'warn';
    verdict += ' — cause not established, may be deliberate';
  }

  return {
    ...base, severity, exists: true, rowCount, timestampColumn: tsCol, neverWritten,
    lastRowAt: lastRow ? lastRow.toISOString() : null, hoursSinceLastRow: hoursSince, verdict,
  };
}

// ── Column checks ───────────────────────────────────────────────────────────

export interface ColumnExpectation {
  table: string;
  column: string;
  why: string;
}

/**
 * Columns that should vary and are suspected not to.
 *
 * `jira_issue_cache.sla_breached` is a known-wrong mapping — the wrong custom
 * field, documented in `flow-signals.ts` — and is listed anyway. A known fault
 * that nobody has fixed should stay visible; dropping it from the watch list is
 * how it becomes invisible again.
 *
 * Keep this list short and specific. A generic sweep for constant columns across
 * the schema would be mostly congratulations — plenty of columns are legitimately
 * one value, and a detector that fires on the desired state gets muted.
 */
export const COLUMN_EXPECTATIONS: ColumnExpectation[] = [
  { table: 'agent_queue_snapshots', column: 'sla_at_risk', why: 'Zero on every row while its neighbours are live — a broken mapping, not a quiet queue' },
  { table: 'jira_issue_cache', column: 'sla_breached', why: 'Known wrong customfield; left on the list so it stays visible until fixed' },
];

/** Below this, one distinct value is unremarkable rather than evidence. */
const CONSTANT_COLUMN_MIN_ROWS = 100;

export interface ColumnHealth {
  table: string;
  column: string;
  why: string;
  severity: Severity;
  rowCount: number;
  distinctValues: number;
  /** The single value, when there is only one — usually names the bug outright. */
  constantValue: string | null;
  verdict: string;
}

async function checkColumn(exp: ColumnExpectation): Promise<ColumnHealth> {
  const base = { table: exp.table, column: exp.column, why: exp.why };

  const col = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [exp.table, exp.column],
  );
  if (!col?.n) {
    return { ...base, severity: 'fail', rowCount: 0, distinctValues: 0, constantValue: null,
      verdict: `${exp.table}.${exp.column} does not exist` };
  }

  // Identifiers interpolated for the same reason, and under the same two locks,
  // as checkTable: a constant list above, and a catalogue check immediately
  // before. NULL counts as a distinct value here — a column that is always NULL
  // is exactly as broken as one that is always 0.
  // Cast to text FIRST, in a derived table, then aggregate. The obvious version
  // aggregates the raw column and fails on the commonest case this check is for:
  // MIN() rejects `bit` outright ("Operand data type bit is invalid for min
  // operator"), and a constant flag column is very often a bit. Casting first
  // makes every type answer the same question — the ordering that MIN gives over
  // text is meaningless here, because the value is only ever read when there is
  // exactly one distinct value to report.
  //
  // NVARCHAR(100) truncates, so two long values sharing a prefix could read as
  // one. Acceptable while this list is a curated pair of flag columns; revisit
  // before pointing it at free text.
  const stats = await queryOne<{ total: number; distinct_vals: number; sample: string | null }>(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT v) + MAX(CASE WHEN v IS NULL THEN 1 ELSE 0 END) AS distinct_vals,
            MIN(v) AS sample
       FROM (SELECT CAST([${exp.column}] AS NVARCHAR(100)) AS v FROM [${exp.table}]) t`,
  );

  const total = stats?.total ?? 0;
  const distinct = stats?.distinct_vals ?? 0;

  if (total < CONSTANT_COLUMN_MIN_ROWS) {
    return { ...base, severity: 'unknown', rowCount: total, distinctValues: distinct, constantValue: null,
      verdict: `Only ${total} rows — too few to tell a constant from a coincidence` };
  }
  if (distinct <= 1) {
    return { ...base, severity: 'fail', rowCount: total, distinctValues: distinct,
      constantValue: stats?.sample ?? null,
      verdict: `Constant: ${stats?.sample ?? 'NULL'} on all ${total.toLocaleString()} rows` };
  }
  return { ...base, severity: 'ok', rowCount: total, distinctValues: distinct, constantValue: null,
    verdict: `${distinct.toLocaleString()} distinct values across ${total.toLocaleString()} rows` };
}

// ── Job checks ──────────────────────────────────────────────────────────────

export interface JobHealth {
  id: string;
  name: string;
  severity: Severity;
  enabled: boolean;
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
  verdict: string;
}

export interface JobsHealth {
  /**
   * Seconds since the server started. The registry holds `lastRun` in memory
   * ONLY, so every job reads as never-run after a restart. Without the uptime
   * next to it, a fresh boot is indistinguishable from a scheduler that died —
   * which is precisely the confusion this service exists to prevent.
   *
   * This is the weakest of the three layers for that reason, and the known next
   * piece of work is to persist a run record per job — `pipeline_runs` in the
   * KPI database is the right shape, including `rows_affected`, but NOVA's copy
   * belongs in NOVA's own database rather than the DTU-limited KPI one.
   */
  uptimeSeconds: number;
  /**
   * True while the process has not been up long enough for the checks below to
   * mean anything. Consumers must not alert on a report carrying this.
   */
  warmingUp: boolean;
  /** Stated on the response so a consumer cannot mistake this for durable history. */
  inMemoryOnly: true;
  jobs: JobHealth[];
}

/**
 * A job gets the benefit of the doubt until the process has been up for twice
 * its interval — one missed tick is a slow start, two is a pattern.
 */
function jobHealth(job: RegisteredJob, uptimeMs: number): JobHealth {
  const base = {
    id: job.id, name: job.name, enabled: job.enabled, intervalMs: job.intervalMs,
    lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
    lastError: job.lastError, runCount: job.runCount, errorCount: job.errorCount,
  };

  // Interval 0 means the job is driven by something other than the registry
  // timer; there is no cadence to hold it to.
  const grace = job.intervalMs > 0 ? job.intervalMs * 2 : Infinity;

  if (!job.enabled) {
    return { ...base, severity: 'warn', verdict: 'Disabled — will not run until started' };
  }
  if (job.lastError) {
    return { ...base, severity: 'fail', verdict: `Last run failed: ${job.lastError}` };
  }
  if (!job.lastRun) {
    if (uptimeMs < grace) {
      return { ...base, severity: 'unknown', verdict: 'Not yet due since restart' };
    }
    return { ...base, severity: 'fail', verdict: `Never ran, despite ${Math.round(uptimeMs / 60_000)} min uptime` };
  }
  const sinceRun = Date.now() - new Date(job.lastRun).getTime();
  if (job.intervalMs > 0 && sinceRun > grace) {
    return { ...base, severity: 'fail', verdict: `Overdue: last ran ${Math.round(sinceRun / 60_000)} min ago, interval is ${Math.round(job.intervalMs / 60_000)} min` };
  }
  return { ...base, severity: 'ok', verdict: `Ran ${Math.round(sinceRun / 60_000)} min ago (${job.runCount} runs, ${job.errorCount} errors)` };
}

// ── The report ──────────────────────────────────────────────────────────────

/**
 * The database's own account of itself.
 *
 * Added after 18 Sep 2026, when NOVA spent an afternoon timing out — ticks, the KPI pipeline,
 * wallboards, several endpoints, all on "Timeout: Request failed to complete in 30000ms" — and
 * answering "why" meant pasting a JS loop into a browser console to read the connection pool.
 * That reading is what disproved the working theory: the pool was fine (pending 0, peak 23 of
 * 50), so the slowness was in individual queries, not contention. An hour went into reaching a
 * conclusion four numbers settle.
 *
 * The three checks are the order CLAUDE.md prescribes, and the order matters — a stalled
 * NOVA screen is far more often stale statistics forcing a recompile than a slow query.
 */
export interface DatabaseHealth {
  /** `pending` above zero means queries are queueing for a connection. Zero means any
   *  slowness is the queries themselves, which is a different problem with a different fix. */
  pool: { size: number; used: number; free: number; pending: number; severity: Severity; note: string };
  /** A filtered index 138k modifications out of date once made every compile trigger a
   *  synchronous stats update, which the client timeout then cancelled — wedged, with no
   *  error to read. High modifications against low rows is the tell. */
  /** False when the DMV could not be read at all. "No rows came back" and "nothing is wrong"
   *  are the exact pair this page exists to keep apart, so the caller must be able to tell an
   *  empty list from an unanswered question. */
  staleStatsReadable: boolean;
  staleStats: Array<{ table: string; stat: string; rows: number; modifications: number; severity: Severity }>;
  /** S0 is 10 DTU. Data IO pegged at 100% for long stretches is a known state here. */
  resource: { avgCpuPercent: number; avgDataIoPercent: number; maxWorkerPercent: number; severity: Severity; note: string } | null;
}

export interface HealthSignals {
  build: string;
  generatedAt: string;
  /** Worst severity across every check — the one word for the top of the page. */
  overall: Severity;
  /**
   * False when this report cannot see properly — either a positive control is
   * itself unhealthy, or a whole section failed to evaluate. Its greens are then
   * not evidence of anything, and consumers should say so loudly rather than
   * rendering a reassuring page.
   *
   * Deliberately the WIDER of the two flags, because it is the one every
   * consumer has been told to read. An earlier version checked only the table
   * controls, which meant a report that had failed to evaluate two of its three
   * layers still certified itself as sound.
   */
  trustworthy: boolean;
  /**
   * The narrow half: are the known-busy tables reporting as busy. Separated out
   * so a consumer can distinguish "the checker is blind" from "one section of
   * it did not run", which want different responses — the first invalidates
   * everything, the second only what it covered.
   */
  controlsHealthy: boolean;
  tables: Signal<TableHealth[]>;
  columns: Signal<ColumnHealth[]>;
  jobs: Signal<JobsHealth>;
  database: Signal<DatabaseHealth>;
  /** Sections that could not be evaluated at all, named so they cannot be missed. */
  unavailable: Array<{ name: string; error: string | null }>;
}

export async function getHealthSignals(jobRegistry?: JobRegistry): Promise<HealthSignals> {
  const tables = await signal(async () => {
    const out: TableHealth[] = [];
    // Sequential on purpose: this runs against an S0 tier with no headroom to
    // absorb a burst, and nothing here is urgent enough to justify one.
    //
    // Isolated per row, because these read hot tables and one of them WILL
    // eventually time out — `jira_issue_cache` is small but written continuously,
    // so a reporting SELECT queues behind the sync. Letting that take the whole
    // section down would blind every other check to punish the unlucky one, and
    // the row that fails is usually the row worth reading.
    for (const exp of TABLE_EXPECTATIONS) out.push(await checkTable(exp).catch(err => ({
      table: exp.table, cadence: exp.cadence, why: exp.why,
      control: exp.control ?? false, unverified: exp.unverified ?? false,
      severity: 'unknown' as Severity, exists: true, rowCount: null, lastRowAt: null,
      hoursSinceLastRow: null, timestampColumn: null, neverWritten: false,
      verdict: `Could not be checked: ${err instanceof Error ? err.message : 'query failed'}`,
    })));
    return out;
  });

  const columns = await signal(async () => {
    const out: ColumnHealth[] = [];
    for (const exp of COLUMN_EXPECTATIONS) out.push(await checkColumn(exp).catch(err => ({
      table: exp.table, column: exp.column, why: exp.why,
      severity: 'unknown' as Severity, rowCount: 0, distinctValues: 0, constantValue: null,
      verdict: `Could not be checked: ${err instanceof Error ? err.message : 'query failed'}`,
    })));
    return out;
  });

  const jobs = await signal(async () => {
    if (!jobRegistry) throw new Error('Job registry not available in this context');
    const uptimeMs = process.uptime() * 1000;
    const status = jobRegistry.getStatus();
    return {
      uptimeSeconds: Math.round(process.uptime()),
      warmingUp: uptimeMs < 15 * 60_000,
      inMemoryOnly: true,
      jobs: status.map(j => jobHealth(j, uptimeMs)),
    } satisfies JobsHealth;
  });

  const database = await signal(async (): Promise<DatabaseHealth> => {
    const p = getPoolStats();
    // Queueing at all is worth a look; a deep queue means every feature is already waiting.
    const poolSeverity: Severity = p.pending > 10 ? 'fail' : p.pending > 0 ? 'warn' : 'ok';
    const pool = {
      ...p,
      severity: poolSeverity,
      note: p.pending > 0
        ? `${p.pending} request(s) queueing for a connection — the pool is the bottleneck.`
        : 'No queueing. Any slowness is in the queries themselves, not waiting for a connection.',
    };

    let staleStats: DatabaseHealth['staleStats'] = [];
    let staleStatsReadable = true;
    try {
      const rows = await query<{ table_name: string; stat_name: string; rows: number; modification_counter: number }>(
        `SELECT TOP 10 OBJECT_NAME(s.object_id) AS table_name, s.name AS stat_name,
                sp.rows, sp.modification_counter
         FROM sys.stats s
         CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
         WHERE sp.modification_counter > 1000
         ORDER BY sp.modification_counter DESC`,
        [],
      );
      staleStats = rows.map(r => ({
        table: r.table_name ?? 'unknown',
        stat: r.stat_name,
        rows: r.rows ?? 0,
        modifications: r.modification_counter ?? 0,
        // Judged against the row count, not in absolute terms: 50k modifications on a
        // million-row table is routine, the same number against 7k rows is what wedged
        // the CSAT screen for a day.
        severity: (r.modification_counter > (r.rows || 1) * 5 ? 'fail' : 'warn') as Severity,
      }));
    } catch {
      // Unreadable for this login, or the database too busy to answer. Degrade rather than fail
      // the section — but say so, so an empty list is never mistaken for a clean result.
      staleStatsReadable = false;
    }

    let resource: DatabaseHealth['resource'] = null;
    try {
      const rows = await query<{ avg_cpu_percent: number; avg_data_io_percent: number; max_worker_percent: number }>(
        `SELECT TOP 5 avg_cpu_percent, avg_data_io_percent, max_worker_percent
         FROM sys.dm_db_resource_stats ORDER BY end_time DESC`,
        [],
      );
      if (rows.length) {
        const avg = (pick: (r: typeof rows[0]) => number) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0) / rows.length;
        const io = avg(r => r.avg_data_io_percent);
        const cpu = avg(r => r.avg_cpu_percent);
        const worker = avg(r => r.max_worker_percent);
        const worst = Math.max(io, cpu, worker);
        resource = {
          avgCpuPercent: Math.round(cpu), avgDataIoPercent: Math.round(io), maxWorkerPercent: Math.round(worker),
          severity: (worst >= 90 ? 'fail' : worst >= 70 ? 'warn' : 'ok') as Severity,
          note: io >= 90
            ? 'Data IO is saturated — queries are waiting on storage, which is what a 30s timeout looks like from here.'
            : 'Within normal range for the last minute.',
        };
      }
    } catch { /* not available on every tier or login */ }

    return { pool, staleStatsReadable, staleStats, resource };
  });

  const unavailable: Array<{ name: string; error: string | null }> = [];
  if (!database.ok) unavailable.push({ name: 'database', error: database.error });
  if (!tables.ok) unavailable.push({ name: 'tables', error: tables.error });
  if (!columns.ok) unavailable.push({ name: 'columns', error: columns.error });
  if (!jobs.ok) unavailable.push({ name: 'jobs', error: jobs.error });

  const severities: Severity[] = [];
  if (database.data) {
    severities.push(database.data.pool.severity);
    severities.push(...database.data.staleStats.map(st => st.severity));
    if (!database.data.staleStatsReadable) severities.push('unknown');
    if (database.data.resource) severities.push(database.data.resource.severity);
  }
  if (tables.data) severities.push(...tables.data.map(t => t.severity));
  if (columns.data) severities.push(...columns.data.map(c => c.severity));
  // A warming-up process would otherwise report its whole job list as broken
  // every time the service restarts.
  if (jobs.data && !jobs.data.warmingUp) severities.push(...jobs.data.jobs.map(j => j.severity));
  if (unavailable.length) severities.push('unknown');

  // Fails safe on an empty control list: deleting the control rows must not be
  // able to certify the report by leaving `every` with nothing to object to.
  const controls = tables.data?.filter(t => t.control) ?? [];
  const controlsHealthy = tables.ok && controls.length > 0 && controls.every(c => c.severity === 'ok');

  return {
    build: HEALTH_SIGNALS_BUILD,
    generatedAt: new Date().toISOString(),
    overall: worst(severities),
    trustworthy: controlsHealthy && unavailable.length === 0,
    controlsHealthy,
    tables, columns, jobs, database, unavailable,
  };
}
