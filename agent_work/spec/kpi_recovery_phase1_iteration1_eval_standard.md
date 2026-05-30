# KPI Recovery Phase 1 Iteration 1 Evaluation Standard

## Work Package

`P1-WP1-ITER1`

## Pass Standard

`P1-WP1-ITER1` passes when:

1. the previous silent-inert failure mode is no longer present
2. the `kpi_*` schema is observably present in the NOVA pool
3. seeded configuration is observably present
4. `/api/kpi/*` routes are observably reachable
5. foundation runtime status is explicitly surfaced
6. the snapshot path is observably registered and usable
7. legacy KPI behaviour remains materially unaffected

## Qualified Pass Standard

The iteration may receive a qualified pass when the activation failure is clearly resolved and the Phase 1 foundation is observably live, even if pre-declared bounded gaps around data emptiness, partial backfill, or intentionally unimplemented metrics remain visible.

## Fail Standard

The iteration fails if any of the following remains true:

- schema is still absent
- seeds are still absent
- routes are still unreachable
- scheduler is still absent or unobservable
- init success/failure is still silently hidden
- legacy KPI surface is materially regressed
