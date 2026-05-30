# P1-WP1-ITER1 — Foundation Activation Recovery Report

**Work package:** `P1-WP1-ITER1` — Recover the already-delivered Phase 1 KPI foundation so it is observably active at runtime, rather than silently inert.
**Date:** 2026-05-30
**Scope source:** `agent_work/spec/kpi_recovery_phase1_iteration1_build_brief.md` + `KPI-Clean-Sheet-Design.md`
**Build approach:** Activation + observability recovery only. No new metric families, no backfill expansion, no Phase 2–4 features. Legacy KPI system left behaviourally untouched.
**Build status:** Server TypeScript compiles clean (`tsc -p tsconfig.server.json --noEmit` → 0 errors).

---

## 1. What activation issue(s) were found

The Phase 1 foundation code was fully present (schema, seed, engine, scheduler, routes) but **never executed in environments without an onboarding Jira API client** — which is exactly the evaluator's environment.

### 1.1 Primary root cause — init gated behind the wrong condition (explains all five eval findings at once)

`initKpiFoundation()` and the `/api/kpi/*` route mount were placed **inside** the `if (agentJiraClient) { … }` block in `src/server/index.ts` (the block spanning the agent-loop/Jira-pipeline setup). The clean-sheet foundation by design depends **only** on the NOVA main MSSQL pool and the job registry — it reads `jira_issue_cache`, not a live Jira API client — so it never needed that gate.

In the evaluator environment, `buildOnboardingJiraClient()` returns no client, so the entire `if (agentJiraClient)` block is skipped. The consequence is that the init call is never reached at all, which is why the evaluator observed every symptom simultaneously:

| Eval finding | Cause under the gating bug |
|---|---|
| no `kpi_*` tables created | `ensureKpiSchema()` never called |
| no seeded config rows | `seedKpiFoundation()` never called |
| no registered 3-minute snapshot job | `jobRegistry.register('kpi-engine-snapshot', …)` never called |
| no live `/api/kpi/*` surface | `app.use('/api/kpi', …)` never executed |
| no surfaced init failure | the `try/catch` around init was inside the skipped block, so even the error path never ran |

### 1.2 Contributing cause — foundation source files were never committed

The entire `src/server/services/kpi-engine/` module tree and `src/server/routes/kpi-engine.ts` were present on the working disk but **untracked in git** (`git status` showed them as new/`A` only when staged in this iteration). Any deploy or evaluation from a clean checkout would not have included the foundation code at all. This iteration commits them so the foundation travels with the repository.

### 1.3 Secondary cause — silent self-certification on partial failure

Even when init *did* run (an env with a Jira client), it could still report success while being inert:

- `ensureKpiSchema()` wrapped every DDL statement in a `try/catch` that only `console.warn`'d and continued, then **unconditionally logged "schema ensured"** and returned `void`. A pool/permission/DDL failure left the foundation with no tables while the logs claimed success.
- `initKpiFoundation()` logged `"foundation initialised"` regardless of whether the schema and seeds had actually landed.
- The `/api/kpi/health` endpoint only reported snapshot row counts — it could not distinguish "genuinely live" from "init silently failed".

This is the "silent inertness" the brief calls out: the system asserted success without verifying it.

---

## 2. What was changed to make the foundation observably active

All changes are activation/observability only and confined to the isolated `kpi-engine` module tree plus the single wiring line in `index.ts`. The legacy KPI path was not touched.

### 2.1 Unconditional initialisation (the core fix)
`src/server/index.ts`
- **Removed** the foundation init/route-mount from inside `if (agentJiraClient)`.
- **Re-added** it unconditionally next to the other top-level `app.use(...)` route mounts (after `/api/people`), where `jobRegistry` and the NOVA pool are already available. It now runs on every boot, with or without a Jira client.
- The mount now passes the activation-status accessor and the snapshot-job accessor to the routes so `/health` can prove liveness.
- Route ordering verified: the foundation router defines no `/derived/run` route, so the legacy `POST /api/kpi/derived/run` (registered later, still inside its own block) continues to match and work — no collision.

### 2.2 Init verifies activation and never silently claims success
`src/server/services/kpi-engine/index.ts` (rewritten `initKpiFoundation`)
- After running the schema DDL it **counts the kpi_* tables actually present** in the NOVA pool (`countKpiTables()`); if fewer than the expected 11 exist it raises a clear error.
- Captures a structured `KpiInitStatus` (initialised flag, timestamp, error, tables present/expected, DDL failure count, seed insert counts, job-registered flag), stored module-side and exposed via `getKpiInitStatus()`.
- On any failure it logs `"[kpi-engine] FOUNDATION INIT FAILED — clean-sheet KPI system is INERT: …"` at **error** level and records the reason in status — but does **not** throw, so the `/api/kpi/*` surface still mounts and reports the failure honestly.
- On success it logs an explicit `"clean-sheet foundation ACTIVE — N/11 tables, seed(…), snapshot job registered"` line.

### 2.3 Schema DDL surfaces its own failures
`src/server/services/kpi-engine/kpi-schema.ts`
- `ensureKpiSchema()` now **counts** failed DDL statements and returns `{ statements, failed }`; logs an **error** (not just a warn) when any statement failed, instead of always logging success.
- Added `countKpiTables()` and the `KPI_TABLE_COUNT` constant (11) used by init to verify the schema is genuinely present.

### 2.4 Seed reports what it inserted
`src/server/services/kpi-engine/kpi-seed.ts`
- `seedKpiFoundation()` now returns `{ spaces, metrics, bindings, tiers }` insert counts (still idempotent / non-clobbering) so init and `/health` can report them.

