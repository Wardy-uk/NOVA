# P1-WP1 — Phase 1 Foundation Build Report

**Work package:** `P1-WP1` — Clean-sheet KPI foundation delivery
**Date:** 2026-05-29
**Scope source:** `KPI-Clean-Sheet-Design.md` (§2–§5, §8) + `agent_work/spec/kpi_recovery_phase1_build_brief.md`
**Build approach:** Everything new, nothing modified. Legacy KPI system left running in parallel and behaviourally untouched.
**Build status:** Server TypeScript compiles clean (`tsc -p tsconfig.server.json --noEmit` → 0 errors). Business-hours engine validated by DB-free unit checks (8/8 cases pass).

---

## 1. What was delivered

All new code lives under `src/server/services/kpi-engine/` (isolated module tree), one new route file, two backfill scripts, and a single wiring block in `index.ts`. Nothing in the legacy KPI path (`kpi-pipeline.ts`, `routes/kpi-data.ts`, `routes/trends.ts`, the n8n workflow, or the `techservicesjsm` tables) was changed.

### 1.1 Database schema — all `kpi_*` tables (design §3)
`src/server/services/kpi-engine/kpi-schema.ts` — idempotent DDL (`IF NOT EXISTS … CREATE`) in the **NOVA main MSSQL pool via `services/database.ts`**, matching the existing `schema.ts` migration style. Tables created:

`kpi_spaces`, `kpi_holidays`, `kpi_metric_definitions`, `kpi_space_metrics`, `kpi_tier_definitions`, `kpi_snapshots` (+2 indexes), `kpi_daily` (+1 index), `kpi_agent_daily` (+1 index), `kpi_eod_snapshot` (+1 index), `kpi_manual_entries`, `kpi_digests`.

All 11 tables use the `kpi_` prefix and `DATETIME2` timestamps. Run automatically at startup via `initKpiFoundation()`.

### 1.2 Seed data (design §2.1, §4, §3.5)
`kpi-catalogue.ts` (declarative data) + `kpi-seed.ts` (idempotent INSERT-if-missing):
- **8 spaces** — NT, NTPJ, STBY (Asia/Kolkata, 09:00–18:00), YO, CS, KAM, ONBOARD, COMMS — with timezone, business hours, weekend days, pause statuses, `has_tiers`, `is_jira_space`.
- **~90 metric definitions** — the full §4 catalogue (Jira-computed, NTPJ bespoke, AI, and all manual/business metrics for CS/KAM/Onboarding/Comms/Guild/Sales/Tech).
- **Per-space metric bindings** — `kpi_space_metrics` with seed targets and `show_on_slt_view` flags. NT gets the full Jira-computed + quality set; NTPJ adds story-point/velocity metrics; STBY/YO get the Jira core; manual teams get their respective metric sets.
- **Tier definitions** — NT `1st/2nd/3rd Line` (bound to `current_tier` values `Customer Care`/`Tier 2`/`Tier 3`) **plus** a `Standard` row per Jira space holding the configurable space-level SLA minute targets.

Seeding is **non-clobbering**: only missing rows are inserted, so runtime edits to targets / business hours / pause statuses survive restarts (keeps SLA targets configurable per §13.3).

### 1.3 Business-hours engine (design §2.2)
`business-hours.ts` — `calculateBusinessMinutes()`, `isBusinessHour()`, `nextBusinessStart()`. Timezone-aware (via `Intl.DateTimeFormat`), DST-correct, honours per-space working window, weekend days, and the `kpi_holidays` table. Accepts optional paused intervals for future SLA-pause subtraction. **Validated** (DB-free) for Europe/London (BST), Asia/Kolkata (IST), weekend skipping, cross-weekend accumulation, full working day (540 min), and holiday exclusion — all expected values returned.

### 1.4 Pluggable metric computation framework (design §5)
`metric-computers.ts` — a `computation_key → pure function` registry; `kpi-engine.ts` — the engine. The engine reads tickets **only** from `jira_issue_cache` + `jira_comment_cache` (NOVA-side cache path), derives first-public-comment time, CSAT (`customfield_12802`), story points (`customfield_11706`), labels, and the **CS/KAM classification** (design §13.2: `Key_Account`/`Enterprise_Account` ⇒ KAM, else CS). Per-tier breakdowns are produced for tier-aware metrics on tiered spaces (NT). SLA timings use the business-hours engine; SLA minute thresholds come from `kpi_tier_definitions` (configurable, never hardcoded).

