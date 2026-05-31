# P5-WP1 — AI Digest, Config Admin, Health & Thin-Trigger — Build Completion Report

**Work package:** `P5-WP1` (KPI Recovery Phase 5 — AI digests + config/admin UI + health monitoring + n8n thin-trigger completion)
**Date:** 2026-05-30
**Agent:** Build Agent (Claude Code)
**Build state:** Both builds confirmed clean.
- `tsc -p tsconfig.server.json --noEmit` → **0 errors** (background run exit 0 + repeated foreground runs on the final code incl. the `SpaceHealth` type).
- `vite build` → **exit 0**, with the two new lazy chunks emitted: `KpiCleanDigestView-*.js` and `KpiCleanAdminView-*.js` in `dist/client/assets/`.

Implementation is additive and follows the established Phase 1–4 module patterns.

> **Session integrity note:** the tool-result channel was intermittently
> garbling/duplicating output. This caused three of the four `App.tsx` wiring edits
> (lazy imports, `View` union, area tabs, `FULL_WIDTH_VIEWS`) to falsely report
> "success" without landing — leaving the two new views referenced but not imported.
> This was caught by confirming vite emitted no new chunks, the edits were
> re-applied, and the final `vite build` (exit 0) now emits both
> `KpiCleanDigestView-*.js` and `KpiCleanAdminView-*.js`. All wiring is verified
> present in the final source.

---

## 1. What was delivered

All work is **new, additive, and parallel**. It builds on the converged Phase 1
foundation (`KpiEngine`, `kpi_*` tables, business-hours engine), the
Regression-Protected Phase 2 slice (`KpiEodService` — reused for the frozen daily
report + RAG), the converged Phase 3 views (`KpiViewsService`), and the converged
Phase 4 manual/import (`KpiManualService` — reused unchanged by the admin Import
tab). The legacy KPI system — n8n workflow, `techservicesjsm` tables,
`kpi-pipeline.ts`, `/api/kpi-data/*`, `/api/trends/*`, and all legacy KPI/wallboard
views — was **not touched** and continues running in parallel.

### Required outcome 1 & 2 — AI digests per space + cross-space SLT digest → `kpi_digests`

New service `src/server/services/kpi-engine/kpi-digest.ts` (`KpiDigestService`):

- `generateForDate(date)` reads the **frozen** daily report from `KpiEodService`
  (does not recompute), then for **each captured space** produces a 3–5 sentence
  digest and for the **whole estate** produces one cross-space **SLT digest**
  (`space_key = NULL`). Both are upserted into `kpi_digests` idempotently per
  `(space_key, report_date, digest_type)`.
- **AI when available, deterministic otherwise (honesty rule):** if an LLM provider
  is configured it calls the shared `LlmService` (`callType: 'kpi_daily_digest'`,
  already in the tier + budget maps) with a strict Zod schema; if no provider is
  configured, a call fails, or the daily budget is suppressed, a **deterministic
  structured summary** is stored instead. Every `generate` call reports
  `aiCount` vs `fallbackCount` so provenance is observable — digests are never
  faked as AI-authored.
- Only spaces with captured data get a digest; empty spaces are **skipped and
  reported** (`skipped[]`), never given an invented narrative.
- Reads: `getForDate(date)` → `{ date, slt, spaces[] }`, `getOne()`,
  `latestDigestDate()`.
- **Scheduler:** new self-gating `kpi-engine-digest` job (15-min tick) registered in
  `initKpiFoundation`. It generates today's per-space + SLT digests once EOD rows
  exist for today and no SLT digest has yet been written — landing the digest
  shortly after the 17:30/18:00 freeze (design §5.2 names 17:45) and subsuming the
  late catch-up. Surfaced in `GET /api/kpi/health` as `digestScheduler`.

### Required outcome 3 — Config/admin surface (spaces, metrics, tiers, holidays, health, import)

New service `src/server/services/kpi-engine/kpi-admin.ts` (`KpiAdminService`) +
routes, all under the existing `/api/kpi/*` family:

