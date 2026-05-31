# KPI Escalation Capture Hardening — rejection / bounce-back source (KPX-WP5)

**Work package:** `KPX-WP5` — escalation source capture hardening
**Date:** 2026-05-31
**Agent:** Build Agent (Claude Code)
**Basis:** `agent_work/build_status/kpi_replacement_source_wiring_2026-05-31.md` (KPX-WP3) + eval findings `kpi_replacement_source_wiring_eval_2026-05-31.md` and `kpi_qa_parity_screen_eval_2026-05-31.md`
**Scope discipline:** source capture/hardening only. No Escalations parity screen, no engine rewrite, no holdout consumption, no forbidden tables, no fabricated values. Additive, localised edits reusing the existing escalation-log and pluggable-computer patterns.

---

## 0. Summary

KPX-WP3 left exactly one well-defined gap standing between the platform and Escalations parity: the clean-sheet store had **no rejection / bounce-back concept**, so `rejection_rate` and `escalation_accuracy` could not be sourced honestly and stayed unwired. This slice closes that gap by adding a **real, explicit rejection capture path** and wiring both metrics to it.

| Metric | Before (KPX-WP3) | After (KPX-WP5) |
|---|---|---|
| `rejection_rate` | Unwired (no rejection signal) | **Wired** to captured `rejection` events |
| `escalation_accuracy` | Unwired (defined in terms of rejections) | **Wired** to captured escalation − rejection counts |

The capture path is an **explicit event** (`escalation_type = 'rejection'` in `escalation_log`), recorded only when a rejection actually happens — it is **not** inferred from ambiguous tier-move heuristics, which KPX-WP3 §4.1 correctly flagged as effectively fabricated. Until a real rejection is captured, both metrics render `—` (wired, awaiting capture) rather than a fabricated `0% / 100%`.

- **No forbidden table touched.** The deprecated `JiraTickets.*RejectionAt` columns are not read. The only store used is NOVA's own clean-sheet `escalation_log`.
- **No schema migration.** `escalation_log.escalation_type` is already `NVARCHAR(30)`; `'rejection'` fits the existing column and the existing index.
- **Legacy KPI behaviour untouched.** The legacy KPI pipeline (`kpi-pipeline.ts`, `/api/kpi-data/*`) is not referenced or altered.
- Server typecheck (`tsc -p tsconfig.server.json --noEmit`) is **clean**. Full typecheck shows the **single pre-existing** error in untouched `kpi-pipeline.ts:1043`; **0 errors in any file touched here.**

---

## 1. Escalation capture / source changes made

### 1.1 A real, explicit rejection capture path (the core change)

Rejections are now first-class events in the clean-sheet escalation store:

- **`escalation_type` enum extended** with `'rejection'` (`LogEscalationInput`).
- **`EscalationLogService.logRejection()`** — a dedicated capture method that writes a bounce-back event using the existing `escalation_log` columns: `from_tier`/`to_tier` carry the tier movement (returned **from** the higher tier **to** the lower tier), `escalated_by` = who rejected it, `assigned_to` = where it was returned. It delegates to the existing `log()` insert, so it inherits the same idempotent, indexed write path as every other escalation event.
- **`POST /api/escalations/rejection`** (role `editor`/`admin`/`super_admin`) — the HTTP capture surface. It requires a `ticket_key`, stamps the rejecting user from `req.user`, and records the event. This makes it *possible* for the existing escalation surfaces (manual SOP gate, AI agent, complaint/portal flows) and any operator action to log a rejection at the moment it happens.

**Why explicit, not inferred:** the legacy `Rejection` KPI was an explicit timestamp set by a rejection action (`Tier2RejectionAt` etc.), not "any downward tier move." A downward `Current Tier` change is **not** equivalent to a rejection (tickets move down for legitimate reassessment too), and KPX-WP3 already established that `from_tier`/`to_tier` values are a mix of normalised codes and raw Jira strings — so a tier-rank heuristic would be both fragile and a different concept. Recording an explicit `rejection` event is the honest clean-sheet equivalent and the only path that does not fabricate.

### 1.2 Read-path wiring: partition rejections out of escalations