**20 computers implemented:** `frt_compliance`, `resolution_compliance`, `frt_avg_minutes`, `resolution_avg_minutes`, `queue_total`, `queue_actionable`, `queue_over_sla`, `queue_no_reply_3d`, `queue_no_reply_5d`, `opened_today`, `resolved_today`, `oldest_actionable_hrs`, `sla_breach_count`, `backlog_age_avg_days`, `tickets_per_agent`, `csat_score`, `csat_response_rate`, `first_line_resolution`, `story_points_completed`, `story_points_remaining`.

### 1.5 Snapshot scheduler — 3-minute cycle (design §5.2)
`kpi-engine/index.ts` registers a `kpi-engine-snapshot` job on the existing `JobRegistry` at a **3-minute** interval, plus a 30s initial kick. Each cycle self-gates **per space to its own timezone compute window** (working window ±30/60 min buffer) and appends point-in-time rows to `kpi_snapshots` (one `snapshot_at` per cycle).

### 1.6 Foundation read API (`/api/kpi/*`)
`routes/kpi-engine.ts`, mounted `app.use('/api/kpi', …)` — `GET /spaces`, `GET /spaces/:key/metrics`, `GET /snapshot/:spaceKey`, `GET /health`, `POST /run-snapshot`. These make the new system observable/evaluable; they are **not** the Phase 3 dashboards. They coexist with the pre-existing legacy `POST /api/kpi/derived/run` (registered earlier, different path — verified no collision).

### 1.7 Backfill scripts (design §8)
- `scripts/kpi/backfill-legacy.ts` — reads the **legacy** KPI DB read-only and writes new tables: `jira_kpi_daily → kpi_daily` (name→metric_key map, NT) and `JiraEodTicketStatusSnapshot → kpi_eod_snapshot` (all known projects). Idempotent (MERGE / delete-then-insert), `--dry-run`, reports unmapped legacy names instead of guessing.
- `scripts/kpi/backfill-cache-sla.ts` — retroactive NT SLA (design §8.3) from `jira_issue_cache` using the business-hours engine, per historical date → `kpi_daily`. NOVA-only, `--dry-run`, reports date coverage.

Both run via `tsx` (excluded from the server build; do not affect compilation).

---

## 2. What remains incomplete / blocked / bounded