| Area | Endpoint(s) |
|---|---|
| Spaces | `PUT /spaces/:key` (business hours, timezone, pause statuses, weekend days, tiers flag, active) |
| Metrics | `GET /metrics-catalogue`, `GET /admin/space-metrics/:space` (incl. disabled bindings), `PUT /spaces/:key/metrics` (enable/disable, target, amber band, order, **`show_on_wallboard`**, `show_on_slt_view`) |
| Tiers | `GET /tiers/:space`, `PUT /tiers/:space` (upsert incl. the `Standard` SLA row), `DELETE /tiers/:space/:tierName` |
| Holidays | `GET /holidays[?spaceKey=]`, `POST /holidays`, `DELETE /holidays/:id` (feeds the business-hours engine) |
| Health | `GET /admin-health` (see outcome 4) |
| Import | reuses the Phase 4 `POST /import` |

All writes go through the NOVA main pool; seeding stays insert-if-missing so these
runtime edits persist across restarts. Validation is enforced (HH:MM times, CSV
weekend days, YYYY-MM-DD dates, known space/metric).

New React view `src/client/components/KpiCleanAdminView.tsx` — six tabs (Spaces ·
Metrics · Tiers · Holidays · Health · Import), wired as the **"Config & Health"**
tab of the KPI Platform area. The Metrics tab flips `show_on_wallboard`, which the
Phase 3 wallboards already honour (the prior "no seed sets `show_on_wallboard=1`"
fallback noted in P3 can now be resolved from the UI with no code change).

### Required outcome 4 — Health monitoring/dashboard

`KpiAdminService.getHealth()` + `GET /api/kpi/admin-health`: engine counts plus,
**per space**, last daily-capture date, distinct daily days in the last 14, the
**specific missing business days** (weekend/holiday-aware), last snapshot time,
snapshot rows today, and last digest date. Rendered in the admin **Health** tab
alongside the foundation/scheduler status from `GET /api/kpi/health` (snapshot, EOD,
**digest** schedulers). Snapshot sparsity and manual-team staleness are **surfaced
honestly**, not hidden — per the brief.

### Required outcome 5 — n8n reduced to the thin-trigger pattern

- `GET /api/kpi/daily-report/:date` is now **enriched with the digests**
  (`{ ...report, digests }`) so the n8n side only has to fetch one endpoint, format,
  and send — no logic, no SQL, no API calls. This was done in the route layer; the
  Phase 2 `kpi-eod.ts` was left untouched.
- In-repo artifact `docs/kpi-n8n/` — a ready-to-import **thin-trigger workflow**
  (`kpi-daily-email-thin-trigger.workflow.json`: 18:00 + 23:00 cron → HTTP GET →
  format → send) and a migration `README.md`.
- **The live n8n instance was deliberately NOT modified.** Editing the production
  workflow is an outward-facing change that needs Nick's sign-off and a
  parallel-run validation window (design §12). The repo-side contract + artifact is
  complete; cut-over is the documented operational step.

### Wiring

- `kpi-engine/index.ts`: constructs `digest` + `admin`, exports them and
  `DIGEST_JOB_ID`, registers the digest job, returns them on `KpiFoundation`.
- `routes/kpi-engine.ts`: new `digest`/`admin` deps + `getDigestJob`, all new
  routes, and the `digestScheduler` block on `/health`.
- `server/index.ts`: imports `DIGEST_JOB_ID`, passes `digest`/`admin`/`getDigestJob`
  to the route factory. **TDZ fix:** `llmService` is constructed *after* the KPI
  foundation, so the LLM is injected post-construction via
  `kpiFoundation.digest.setLlm(llmService)` rather than at init (avoids a
  use-before-declaration error). When no provider is configured the digest service
  degrades to deterministic summaries.
- `client/App.tsx`: lazy imports, `View` union (`kpic-digest`, `kpic-admin`), two
  new tabs ("AI Digests", "Config & Health"), `FULL_WIDTH_VIEWS`, and render blocks
  — all additive; no legacy view/area touched.

---

## 2. What remains incomplete or bounded

