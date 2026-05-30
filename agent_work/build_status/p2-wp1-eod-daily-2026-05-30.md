# P2-WP1 — EOD & Daily Capture — Build Completion Report

**Work package:** `P2-WP1` (KPI Recovery Phase 2 — EOD and daily-capture delivery)
**Date:** 2026-05-30
**Agent:** Build Agent (Claude Code)
**Build state:** `tsc -p tsconfig.server.json` → 0 errors. RAG + EOD-trigger logic unit-checked (10/10 + 2/2 pass).

---

## 1. What was delivered

All work is **new, additive, and parallel**. It builds directly on the live Phase 1
clean-sheet foundation (`KpiEngine`, business-hours engine, pluggable computers, the
already-created `kpi_*` tables) and does not modify the legacy KPI system.

### New module — `src/server/services/kpi-engine/kpi-eod.ts` (`KpiEodService`)

The Phase 2 EOD/daily engine. Reuses the Phase 1 engine for config, ticket loading,
and metric computation; adds capture, RAG, and the report payload.

| Required outcome | How it is delivered |
|---|---|
| **1. EOD capture for UK at 17:30 Europe/London** | `runEodCycle()` checks each space's local wall-clock against its configured `biz_hours_end` in its own timezone. UK spaces (NT/NTPJ/YO) have `17:30` Europe/London, so they trigger at 17:30 local. |
| **2. EOD capture for STBY at 18:00 Asia/Kolkata** | STBY is seeded with `18:00` / `Asia/Kolkata`, so the same per-space gate fires it at 18:00 IST and never at UK time (design §13.1). |
| **3. Official daily rows → `kpi_daily`** | `captureSpace()` computes metrics fresh at the EOD instant via `engine.computeSpaceMetrics()` (space-level + per-tier for NT) and writes one row per space/metric/tier/date, with `target_value` denormalised and `rag_status` computed. |
| **4. Agent rows → `kpi_agent_daily`** | `computeAgentRows()` groups tickets by assignee and reuses the Phase 1 computers per agent, for every enabled `is_agent_level` metric that has an implemented computer. |
| **5. EOD ticket-state → `kpi_eod_snapshot`** | `computeEodGroups()` aggregates open tickets by (tier, status, request_type) with `ticket_count` and `over_sla_count` (over-SLA via business-hours engine against the tier-resolved resolution target). |
| **6. RAG against configurable targets/bands** | `computeRag()` reads `target_value` + `amber_band` (%) from `kpi_space_metrics` joined with metric `direction`. Amber band is a percentage deviation off the target. No SLA target is hardcoded — all come from stored config. |
| **7. Daily-report payload endpoint** | `GET /api/kpi/daily-report/:date` returns the full per-space payload (metrics + RAG summary + EOD snapshot summary + agent rows), read from the frozen tables, for the thin n8n email trigger to format and send. |

### Scheduler — `src/server/services/kpi-engine/index.ts`

- New `EOD_JOB_ID` job registered in `initKpiFoundation()` on a 5-minute tick.
- The job is **self-gating per space**: it only captures a space once it has passed
  its configured EOD on a business day (skips weekends/holidays) and only if that
  space has not already been frozen for that local date (`alreadyCaptured` guard).
- This one code path covers both the design's 17:30/18:00 trigger and its 23:00
  late catch-up — a failed/late run simply captures on the next tick.
- Initial post-boot kick at 60 s so a restart near EOD still captures.
- `KpiFoundation` now also returns the `eod` service.

### Routes — `src/server/routes/kpi-engine.ts`

New endpoints under the existing `/api/kpi/*` namespace (no namespace change; no
collision with legacy `POST /api/kpi/derived/run`):

- `GET /api/kpi/daily-report/:date` — **required** n8n payload.
- `GET /api/kpi/daily/:spaceKey/:date` — frozen daily rows for one space.
- `GET /api/kpi/agent/:spaceKey/:date` — agent daily rows for one space.
- `GET /api/kpi/eod/:date` — EOD ticket-state across spaces.
- `POST /api/kpi/eod-capture` — on-demand capture (`{ spaceKey?, date? }`) for
  catch-up / evaluation.
- `GET /api/kpi/health` extended with an `eodScheduler` block (proves the EOD job
  is registered and running).

All responses follow the repo `{ ok, data }` / `{ ok, error }` convention; date
params are validated `YYYY-MM-DD`.

### Idempotency

Each table is captured with delete-by-(space, date) then insert, so the EOD trigger,
a manual recapture, and the late catch-up all converge to one official row set.
`kpi_daily` / `kpi_agent_daily` also carry their unique constraints from Phase 1.

