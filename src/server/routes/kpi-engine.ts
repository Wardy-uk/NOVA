/**
 * KPI Recovery — Clean-Sheet Foundation read API (P1-WP1)
 *
 * Minimal, foundation-level introspection endpoints under the /api/kpi/*
 * namespace (cleared as viable in Phase 0). These exist so the new parallel
 * system is observable/evaluable — they are NOT the Phase 3 dashboards/views.
 *
 * Coexists with the legacy inline `POST /api/kpi/derived/run` (different paths).
 * Response shape follows the repo convention: { ok, data } / { ok, error }.
 */
import { Router } from 'express';
import type { KpiEngine, KpiInitStatus } from '../services/kpi-engine/index.js';
import { SNAPSHOT_JOB_ID } from '../services/kpi-engine/index.js';
import type { RegisteredJob } from '../services/job-registry.js';

export function createKpiEngineRoutes(deps: {
  engine: KpiEngine;
  /** Foundation activation status (so /health can prove the system is live). */
  getStatus: () => KpiInitStatus;
  /** Snapshot job status from the registry (proves the scheduler is registered/running). */
  getSnapshotJob: () => RegisteredJob | undefined;
}): Router {
  const router = Router();
  const { engine } = deps;

  // List all active spaces with their resolved config.
  router.get('/spaces', async (_req, res) => {
    try {
      const spaces = await engine.listSpaces();
      res.json({ ok: true, data: spaces.map((s) => ({
        spaceKey: s.spaceKey,
        jiraProject: s.jiraProject,
        displayName: s.displayName,
        ownerName: s.ownerName,
        timezone: s.timezone,
        bizHours: { startMinutes: s.bizStartMinutes, endMinutes: s.bizEndMinutes },
        weekendDays: s.weekendDays,
        pauseStatuses: s.pauseStatuses,
        hasTiers: s.hasTiers,
        isJiraSpace: s.isJiraSpace,
        slaDefaults: { frtTargetMin: s.defaultFrtTargetMin, resTargetMin: s.defaultResTargetMin },
      })) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Enabled metrics + targets for a space.
  router.get('/spaces/:key/metrics', async (req, res) => {
    try {
      const space = await engine.getSpaceConfig(req.params.key);
      if (!space) return res.status(404).json({ ok: false, error: 'Unknown space' });
      const metrics = await engine.getEnabledMetrics(req.params.key);
      const tiers = space.hasTiers ? await engine.getTierDefinitions(req.params.key) : [];
      res.json({ ok: true, data: { space: space.spaceKey, metrics, tiers } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Latest computed snapshot values for a space.
  router.get('/snapshot/:spaceKey', async (req, res) => {
    try {
      const space = await engine.getSpaceConfig(req.params.spaceKey);
      if (!space) return res.status(404).json({ ok: false, error: 'Unknown space' });
      const values = await engine.getLatestSnapshot(req.params.spaceKey);
      res.json({ ok: true, data: { space: space.spaceKey, values } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Engine health — the single observability endpoint. Proves, at runtime, that
  // the schema, seeds, scheduler, and routes are live. Always returns 200 so an
  // init failure is reported as `initialised: false` + `initError` rather than an
  // opaque 500 (honest surfacing per the recovery brief).
  router.get('/health', async (_req, res) => {
    const status = deps.getStatus();
    const job = deps.getSnapshotJob();

    // DB-backed counts. Degrade gracefully: if the schema never came up, report
    // the error instead of throwing — the foundation surface stays reachable.
    let db: Awaited<ReturnType<KpiEngine['getHealth']>> | null = null;
    let dbError: string | null = null;
    try {
      db = await engine.getHealth();
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
    }

    res.json({
      ok: true,
      data: {
        initialised: status.initialised,
        initialisedAt: status.initialisedAt,
        initError: status.error,
        schema: {
          tablesPresent: status.schemaTablesPresent,
          tablesExpected: status.schemaTablesExpected,
          ddlStatementsFailed: status.ddlStatementsFailed,
        },
        seeds: {
          spaces: db?.spaces ?? null,
          metrics: db?.metrics ?? null,
          spaceMetrics: db?.spaceMetrics ?? null,
          tiers: db?.tiers ?? null,
        },
        scheduler: {
          jobId: SNAPSHOT_JOB_ID,
          registered: !!job,
          intervalMs: job?.intervalMs ?? null,
          lastRun: job?.lastRun ?? null,
          runCount: job?.runCount ?? 0,
          lastError: job?.lastError ?? null,
        },
        snapshots: {
          rows: db?.snapshotRows ?? null,
          lastSnapshotAt: db?.lastSnapshotAt ?? null,
        },
        dbError,
      },
    });
  });

  // On-demand snapshot cycle (foundation introspection / evaluation aid).
  router.post('/run-snapshot', async (_req, res) => {
    try {
      const result = await engine.runSnapshotCycle();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