- **Both builds confirmed clean** (server `tsc` 0 errors; client `vite build`
  exit 0 with both new chunks emitted). Nothing outstanding on the build gate.
- **AI digest quality depends on a configured LLM key.** With a key, digests are
  model-authored (`kpi_daily_digest` tier/budget already existed in `llm-service`).
  Without one, deterministic structured summaries are stored — fully functional and
  honestly labelled, but not narrative AI.
- **Production n8n unchanged** (see outcome 5) — repo artifact + contract only; live
  cut-over needs sign-off and the parallel-run window.
- **Metric *definitions* are not editable from the admin UI** — only per-space
  *bindings* (enable/disable, targets, flags, order) and creation of a binding for a
  catalogue metric. Editing the ~90 catalogue definitions themselves was treated as
  out of scope (they are seed data).
- **Digest history depth** = whatever `kpi_daily` has been frozen. Back-generating
  digests for past dates is supported via `POST /digest/generate {date}` but is not
  bulk-run automatically.
- **No earlier converged slice was reopened.** Phase 1–4 behaviour is unchanged; all
  Phase 5 additions sit alongside it.

---

## 3. Assumptions required

1. **`/api/kpi/*` reachable** the same way Phases 1–4 use it (no new auth layer).
2. **Digests read the frozen daily report**, so they reflect captured EOD truth and
   are meaningful only after the EOD freeze has run for the date (the scheduler and
   the `digest/generate` endpoint both honour this).
3. **`callType: 'kpi_daily_digest'`** is the right routing/budget bucket — it already
   existed in `llm-service.ts` (`standard` tier, 25k daily budget), so no LLM config
   change was needed.
4. **`show_on_wallboard` is now operator-controlled** via the Metrics admin tab; the
   Phase 3 wallboards already key off it, so enabling it there takes effect with no
   code change.
5. **Health "missing business days"** uses each space's weekend days + holidays over
   a rolling 14 calendar days; manual (non-Jira) spaces are not expected to have
   computed daily rows, so they are not flagged as "missing".
6. **n8n cut-over is operational, not code** — the build delivers the endpoint
   contract + importable artifact; flipping production is Nick's call.

---

## 4. Readiness for independent evaluation

**Ready for independent behavioural evaluation.** Both builds are confirmed clean:
`tsc -p tsconfig.server.json --noEmit` → 0 errors, and `vite build` → exit 0 with
the `KpiCleanDigestView` and `KpiCleanAdminView` chunks emitted to
`dist/client/assets/`. The foundation mounts unconditionally (Phase 1 pattern), so
the new digest/admin/health endpoints, the digest scheduler, and the two new views
are live wherever the NOVA main pool is reachable. (The pre-existing legacy
`kpi-pipeline.ts` note under the root tsconfig is unrelated and untouched.)

### Suggested behavioural evaluation entry points (running software only)

1. **Digests** — `POST /api/kpi/eod-capture {"force":true}` to freeze today, then
   `POST /api/kpi/digest/generate` → `GET /api/kpi/digest/<today>`: confirm one SLT
   digest (`slt`) + a per-space digest for each captured space, and that the generate
   result reports AI vs deterministic counts. UI: **KPI Platform → AI Digests**.
2. **Config** — UI **KPI Platform → Config & Health**: edit a space's business
   hours; toggle a metric's `SLT`/`Wallboard` flags and a target; add a tier and a
   holiday; confirm each persists on reload (and that the SLT view / wallboard
   reflect flag changes).
3. **Health** — `GET /api/kpi/admin-health` and the Health tab: confirm per-space
   coverage, missing business days, snapshot recency, and scheduler status
   (snapshot/EOD/digest) render, with gaps shown honestly.
4. **Thin trigger** — `GET /api/kpi/daily-report/<date>`: confirm the payload now
   contains a `digests` block alongside `spaces`/`summary`, sufficient for n8n to
   format an email with no further calls.
5. **Parallel-run check** — confirm the legacy **KPIs** area, `/api/kpi-data/*`, and
   the legacy n8n workflow are unchanged; all Phase 5 surfaces are strictly additive.