- **`source-providers.ts`** — `fetchEscalations` now reads the same `escalation_log` ⋈ `jira_issue_cache` (project-scoped) query, but **partitions** the rows into genuine escalations (`escalation_type <> 'rejection'`) and rejection events (`escalation_type = 'rejection'`). This guarantees bounce-backs **never inflate `escalation_rate`** once they start being captured.
- **`MetricSourceContext`** gained `rejections: EscalationEvent[]` and `rejectionAvailable: boolean`. `rejectionAvailable` is set **only when the query succeeded *and* at least one rejection event exists in window** — the deliberate honesty gate (see §1.4).
- **Fetch gating** — `ESCALATION_METRIC_KEYS` now includes `rejection_rate` and `escalation_accuracy`, so the single escalation fetch is triggered when any of the three escalation-family metrics is enabled. Spaces without them still pay zero extra query cost.

### 1.3 Two new computers (same issueKey-intersection pattern as KPX-WP3)

- **`rejection_rate`** = `rejections on in-scope tickets / in-scope tickets × 100` (direction `lower`). Returns `null` unless `rejectionAvailable`.
- **`escalation_accuracy`** = `(escalations − rejections) / escalations × 100` (direction `higher`) — the proportion of escalations that were **not** bounced back. This mirrors the legacy definition (`(esc.total − rej.total) / esc.total`) but sources both counts from clean-sheet `escalation_log` instead of `JiraTickets`. Returns `null` unless **both** escalation and rejection sources are available, and `null` when there are zero escalations (accuracy is undefined, never a fabricated `100`). The numerator is clamped at `0` so a window-boundary mismatch can't produce a negative percentage.

Both computers intersect their source rows with the ticket subset they are handed, so the **same** computer is correct for space-level (Team Dashboard) and per-agent (Agent Scorecard / EOD freeze) with no name↔accountId mapping — identical to the KPX-WP3 escalation/QA computers.

### 1.4 Honesty gate — empty/unwired behaviour preserved

The distinction between "no rejections among these tickets" and "rejection capture isn't happening at all" is handled explicitly:

- The rejection capture path is **brand new and currently has no automated writer**, so treating an empty rejection store as a genuine `0%` rejection (the way `escalation_rate` treats an empty-but-readable escalation store) would read as misleadingly healthy.
- Therefore `rejectionAvailable` is `false` until at least one rejection event lands. While false, **both** `rejection_rate` and `escalation_accuracy` return `null` → the engine/EOD skip them → they render `—` (wired, awaiting capture). This is exactly the QA-family "wired but unpopulated" behaviour the KPX-WP4 eval blessed as honest.
- Once real rejection events are captured, `rejectionAvailable` flips true and the metrics compute real values — including a genuine `0%` for a ticket subset with no rejections while other subsets carry their real rate.

### 1.5 Existing escalation report semantics preserved

`EscalationLogService.getStats` (the existing `/api/escalations/stats` surface) now excludes `escalation_type = 'rejection'` from its escalation totals, rate, and breakdowns, so introducing rejection rows does **not** retroactively inflate the existing escalation report. No behavioural change today (zero rejection rows exist), correct semantics tomorrow.

---

## 2. Files changed

- **`src/server/services/escalation-log-service.ts`** — added `'rejection'` to the `escalation_type` union; new `LogRejectionInput` + `logRejection()`; excluded `rejection` rows from `getStats` totals/rate/breakdowns.
- **`src/server/routes/escalation.ts`** — new `POST /rejection` capture route.
- **`src/server/services/kpi-engine/types.ts`** — `MetricSourceContext` gained `rejections` + `rejectionAvailable`; doc note on `EscalationEvent` partitioning.
- **`src/server/services/kpi-engine/source-providers.ts`** — `fetchEscalations` partitions escalations vs rejections; `buildSourceContext` populates the new context fields with the availability gate; `ESCALATION_METRIC_KEYS` extended.
- **`src/server/services/kpi-engine/metric-computers.ts`** — added `rejection_rate` and `escalation_accuracy` computers; registered both; `escalation_rate` comment updated to note rejection rows are already partitioned out.

No schema, seed, catalogue, binding, route-contract, or client changes. No API response shape changed. No forbidden table referenced. The catalogue already defined both metrics' `computation_key`, `direction`, and NT bindings (`escalation_accuracy` target 90, `rejection_rate` target null) — registering the computers is all that was needed to flip them from unwired to wired.

---

## 3. Previously-unwired escalation metrics now live

| Metric | Space | What now happens |
|---|---|---|
| `rejection_rate` | NT | Wired to captured `rejection` events. Leaves the unwired set automatically (admin health filters on `hasComputer`). Renders `—` until rejections are captured, then a real % per ticket population. |
| `escalation_accuracy` | NT | Wired to `(escalations − rejections) / escalations`. Leaves the unwired set. Renders `—` until both escalations and captured rejections exist, then a real %. |

