# KPI Recovery Phase 1 Evaluation Standard

## Work Package

`P1-WP1`

## Pass Standard

`P1-WP1` passes independent evaluation when:

1. the new `kpi_*` foundation is observably present and separate from the legacy KPI path
2. the seeded configuration for spaces, metrics, bindings, and tiers is observably available
3. business-hours behaviour is observably correct for representative scoped cases
4. implemented metrics can be observed flowing through the new snapshot path
5. delivered backfill paths work for the specific legacy sources claimed in scope
6. no material regression is found in the legacy KPI surface

## Qualified Pass Standard

`P1-WP1` may receive a qualified pass when the core foundation behaviour is present, but one or more pre-declared bounded gaps remain observable and do not invalidate the scoped Phase 1 outcome.

## Fail Standard

Evaluation fails if any of the following occurs:

- the new foundation is not separately observable
- critical Phase 1 foundation elements are absent in runtime behaviour
- snapshot execution is non-functional for the implemented path
- claimed backfill behaviour is not actually present for the delivered sources
- legacy KPI behaviour is materially regressed
- declared bounded gaps are actually unbounded or misleading
