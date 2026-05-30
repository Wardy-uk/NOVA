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
import type { KpiEngine, KpiInitStatus, KpiEodService } from '../services/kpi-engine/index.js';
import { SNAPSHOT_JOB_ID, EOD_JOB_ID } from '../services/kpi-engine/index.js';
import type { RegisteredJob } from '../services/job-registry.js';

/** YYYY-MM-DD validator for date path params. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createKpiEngineRoutes(deps: {
  engine: KpiEngine;
  /** EOD capture + daily-report service (P2-WP1). */
  eod: KpiEodService;
  /** Foundation activation status (so /health can prove the system is live). */
  getStatus: () => KpiInitStatus;
  /** Snapshot job status from the registry (proves the scheduler is registered/running). */
  getSnapshotJob: () => RegisteredJob | undefined;
  /** EOD job status from the registry (proves the daily scheduler is live). */
  getEodJob: () => RegisteredJob | undefined;
}): Router {
  const router = Router();
  const { engine, eod } = deps;

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
    const eodJob = deps.getEodJob();

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
        eodScheduler: {
          jobId: EOD_JOB_ID,
          registered: !!eodJob,
          intervalMs: eodJob?.intervalMs ?? null,
          lastRun: eodJob?.lastRun ?? null,
          runCount: eodJob?.runCount ?? 0,
          lastError: eodJob?.lastError ?? null,
        },
        snapshots: {
          rows: db?.snapshotRows ?? null,
          lastSnapshotAt: db?.lastSnapshotAt ?? null,
        },
        dbError,
      },
    });
  });

  // ── Phase 2: EOD daily-freeze + daily report ──

  // Full daily-report payload for the thin n8n email trigger (design §5.2, §9).
  // Reads the frozen official rows for :date — does not recompute.
  router.get('/daily-report/:date', async (req, res) => {
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    try {
      const report = await eod.getDailyReport(req.params.date);
      res.json({ ok: true, data: report });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Frozen daily metric rows for one space on a date (supporting read).
  router.get('/daily/:spaceKey/:date', async (req, res) => {
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    try {
      const space = await engine.getSpaceConfig(req.params.spaceKey);
      if (!space) return res.status(404).json({ ok: false, error: 'Unknown space' });
      const report = await eod.getDailyReport(req.params.date);
      const data = report.spaces.find((s) => s.spaceKey === req.params.spaceKey) ?? null;
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Agent daily rows for one space on a date (supporting read).
  router.get('/agent/:spaceKey/:date', async (req, res) => {
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    try {
      const space = await engine.getSpaceConfig(req.params.spaceKey);
      if (!space) return res.status(404).json({ ok: false, error: 'Unknown space' });
      const report = await eod.getDailyReport(req.params.date);
      const sp = report.spaces.find((s) => s.spaceKey === req.params.spaceKey);
      res.json({ ok: true, data: { space: req.params.spaceKey, date: req.params.date, agents: sp?.agents ?? [] } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // EOD ticket-state snapshot across all spaces for a date (supporting read).
  router.get('/eod/:date', async (req, res) => {
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    try {
      const report = await eod.getDailyReport(req.params.date);
      res.json({ ok: true, data: report.spaces.map((s) => ({ spaceKey: s.spaceKey, eodSnapshot: s.eodSnapshot })) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Operator-facing EOD capture trigger (evaluation aid + catch-up). The freeze
  // path writes kpi_daily (+ RAG), kpi_agent_daily and kpi_eod_snapshot, and is
  // idempotent — re-running replaces that (space, date)'s rows. Optional body:
  //   { spaceKey?, date?, force? }
  //   - spaceKey         → force-capture ONE space now (bypasses the EOD time
  //                        gate), so a single space can be frozen on demand.
  //   - force: true      → force-capture ALL active Jira spaces now, ignoring the
  //                        weekday/holiday/before-EOD gate. The one clean call to
  //                        demonstrate the freeze path off a natural weekday EOD.
  //   - (no body)        → run the normally-gated cycle (captures only spaces that
  //                        have reached their own EOD and aren't already frozen).
  // `date` (YYYY-MM-DD) overrides the report date for the single-space form.
  router.post('/eod-capture', async (req, res) => {
    const body = (req.body ?? {}) as { spaceKey?: string; date?: string; force?: boolean };
    if (body.date && !DATE_RE.test(body.date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    try {
      if (body.spaceKey) {
        const result = await eod.captureSpace(body.spaceKey, { reportDate: body.date });
        return res.json({ ok: true, data: result });
      }
      const result = await eod.runEodCycle(new Date(), { force: body.force === true });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
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