Effect on surfaces (no screen rebuilds):
- **NT Team Dashboard / Config & Health → "Unwired metrics":** NT's unwired count drops by 2 (the KPX-WP3 list `bug_escalation_ack_hrs, escalation_accuracy, fcr_rate, rejection_rate, reopen_rate` loses `escalation_accuracy` and `rejection_rate`, leaving `bug_escalation_ack_hrs, fcr_rate, reopen_rate`).
- **Agent Scorecard:** both are agent-level, so they freeze per-agent at EOD via the same issueKey intersection once rejection data exists.
- Until a rejection is captured, the cells correctly read `—` — honest, not fabricated.

---

## 4. Metrics that remain unwired — and why (honest classification preserved)

- **`fcr_rate`, `reopen_rate`, `bug_escalation_ack_hrs` (NT)** and **`sprint_velocity`, `sprint_burndown_pct` (NTPJ)** — out of this slice's scope; each needs its own distinct source (changelog/reopen detection, bug-ack timing, Jira Agile sprint data). They retain their "not wired" rendering and stay on the Config & Health unwired list.
- **Data-presence honesty for the two now-wired metrics:** they are *structurally* wired but will read `—` in any environment where no rejection events have yet been captured (the capture path has no automated writer in this slice — deliberately, to avoid heuristic fabrication). This is the same wired-but-awaiting-data condition the KPX-WP3 and KPX-WP4 evals recorded for the escalation/QA families, not a wiring defect. The wiring is real; populating it is now a matter of routing real rejection actions through the new capture path.

---

## 5. Verification

- **Server typecheck:** `tsc -p tsconfig.server.json --noEmit` → **0 errors.**
- **Full typecheck:** `tsc -p tsconfig.json --noEmit` → 1 error total, **pre-existing** in untouched `kpi-pipeline.ts:1043`; **0 in any file touched here.**
- **No forbidden-table reference:** only `escalation_log` + `jira_issue_cache` (NOVA pool) are read — neither on the forbidden list; `JiraTickets.*` is not referenced.
- **No regression:** `escalation_rate` is unchanged in any current environment (zero rejection rows ⇒ identical partition result); the existing escalation report excludes rejections so its numbers are unchanged.
- **Behavioural checks (Eval Agent, running software only):**
  - `GET /api/kpi/team/NT` → `rejection_rate` and `escalation_accuracy` now report `unwired:false` (were `true`); `value:null` until rejection events exist (honest, not `0`/`100`).
  - `GET /api/kpi/admin-health` → NT `unwiredBindings` no longer lists `rejection_rate` / `escalation_accuracy`.
  - `POST /api/escalations/rejection` with `{ ticket_key }` → `200 { ok:true, data:{ id } }`; without auth → `401`; without `ticket_key` → `400`.
  - `GET /api/escalations/stats` → escalation totals/rate unchanged (rejection rows excluded).
  - After a rejection is captured for an in-scope NT ticket and an EOD freeze runs, the two metrics carry real values; `escalation_rate` is unaffected by the rejection row.

---

## 6. Recommendation — next best step

**Escalations parity-screen delivery is now unblocked — deliver it next.**

KPX-WP3 deferred the Escalations screen specifically because the two metrics it most needs to be useful (`escalation_accuracy`, `rejection_rate`) were source-blocked. That block is now removed: both are wired to a real clean-sheet capture path, joining the already-wired `escalation_rate`. The Escalations parity surface can therefore be built against a complete, honest escalation family (rate + accuracy + rejection), exactly mirroring the QA parity screen pattern (KPX-WP4) — it will open as a correct wired-but-awaiting-data surface and populate the moment rejection events flow.

No further source-hardening slice is required for the escalation family. The remaining gaps (`fcr_rate`, `reopen_rate`, `bug_escalation_ack_hrs`, NTPJ sprint metrics) are independent, each gated on its own distinct source, and should be sequenced separately rather than bundled into Escalations work.

One operational note for the manager (not a build gap): the rejection capture path now exists but has no automated writer. Routing real rejection actions into `POST /api/escalations/rejection` (from the manual SOP gate / AI agent / portal flows) is what turns the wired metrics from `—` into live values — that integration is the natural companion to the Escalations parity screen, not a prerequisite for building it.
