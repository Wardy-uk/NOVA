# KPI Recovery Phase 4 Iteration 1 Convergence

## Work Package

`P4-WP1-ITER1`

## Observable Success Criteria

This recovery iteration is ready for re-evaluation when the evaluator can reasonably expect to observe:

1. reachable manual load/prefill route(s)
2. reachable manual save route(s)
3. reachable import dry-run / real import route(s)
4. manual writes landing in `kpi_manual_entries`
5. promoted writes landing in `kpi_daily`
6. honest unmapped/rejected reporting
7. no material regression in the legacy KPI surface

## Failure Conditions

- write/import routes remain absent
- writes still cannot be observed
- promotion still cannot be observed
- the route surface remains ambiguous or silently unavailable

## Notes

This iteration does not need to solve all possible live-workbook mapping variation. It only needs to restore the real, observable Phase 4 write/import path so the scoped slice can be judged behaviourally.