---

## 2. What remains incomplete or bounded

- **Agent-level metrics are bounded to implemented computers.** Agent rows are
  written for `frt_compliance`, `resolution_compliance`, `frt_avg_minutes`,
  `resolution_avg_minutes`, `resolved_today`, and `csat_score` (the `is_agent_level`
  metrics that have a Phase 1 computer). Agent-level metrics without a computer
  (`escalation_rate`, `escalation_accuracy`, `rejection_rate`, `qa_score_avg`,
  `golden_rules_avg`, `reopen_rate`, `fcr_rate`) are skipped gracefully — they were
  out of scope for Phase 1's computer set and remain so here.
- **Manual / non-Jira spaces (CS, KAM, Onboarding, Comms) are not captured.** They
  have no computed metrics; their data lands via Phase 4 manual entry/import, which
  is explicitly out of scope. The daily report omits non-Jira spaces.
- **Pause-status subtraction is not applied at capture.** SLA timings use gross
  business minutes (same Phase 1 limitation — no status-change history in
  `jira_issue_cache`). The business-hours engine supports paused intervals; wiring a
  changelog source is future work.
- **No views, manual entry, AI digest, or admin UI** were built — deliberately out
  of Phase 2 scope. Only API endpoints were added.
- **n8n trigger itself was not modified.** The endpoint it is meant to call now
  exists and is documented; rewiring the n8n workflow is an operational step, not a
  code change in this repo.

---

## 3. Assumptions required

1. **EOD trigger time = `kpi_spaces.biz_hours_end`.** The design fixes UK at 17:30
   and STBY at 18:00, which exactly match the seeded business-hours ends. Deriving
   the trigger from stored config (rather than a hardcoded clock) keeps it
   configurable and automatically correct per space — including STBY's India EOD.
2. **"Freeze snapshots → daily" is implemented as a fresh compute at the EOD
   instant.** Computing the metrics at 17:30/18:00 is equivalent to freezing the
   snapshot taken at that moment, and stays correct even when the 3-minute snapshot
   job did not run in the evaluation window. `kpi_snapshots` is left as the
   intermediate point-in-time series; `kpi_daily` holds the official EOD value.
3. **Amber band semantics.** Per the schema comment, `amber_band` is a *percentage
   deviation* off the target. Amber is the band on the "bad" side of the target as
   chosen by metric `direction`. When `target = 0` (e.g. `queue_over_sla`), the
   percentage band collapses to 0, so 0 = green and any breach = red — a defensible
   reading of a zero target.
4. **Tier rows share the space-metric target.** `kpi_space_metrics` holds one target
   per (space, metric); per-tier `kpi_daily` rows reuse it for RAG. Per-tier targets
   live in `kpi_tier_definitions` as SLA minutes and already feed the computers.
5. **EOD ticket-state groups by (tier, status, request_type).** A pragmatic grouping
   that matches the `kpi_eod_snapshot` columns; over-SLA uses the tier-resolved
   resolution target via the business-hours engine.

---

## 4. Readiness for independent evaluation

**Ready for independent behavioural evaluation.**

- Server build is clean (`tsc -p tsconfig.server.json`, 0 errors).
- The foundation mounts unconditionally (Phase 1 pattern), so the new endpoints and
  the EOD scheduler are live wherever the NOVA main pool is reachable.
- Observable surfaces for an evaluator (running software only):
  - `GET /api/kpi/health` — proves the EOD job is registered/running (`eodScheduler`).
  - `POST /api/kpi/eod-capture` — deterministically captures (optionally
    `{ spaceKey, date }`) without waiting for 17:30/18:00.
  - `GET /api/kpi/daily-report/:date`, `/daily/:space/:date`, `/agent/:space/:date`,
    `/eod/:date` — return the frozen official data and RAG.
- The legacy KPI system (n8n workflow, `techservicesjsm` tables, `/api/kpi-data/*`,
  legacy `POST /api/kpi/derived/run`) is untouched and continues to run in parallel.

### Suggested evaluation entry points (behavioural, no code inspection needed)

1. `POST /api/kpi/eod-capture` with `{ "spaceKey": "NT" }`, then
   `GET /api/kpi/daily-report/<today>` — confirm NT has daily rows with values,
   targets, and RAG; agent rows present; EOD snapshot populated.
2. Repeat the capture and confirm row counts do not double (idempotency).
3. `GET /api/kpi/health` — confirm `eodScheduler.registered = true`.
4. Spot-check RAG: a metric at/above its target (higher-is-better) is green; just
   inside the amber band is amber; beyond it is red.
