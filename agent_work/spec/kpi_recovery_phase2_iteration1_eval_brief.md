# KPI Recovery Phase 2 Iteration 1 Evaluation Brief

## Work Package

`P2-WP1-ITER1` — Re-evaluation of Phase 2 capture observability recovery.

## Evaluator Role Boundary

Evaluate observable behaviour only. Do not inspect source code, implementation notes, or build reasoning. Judge the running system, its exposed services, and its observable database effects.

## Objective

Determine whether the new forced/operator-triggered capture path now makes the real Phase 2 freeze/write capability directly demonstrable, including idempotent recapture.

## Prior Failure To Retest

The previous evaluation failed because:

- all frozen output tables remained empty
- the core freeze/write path could not be demonstrated within the Saturday evaluation window
- no operator-facing trigger existed to force capture

This re-evaluation must explicitly confirm whether that failure mode is gone.

## Scope

Evaluate only the Phase 2 freeze/capture path and the iteration’s observability recovery:

- forced/on-demand capture behaviour
- writes into `kpi_daily`
- writes into `kpi_agent_daily` for in-scope implemented agent metrics
- writes into `kpi_eod_snapshot`
- RAG persistence on frozen rows
- idempotent recapture behaviour
- daily-report payload after capture
- coexistence with the untouched legacy KPI system

## Observable Evaluation Questions

1. Does the operator-facing trigger now cause the real freeze path to write rows into `kpi_daily`?
2. Does it write rows into `kpi_agent_daily` for the implemented agent metrics in scope?
3. Does it write rows into `kpi_eod_snapshot`?
4. Are frozen daily rows persisted with RAG values?
5. Does `GET /api/kpi/daily-report/:date` reflect the frozen outputs after capture?
6. Does repeated forced capture converge idempotently instead of duplicating rows?
7. Does the iteration preserve scheduler behaviour for the normal gated path and legacy KPI non-regression?

## Known Bounded Non-Blocking Inputs

- Agent-daily outputs remain intentionally limited to implemented Phase 1 agent metrics.
- Manual/non-Jira spaces remain intentionally outside computed capture in this phase.
- Pause-status subtraction is still not wired because status-change history is not yet available in the cache path.
- Some spaces or metrics may still show empty values where source data is absent.

These are not automatic failures if the forced freeze/capture path itself is now observably correct.

## Deliverable

Write one markdown report to `agent_work/eval_output/phase2_iteration1_eval_report_2026-05-30.md` that states:

- pass / qualified pass / fail
- whether the prior failure mode is resolved
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether `P2-WP1-ITER1` closes the capture-observability loop and leaves Phase 2 converged for its scoped outcome
