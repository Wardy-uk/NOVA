# KPI Recovery Phase 1 Iteration 1 Convergence

## Work Package

`P1-WP1-ITER1`

## Observable Success Criteria

This recovery iteration is ready for re-evaluation when the evaluator can reasonably expect to observe:

1. `kpi_*` tables created in the NOVA pool
2. seeded space/metric/binding/tier rows present
3. a registered and observable foundation snapshot execution path
4. reachable `/api/kpi/*` foundation routes
5. clear surfaced success or failure for foundation initialisation
6. no material regression in the legacy KPI surface

## Failure Conditions

- foundation still leaves no schema or seeds in runtime
- routes are still unreachable
- scheduler is still absent
- activation still fails silently

## Notes

This iteration does not need to close every previously declared bounded Phase 1 gap. It only needs to restore honest, observable activation of the scoped foundation so Phase 1 can be judged on its actual delivered surface.
