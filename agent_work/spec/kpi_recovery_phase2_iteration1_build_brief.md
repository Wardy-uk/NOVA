# KPI Recovery Phase 2 Iteration 1 Build Brief

## Work Package

`P2-WP1-ITER1` — Make the Phase 2 freeze/capture path directly exercisable and observable.

## Objective

Recover the scoped Phase 2 slice so the evaluator can actually demonstrate the core EOD freeze/write capability on demand, rather than waiting for a narrow weekday/timezone window.

## Background

Independent evaluation failed `P2-WP1` on 2026-05-30.

The evaluator confirmed that:

- schema, seeds, schedulers, STBY timezone handling, daily-report honesty, and legacy non-regression all looked correct
- but the central Phase 2 behaviour was not observable because:
  - evaluation occurred on a Saturday
  - no operator-facing capture/recompute trigger existed
  - all frozen output tables remained empty, so idempotent recapture and frozen output correctness could not be tested

This is a testability and observability blocker inside current scope, not a reason to broaden the phase.

## Required Behavioural Outcome

The clean-sheet KPI system must expose a bounded operator-facing way to trigger or re-trigger the Phase 2 capture path so the evaluator can observe:

1. writes into `kpi_daily`
2. writes into `kpi_agent_daily`
3. writes into `kpi_eod_snapshot`
4. RAG persistence on frozen daily rows
5. idempotent recapture behaviour

## Scope

This is a recovery iteration for capture observability and operator-triggered execution only.

## In Scope

- bounded work needed to expose a real operator-facing trigger for capture/recompute/backfill of the scoped Phase 2 outputs
- bounded work needed so the evaluator can observe frozen writes without waiting for natural weekday EOD
- bounded work needed so repeated trigger execution can be assessed for idempotency

## Out Of Scope

- new metric families
- Phase 3 views
- Phase 4 manual/import flows
- AI digests or admin UI
- broad backfill expansion beyond what is needed to exercise the scoped Phase 2 freeze path
- reopening optional Phase 1 auth-route evidence cleanup

## Constraints

- Keep the legacy KPI system behaviourally untouched.
- Keep this iteration tightly focused on making the existing Phase 2 slice demonstrable.
- Do not consume evaluator holdouts.
- Do not broaden the work because the evaluator ran on a Saturday.

## Deliverable

Write one markdown completion report to `agent_work/build_status/p2-wp1-iter1-capture-observability-2026-05-30.md` that states:

- what operator-facing trigger/execution path now exists
- how it allows the evaluator to observe frozen writes and idempotent recapture
- any remaining bounded gap
- whether the work package is ready for re-evaluation
