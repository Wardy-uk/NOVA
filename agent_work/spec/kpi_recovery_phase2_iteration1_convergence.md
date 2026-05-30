# KPI Recovery Phase 2 Iteration 1 Convergence

## Work Package

`P2-WP1-ITER1`

## Observable Success Criteria

This recovery iteration is ready for re-evaluation when the evaluator can reasonably expect to observe, on demand:

1. a real trigger for the Phase 2 capture path
2. frozen writes landing in `kpi_daily`
3. frozen writes landing in `kpi_agent_daily` for in-scope implemented agent metrics
4. frozen writes landing in `kpi_eod_snapshot`
5. RAG persisted on frozen daily rows
6. repeated trigger execution converging idempotently
7. no material regression in the legacy KPI surface

## Failure Conditions

- capture remains dependent on narrow live schedule windows only
- frozen output tables remain unobservable after the new trigger path is exercised
- recapture still cannot be tested for idempotency

## Notes

This iteration does not need to close all previously declared bounded Phase 2 gaps. It only needs to make the core freeze/write path demonstrable and testable within the scoped slice.
