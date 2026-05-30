/**
 * KPI Recovery — Foundation bootstrap (P1-WP1)
 *
 * Single entry point that stands up the clean-sheet foundation alongside the
 * untouched legacy KPI system:
 *   1. ensure kpi_* schema   2. seed catalogue   3. register the 3-min snapshot job
 *
 * Wired UNCONDITIONALLY from index.ts (it depends only on the NOVA main pool and
 * the job registry — NOT on a live Jira API client). Activation is verified and
 * surfaced: if the schema or seed cannot complete, the failure is logged as an
 * error and reported through the foundation /health endpoint rather than being
 * silently hidden.
 */
import type { JobRegistry } from '../job-registry.js';
import { ensureKpiSchema, countKpiTables, KPI_TABLE_COUNT } from './kpi-schema.js';
import { seedKpiFoundation, type SeedCounts } from './kpi-seed.js';
import { KpiEngine } from './kpi-engine.js';

export { KpiEngine } from './kpi-engine.js';
export * from './types.js';

/** Stable id of the 3-min snapshot job (design §5.2). Shared with the route layer. */
export const SNAPSHOT_JOB_ID = 'kpi-engine-snapshot';
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000; // design §5.2 — every 3 minutes

/** Observable activation state, surfaced via GET /api/kpi/health. */
export interface KpiInitStatus {
  initialised: boolean;
  initialisedAt: string | null;
  error: string | null;
  schemaTablesPresent: number;
  schemaTablesExpected: number;
  ddlStatementsFailed: number;
  seedInserted: SeedCounts;
  jobRegistered: boolean;
}

let lastStatus: KpiInitStatus = {
  initialised: false,
  initialisedAt: null,
  error: null,
  schemaTablesPresent: 0,
  schemaTablesExpected: KPI_TABLE_COUNT,
  ddlStatementsFailed: 0,
  seedInserted: { spaces: 0, metrics: 0, bindings: 0, tiers: 0 },
  jobRegistered: false,
};

/** Latest foundation activation status (for the /health route). */
export function getKpiInitStatus(): KpiInitStatus {
  return lastStatus;
}

export interface KpiFoundation {
  engine: KpiEngine;
  status: KpiInitStatus;
}

/**
 * Initialise the KPI clean-sheet foundation. Idempotent: safe across restarts.
 *
 * Never throws: a failure is captured in the returned status (and logged as an
 * error) so the caller can still mount the /api/kpi/* surface and report the
 * failure honestly. Returns the engine so routes can read spaces/metrics/
 * snapshots/health.
 */
export async function initKpiFoundation(jobRegistry: JobRegistry): Promise<KpiFoundation> {
  const engine = new KpiEngine();
  const status: KpiInitStatus = {
    ...lastStatus,
    schemaTablesExpected: KPI_TABLE_COUNT,
    initialised: false,
    error: null,
  };

  try {
    const ddl = await ensureKpiSchema();
    status.ddlStatementsFailed = ddl.failed;

    // Verify the schema is actually present in the NOVA pool — do not trust a
    // "ran without throwing" signal.
    status.schemaTablesPresent = await countKpiTables();
    if (status.schemaTablesPresent < KPI_TABLE_COUNT) {
      throw new Error(
        `kpi_* schema incomplete: ${status.schemaTablesPresent}/${KPI_TABLE_COUNT} tables present ` +
        `(${ddl.failed} DDL statement(s) failed)`,
      );
    }

    status.seedInserted = await seedKpiFoundation();

    // 3-minute snapshot cycle. The engine self-gates each space to its compute
    // window, so the timer can fire continuously without writing out-of-hours rows.
    jobRegistry.register(
      SNAPSHOT_JOB_ID,
      'KPI Engine: 3-min snapshot cycle (clean-sheet)',
      async () => { await engine.runSnapshotCycle(); },
      SNAPSHOT_INTERVAL_MS,
    );
    status.jobRegistered = !!jobRegistry.getJob(SNAPSHOT_JOB_ID);

    // Kick an initial cycle shortly after boot (window permitting).
    setTimeout(() => { engine.runSnapshotCycle().catch(() => {}); }, 30_000);

    status.initialised = true;
    status.initialisedAt = new Date().toISOString();
    console.log(
      `[kpi-engine] clean-sheet foundation ACTIVE — ${status.schemaTablesPresent}/${KPI_TABLE_COUNT} tables, ` +
      `seed(+${status.seedInserted.spaces} spaces/+${status.seedInserted.metrics} metrics/` +
      `+${status.seedInserted.bindings} bindings/+${status.seedInserted.tiers} tiers), ` +
      `snapshot job ${status.jobRegistered ? 'registered' : 'NOT registered'}.`,
    );
  } catch (err) {
    status.initialised = false;
    status.error = err instanceof Error ? err.message : String(err);
    console.error(
      `[kpi-engine] FOUNDATION INIT FAILED — clean-sheet KPI system is INERT: ${status.error} ` +
      `(legacy KPI unaffected)`,
    );
  }

  lastStatus = status;
  return { engine, status };
}