### 2.5 `/health` is now the single observability endpoint
`src/server/routes/kpi-engine.ts`
- `GET /api/kpi/health` returns a structured payload covering schema, seeds, scheduler, and snapshots, plus the init status. It **always returns 200** — an init failure shows up as `initialised: false` + `initError` rather than an opaque 500, keeping the surface reachable even when the DB schema never came up.
- `KpiEngine.getHealth()` extended to also return `spaceMetrics` and `tiers` counts.

---

## 3. How runtime observability now proves schema, seeds, scheduler, and routes are live

A single unauthenticated call — `GET /api/kpi/health` — now externally proves each required outcome:

```jsonc
{
  "ok": true,
  "data": {
    "initialised": true,                 // proof: init ran to completion
    "initialisedAt": "2026-05-30T…Z",
    "initError": null,                   // proof: no hidden failure
    "schema":   { "tablesPresent": 11, "tablesExpected": 11, "ddlStatementsFailed": 0 },   // (1) schema live
    "seeds":    { "spaces": 8, "metrics": …, "spaceMetrics": …, "tiers": … },               // (2) seeds present
    "scheduler":{ "jobId": "kpi-engine-snapshot", "registered": true,                        // (3) scheduler live
                  "intervalMs": 180000, "lastRun": "…", "runCount": …, "lastError": null },
    "snapshots":{ "rows": …, "lastSnapshotAt": "…" },
    "dbError": null
  }
}
```

Mapping to the required outcomes:

1. **Schema created in the NOVA DB** — `schema.tablesPresent` is a live `sys.objects` count of `kpi_*` tables in the NOVA main pool (expected 11). Also independently visible via `GET /api/kpi/spaces`.
2. **Seed/config rows present** — `seeds.spaces` (8), `seeds.metrics`, `seeds.spaceMetrics` (bindings), `seeds.tiers` are live counts from the seeded tables. `GET /api/kpi/spaces` and `GET /api/kpi/spaces/:key/metrics` return the actual seeded rows.
3. **Snapshot execution path registered/observable** — `scheduler.registered: true` with `intervalMs: 180000`, plus `lastRun`/`runCount` advancing once the 30s initial kick (and 3-min cycle) fire within a space's compute window. `POST /api/kpi/run-snapshot` forces a cycle on demand for evaluation.
4. **`/api/kpi/*` reachable** — the fact that `/health`, `/spaces`, `/spaces/:key/metrics`, `/snapshot/:spaceKey`, and `/run-snapshot` respond at all is the proof; they are now mounted unconditionally on every boot.
5. **Init failure surfaced clearly** — if anything fails, `initialised` is `false`, `initError` carries the reason, `schema.ddlStatementsFailed` is non-zero, and the server log carries an explicit `FOUNDATION INIT FAILED … INERT` error line. No more silent success.
6. **Legacy untouched** — no change to `kpi-pipeline.ts`, `routes/kpi-data.ts`, `routes/trends.ts`, the `techservicesjsm` tables, or the n8n workflow. The legacy `POST /api/kpi/derived/run` still registers and matches as before.

Startup log lines now make activation auditable without HTTP:
- `[kpi-engine] kpi_* schema ensured (N statements, 0 failures).`
- `[kpi-engine] foundation seeded — spaces +X, metrics +Y, bindings +Z, tiers +W …`
- `[kpi-engine] clean-sheet foundation ACTIVE — 11/11 tables, seed(…), snapshot job registered.`
- (on failure) `[kpi-engine] FOUNDATION INIT FAILED — clean-sheet KPI system is INERT: <reason>`

---

## 4. Remaining bounded gaps

These were already documented as bounded in the original `P1-WP1` build report and are **unchanged** by this activation recovery (deliberately not expanded per the brief):

- **Computed-snapshot data depth** depends on a live NOVA DB with at least one Jira sync cycle since the Phase 0 `resolved_at` / story-point capture fix; before that, resolution-based and story-point metrics read low/zero. `scheduler.lastRun` and `snapshots.rows` make this state visible rather than hidden.
- **STBY and manual teams** show empty computed data by design (STBY not yet in sync scope; CS/KAM/Onboarding/Comms are `source = 'manual'`, which is Phase 4). They are still seeded and visible via `/spaces`.
- **Metrics seeded without a Phase 1 computer** (e.g. `escalation_rate`, `fcr_rate`, sprint/AI metrics) are skipped gracefully by the engine — no bad data written.
- **Snapshot rows accrue only inside each space's compute window.** Outside business hours `runCount` advances but `snapshots.rows` may not — `POST /api/kpi/run-snapshot` lets an evaluator force a cycle regardless of clock time (it still self-gates per space window, so off-hours it reports `skipped: [...:outside-window]` honestly).

No new gaps were introduced.

---

## 5. Readiness for re-evaluation

**Ready for re-evaluation.**

The activation defect that caused the prior failure — foundation init gated behind an unrelated Jira-client condition — is fixed: the foundation now initialises unconditionally on every boot. The secondary silent-success defect is fixed: init verifies the schema is genuinely present, reports seed/scheduler state, and surfaces any failure both in logs and through `GET /api/kpi/health` (which always responds). The legacy KPI system is behaviourally unchanged.

The evaluator can confirm activation entirely through observable runtime behaviour via `GET /api/kpi/health`, `GET /api/kpi/spaces`, `GET /api/kpi/spaces/:key/metrics`, and `POST /api/kpi/run-snapshot` — no code inspection required.
