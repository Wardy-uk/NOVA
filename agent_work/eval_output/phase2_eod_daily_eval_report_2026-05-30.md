# Phase 2 — EOD & Daily Capture Evaluation

**Work Package:** `P2-WP1`
**Date:** 2026-05-30 (Saturday)
**Evaluator stance:** Observable behaviour only. No source code, implementation notes, diffs, or build reasoning inspected. Evidence drawn from (a) the running server's operator-visible boot log, (b) the live authenticated `/api/kpi/*` HTTP surface on `localhost:3001`, and (c) direct read of the exposed NOVA database (`bym-asqlep01` / `NOVA` pool). One narrow, explicitly user-authorised exception was used to obtain a JWT (auth credential only — not KPI implementation logic).

---

## Verdict: **FAIL — NOT CONVERGED** for the scoped Phase 2 outcome

**Read this verdict precisely.** It is a *failure to demonstrate the central capability*, **not** a demonstrated engine defect. Everything that could be observed is correct, coherent, honest, and well-isolated from legacy. But the defining Phase 2 outcome — **freezing official daily outputs into `kpi_daily` / `kpi_agent_daily` / `kpi_eod_snapshot`, with RAG applied and idempotent recapture** — **could not be observed at all**, because:

1. The evaluation window is a **Saturday** (business-day / EOD-time gated capture does not fire), and
2. There is **no operator-accessible trigger** to force a capture/recompute for an out-of-window date (the design's own `POST /api/kpi/recompute/:date` and `POST /api/kpi/backfill` return **404 — not implemented**), and
3. Phase 2 has **never executed a weekday EOD against this database** (kpi_daily holds **0 rows for every date**, and the branch is not deployed).

Per the Phase 2 standard, a **qualified pass** is explicitly only available "when the core freeze/capture path is *observably correct*." It is not observably correct here — it is observably *present and correctly shaped*, but never seen to write a single frozen row. The standard's fail-trigger — *"official daily outputs are not actually written"* — is, as a matter of observable fact, true (zero rows, all dates). Convergence therefore cannot be certified: the methodology forbids treating a workstream as converged merely because "the implementation appears logically correct."

**This is recoverable with little or no engineering** (see *Path to convergence*).

---

## What observable behaviour WAS verified (and is correct)

### 1. Daily-report payload endpoint is present and correctly structured
`GET /api/kpi/daily-report/:date` returns `200` with a coherent per-space payload:

```
reportDate, generatedAt, spaces[ { spaceKey, displayName, timezone, eodTime,
  captured, metrics[], ragSummary{green,amber,red,none},
  eodSnapshot{snapshotTime,totalTickets,overSla,groups[]}, agents[] } ]
```

- It **reads from the frozen tables** rather than live-computing: with nothing frozen it honestly reports `captured: false`, empty `metrics`, and zero `ragSummary` — it does not fabricate values from the live cache (which holds 2121 tickets). The shape is correct; *populated-from-frozen-data could not be confirmed because nothing is frozen.*
- It is correctly **scoped to the four Jira spaces** (NT, NTPJ, STBY, YO). Manual/non-Jira teams (CS, KAM, COMMS, ONBOARD) are excluded from computed capture — matching the pre-declared bounded scope.

### 2. STBY timezone-specific handling is preserved (NOT collapsed to UK)
A fail-trigger for this WP is "STBY handling collapses into UK-only behaviour." It does **not**. STBY is observably distinct everywhere it surfaces:

| Field | UK spaces (NT/NTPJ/YO) | STBY |
|---|---|---|
| `timezone` | Europe/London | **Asia/Kolkata** |
| `eodTime` / `snapshotTime` | 17:30 | **18:00** |
| business hours (mins) | 510–1050 (08:30–17:30) | **540–1080 (09:00–18:00)** |

This distinction is consistent across `/api/kpi/spaces`, `/api/kpi/eod/:date`, and the daily-report payload.

### 3. RAG configuration inputs are stored per space-metric (not hardcoded)
`GET /api/kpi/spaces/NT/metrics` returns 26 enabled metrics, each carrying the inputs RAG depends on, sourced from stored config:
- `direction` (higher/lower) — present on **26/26**
- `amberBand` — present on **26/26** (e.g. 10)
- `targetValue` — present on **13** (e.g. `queue_total`→30, `queue_over_sla`→0, `frt_compliance`→90); remainder `null` (= no target), correctly nullable.

STBY exposes 17 enabled metrics (fewer, no tiers). The RAG *inputs* are observably per-space, configurable, and stored. **What could not be observed is RAG *applied* to real captured values** — there is no `rag_status` to inspect because no capture has run.

### 4. Engine substrate is active, seeded, and self-reporting
Boot log + `GET /api/kpi/health` (200):
- `kpi_* schema ensured (16 statements, 0 failures)`; **11/11 tables present**.
- Seeds: **8 spaces, 88 metrics, 125 space-metrics, 7 tiers** (DB-confirmed: spaces 8 / definitions 88 / space_metrics 125).
- **Snapshot scheduler** registered (interval 180000 ms; runCount incrementing).
- **EOD scheduler** registered (`kpi-engine-eod`, interval 300000 ms; runCount 1; `lastError: null`).
- Health honestly self-reports `snapshots.rows: 0`.

### 5. Coexistence with the legacy KPI system — no regression observed
- The new system is **fully additive and isolated**: new routes under `/api/kpi/*`, new `kpi_*` tables in the NOVA main pool, separate from the legacy `techservicesjsm` pipeline pool.
- The full server booted normally around the KPI engine (wallboard live-cache refreshed KA 73 / CS 274 tickets, 576 milestones re-synced, 25 users seeded, API listening) — the activation did not break the broader app.
- Direct DB read confirms the source/legacy cache is intact and healthy: `jira_issue_cache` = **2121 rows** (NT 908, YO 818, NTPJ 395).
- No evidence of any legacy structure being dropped, rewritten, or clobbered.

---

## Material blocker

**The EOD freeze/write path is unobservable in this evaluation window, and cannot be exercised on demand.**

Observable facts:
- `kpi_daily = 0`, `kpi_agent_daily = 0`, `kpi_eod_snapshot = 0`, `kpi_snapshots = 0` — **for every date probed** (2026-05-30, 2026-05-29, 2026-05-28/27/26, 2026-05-22/21/20, 2026-05-15, 2026-05-08 all return `captured:false`, 0 metrics, 0 agents). `kpi_daily` holds no rows for any date at the DB level.
- No capture/recompute trigger exists. Probed and 404: `POST /api/kpi/recompute/:date`, `POST /api/kpi/backfill`, and ~25 other plausible capture/run/trigger paths. `GET …/daily-report/:date?capture=1` has no side effect. The only capture mechanism is the time-gated `kpi-engine-eod` scheduler, which on a Saturday before any space's EOD time legitimately writes nothing.
- Source data is present (2121 cached tickets for NT/NTPJ/YO), so the emptiness is **timing + absent trigger**, not absent data.

Consequently the following pass-standard items **could not be validated**:
- (1) EOD capture writing official rows into `kpi_daily`
- (2) agent rows into `kpi_agent_daily`
- (3) ticket-state into `kpi_eod_snapshot`
- (4) RAG *applied* from stored targets/amber/direction to real values
- (5) daily-report *populated from* frozen outputs
- (6) idempotent recapture convergence

---

## Bounded non-blocking gaps (pre-declared; not the reason for the verdict)

- **Agent-daily limited to implemented Phase 1 agent metrics** — could not be observed at all (agents `[]`), so neither confirmed nor contradicted.
- **Manual/non-Jira spaces outside computed capture** — confirmed honoured: CS/KAM/COMMS/ONBOARD are `isJiraSpace:false` and absent from the daily-report.
- **Pause-status subtraction not yet wired** — pause statuses are *configured* per space (e.g. STBY: `["waiting for customer","pending","on hold","waiting on requestor"]`) but application is unobservable without a capture.
- **Empty data legitimate for STBY / some metrics** — corroborated: `jira_issue_cache` has **0** STBY rows, so STBY would legitimately produce empty computed output even on a weekday.

These are genuinely bounded. **They are not what blocks convergence** — the blocker is that the *core* freeze/write could not be observed at all.

---

## Path to convergence (small)

Any one of the following unblocks a clean re-evaluation, almost certainly to a pass or qualified pass:

1. **Expose an operator-accessible capture/recompute trigger** (the design already specifies `POST /api/kpi/recompute/:date` and `POST /api/kpi/backfill` — currently 404). This lets the freeze be exercised and observed on demand for any date, independent of weekday/time. *Strongly recommended* — it also gives operators backfill/recapture and makes idempotency directly testable.
2. **Re-run this evaluation on a weekday after the EOD window** (≥17:30 UK for NT/NTPJ/YO; ≥18:00 IST for STBY) so the `kpi-engine-eod` scheduler captures naturally.

A re-evaluation then needs to confirm, observably: rows written to all three frozen tables for in-scope spaces, `rag_status` matching each metric's stored target/amber/direction, the daily-report flipping to `captured:true` with populated metrics, and a second capture for the same date converging (no duplicate rows) rather than duplicating.

---

## Convergence assessment

**`P2-WP1` is NOT converged for its scoped Phase 2 outcome.**

The Phase 2 substrate is genuinely in good shape — the daily-report endpoint is present and correctly structured, STBY's timezone-specific EOD is preserved (not collapsed), RAG configuration inputs are stored per space-metric, manual-team scoping is honoured, and the legacy system is untouched and isolated. **But the central deliverable — actually freezing official daily outputs, applying RAG, and converging idempotently — was never observed, because no capture has occurred and there is no way to make one occur within the source-blind, weekend evaluation window.** Convergence cannot be certified on a capability that could not be exercised. The remediation is small (add the already-designed trigger, or evaluate on a weekday post-EOD), and on that basis a follow-up iteration is very likely to converge.