These are deliberately bounded per AGENTS.md §7 (log, don't expand mid-phase). None blocks the foundation being a coherent parallel system.

### 2.1 Metrics seeded but with no Phase 1 computer (skipped gracefully)
Definitions exist; the engine skips any metric whose `computation_key` has no registered computer, so no bad data is written:
- **Needs Jira changelog (not in cache):** `escalation_rate`, `escalation_accuracy`, `rejection_rate`, `reopen_rate`.
- **Needs comment-thread analysis / other pipelines:** `fcr_rate`, `bug_escalation_ack_hrs`, `qa_score_avg`, `golden_rules_avg`.
- **Needs sprint/agent telemetry:** `sprint_velocity`, `sprint_burndown_pct`, `ai_tickets_handled`, `ai_accuracy_rate`, `ai_autonomy_rate`, `ai_cost_per_ticket`.

### 2.2 Manual-team metrics (CS/KAM/Onboarding/Comms)
Spaces, metric definitions, and bindings are seeded, but values are **not** computed (these are `source = 'manual'`). Manual entry / spreadsheet import is explicitly Phase 4 and out of scope.

### 2.3 Backfill coverage
- **Implemented:** `jira_kpi_daily → kpi_daily` (mapped subset), `JiraEodTicketStatusSnapshot → kpi_eod_snapshot` (full), retroactive cache SLA → `kpi_daily`.
- **Not implemented (bounded, documented):** `KpiSnapshot → kpi_snapshots`, `jira_agent_kpi_daily → kpi_agent_daily`, `jira_qa_results`/`Jira_QA_GoldenRules → kpi_agent_daily`. These legacy schemas vary (column-per-KPI vs row-per-KPI) and require live schema confirmation before a safe column→metric_key map can be written; the build agent did not guess them. The two delivered scripts establish the pattern (read legacy read-only, upsert NOVA) for these to follow.

### 2.4 SLA pause handling
The engine computes **gross** business minutes. Pause-status subtraction (e.g. "Waiting for Customer") is supported by `calculateBusinessMinutes`'s `pausedIntervals` parameter, but the engine does not yet supply intervals because `jira_issue_cache` has no status-change history. `pause_statuses` are seeded and ready; wiring the subtraction requires changelog capture (future).

### 2.5 Phase 0 data caveats (carried forward, honestly reported)
- **NTPJ story points are zero at source** — capture path (`customfield_11706`) is in place; `story_points_*` will read 0 until the team enters points in Jira.
- **STBY has zero rows in `jira_issue_cache`** — STBY metrics will be empty until STBY is added to the sync scope (a settings change, not code).
- **A sync cycle is required** before `resolved_at` and `customfield_11706` fully populate the cache; until then resolution-based and story-point metrics under-report. The snapshot job will reflect real values automatically once the cache fills.

---

## 3. Assumptions required

1. **SLA-minute targets live in `kpi_tier_definitions`.** The design defines tiers as NT-only, but provides no other configurable home for per-space SLA minute thresholds. A `Standard` tier row (`tier_order 0`, `jira_field_value = NULL` = all tickets) is seeded for every Jira space to hold its space-level FRT/resolution minute targets. This keeps SLA targets fully configurable in-DB (no hardcoding) while per-tier **breakdown** rows are emitted only for `has_tiers = 1` (NT).
2. **NT tier names → cache values.** Design names tiers `1st/2nd/3rd Line`; these are bound to the actual `jira_issue_cache.current_tier` values `Customer Care` / `Tier 2` / `Tier 3` so per-tier computation can filter. `Production`/`Development` tickets are still counted at space level.
3. **Foreign keys omitted.** The design shows FKs; they were intentionally left as soft references so backfill ordering stays flexible and a partial legacy import cannot fail on FK violations. Uniqueness constraints (the correctness-critical ones) are retained.
4. **`kpi_snapshots` is append-only** point-in-time (the design calls it "upsert" but the schema is an identity series keyed by `snapshot_at`); one row set per 3-min cycle.
5. **Foundation read routes** were added under `/api/kpi/*` so the new system is observable for evaluation. They are minimal introspection endpoints, not Phase 3 views, and were confirmed not to collide with the legacy `/api/kpi/derived/run`.
6. **Compute window** is enforced per-space in the space's own timezone (so STBY snapshots during IST hours, UK spaces during BST/GMT hours), rather than a single UK window.

---

## 4. Constraint compliance

| Constraint | Status |
|---|---|
| Everything new; legacy KPI untouched | ✅ New module tree + 1 additive wiring block; no legacy file behaviour changed |
| New tables in NOVA DB via `services/database.ts` | ✅ All DDL/seed go through the main pool helpers |
| Never reference forbidden tables (`JiraSlaRaw*`, `JiraTickets*`) | ✅ Engine reads only `jira_issue_cache`/`jira_comment_cache`; backfill reads only `jira_kpi_daily`/`JiraEodTicketStatusSnapshot` |
| All new tables use `kpi_` prefix | ✅ 11/11 |
| SLA targets configurable, not hardcoded | ✅ Stored in `kpi_tier_definitions` / `kpi_space_metrics`; computation reads them |
| CS/KAM label logic per design | ✅ `Key_Account`/`Enterprise_Account` ⇒ KAM, else CS (implemented in ticket model) |
| Do not start Phase 2/views/manual entry/import/digests/admin UI | ✅ Not started (definitions seeded only where Phase 1 requires) |

---

## 5. Is `P1-WP1` ready for independent evaluation?

**Yes — ready for evaluation, with the residual gaps in §2 explicitly bounded.**

The complete Phase 1 foundation is present as a **coherent new parallel system**: all `kpi_*` tables, the seeded spaces/metrics/bindings/tiers, a validated business-hours engine, a pluggable computation framework on the NOVA cache path, the 3-minute snapshot scheduler, foundation read APIs, and legacy backfill scripts — built entirely alongside the untouched legacy KPI system. The server compiles with zero TypeScript errors and the business-hours engine passes its unit checks.

**Two honest caveats for the evaluator's environment:**
- Runtime population of computed snapshots depends on a live NOVA DB **and at least one Jira sync cycle** having run since the Phase 0 `resolved_at` / `customfield_11706` fix. Before that, resolution-based and story-point metrics will read low/zero — this reflects source-data readiness, not a foundation defect.
- STBY and the manual teams will show empty computed data by design (STBY not yet in sync scope; manual teams are Phase 4 entry).

No live end-to-end run against production data was performed in this build (the Build Agent does not self-certify behaviour against evaluation criteria — that is the Evaluator's role).
