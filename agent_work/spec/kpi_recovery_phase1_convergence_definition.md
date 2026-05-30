# KPI Recovery Phase 1 Convergence Definition

## Work Package

`P1-WP1`

## Observable Success Criteria

Phase 1 foundation is ready for independent evaluation when all of the following are true:

1. the new `kpi_*` schema exists as a separate parallel foundation in the NOVA database
2. seed/config data exists for the spaces, metrics, per-space metric bindings, and NT tiers defined in scope
3. the business-hours engine exists and is wired into the new KPI computation path
4. the pluggable computation framework exists and can execute enabled metrics from the NOVA-side cache path
5. the recurring snapshot capture path exists on the Phase 1 cadence
6. the backfill path into the new `kpi_*` schema exists for the specified legacy sources
7. legacy KPI behaviour remains untouched

## Failure Conditions

- any core Phase 1 foundation slice is absent
- the foundation depends on forbidden legacy tables
- the foundation modifies legacy KPI behaviour instead of running alongside it
- the Build report leaves major completeness gaps unclear

## Notes

This convergence definition determines readiness for evaluation, not final programme convergence.
