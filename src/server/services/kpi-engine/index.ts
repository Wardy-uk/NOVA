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
import type { SettingsQueries } from '../../db/settings-store.js';
import { ensureKpiSchema, countKpiTables, KPI_TABLE_COUNT } from './kpi-schema.js';
import { seedKpiFoundation, type SeedCounts } from './kpi-seed.js';
import { KpiEngine } from './kpi-engine.js';
import { KpiEodService } from './kpi-eod.js';
import { KpiViewsService } from './kpi-views.js';
import { KpiManualService } from './kpi-manual.js';
import { KpiDigestService, type DigestLlm } from './kpi-digest.js';
import { KpiAdminService } from './kpi-admin.js';
import { KpiEscalationFixtureService } from './kpi-fixture.js';

export { KpiEngine } from './kpi-engine.js';
export { KpiEodService } from './kpi-eod.js';
export { KpiViewsService } from './kpi-views.js';
export { KpiManualService } from './kpi-manual.js';
export { KpiDigestService, type DigestLlm } from './kpi-digest.js';
export { KpiAdminService } from './kpi-admin.js';
export { KpiEscalationFixtureService } from './kpi-fixture.js';
export * from './types.js';

/** Stable id of the 3-min snapshot job (design §5.2). Shared with the route layer. */
export const SNAPSHOT_JOB_ID = 'kpi-engine-snapshot';
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000; // design §5.2 — every 3 minutes

/** Stable id of the EOD capture job (P2-WP1). Shared with the route layer. */
export const EOD_JOB_ID = 'kpi-engine-eod';
// EOD is self-gating per space (fires once each space reaches its configured
// end-of-day, in its own timezone). A 5-min tick captures within minutes of
// 17:30/18:00 and subsumes the design's late catch-up via the "already
// captured" guard.
const EOD_INTERVAL_MS = 5 * 60 * 1000;

/** Stable id of the AI digest job (P5-WP1). Shared with the route layer. */
export const DIGEST_JOB_ID = 'kpi-engine-digest';
// Digest generation is self-gating: it generates today's per-space + SLT digests
// once EOD rows exist for today and a digest has not already been written. A
// 15-min tick lands the digest shortly after the 17:30/18:00 EOD freeze (design
// §5.2 names 17:45) and subsumes the late catch-up.
const DIGEST_INTERVAL_MS = 15 * 60 * 1000;

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
  eod: KpiEodService;
  views: KpiViewsService;
  manual: KpiManualService;
  digest: KpiDigestService;
  admin: KpiAdminService;
  /** Disposable Escalations parity proof fixture (KPX-WP6A). */
  escalationFixture: KpiEscalationFixtureService;
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
export async function initKpiFoundation(
  jobRegistry: JobRegistry,
  opts: { llm?: DigestLlm | null; settings?: SettingsQueries | null } = {},
): Promise<KpiFoundation> {
  // Settings let the engine reach the KPI / techservicesjsm pool for the QA and
  // golden-rules source families (KPX-WP3); without it those metrics degrade to
  // "—" but the rest of the engine is unaffected.
  const engine = new KpiEngine(opts.settings ?? null);
  const eod = new KpiEodService(engine);
  const views = new KpiViewsService(engine);
  const manual = new KpiManualService(engine);
  const digest = new KpiDigestService(eod, opts.llm ?? null);
  const admin = new KpiAdminService(engine);
  const escalationFixture = new KpiEscalationFixtureService(engine, eod);
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

    // EOD capture cycle (P2-WP1). Self-gates each space to its own end-of-day;
    // the timer can fire continuously without capturing before EOD or twice.
    jobRegistry.register(
      EOD_JOB_ID,
      'KPI Engine: EOD daily-freeze cycle (clean-sheet)',
      async () => { await eod.runEodCycle(); },
      EOD_INTERVAL_MS,
    );

    // AI digest cycle (P5-WP1). Self-gates: generate today's per-space + SLT
    // digests once EOD rows exist for today and no SLT digest has been written.
    jobRegistry.register(
      DIGEST_JOB_ID,
      'KPI Engine: daily AI digest cycle (clean-sheet)',
      async () => {
        const todayUk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const report = await eod.getDailyReport(todayUk);
        if (report.summary.spacesCaptured === 0) return; // nothing frozen yet today
        const existing = await digest.getForDate(todayUk);
        if (existing.slt) return; // already generated today
        await digest.generateForDate(todayUk);
      },
      DIGEST_INTERVAL_MS,
    );

    // Kick initial cycles shortly after boot (window/EOD permitting). The EOD
    // kick lets a restart near 17:30/18:00 still capture without waiting a tick.
    setTimeout(() => { engine.runSnapshotCycle().catch(() => {}); }, 30_000);
    setTimeout(() => { eod.runEodCycle().catch(() => {}); }, 60_000);

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
  return { engine, eod, views, manual, digest, admin, escalationFixture, status };
}
