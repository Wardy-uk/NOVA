# KPI Recovery Phase 3 Convergence Definition

## Work Package

`P3-WP1`

## Observable Success Criteria

Phase 3 is ready for independent evaluation when all of the following are true:

1. an SLT cross-space dashboard view exists and reads from the clean-sheet KPI data source
2. a team dashboard view exists per space and reads from the clean-sheet KPI data source
3. an agent scorecard view exists and reads from the clean-sheet KPI data source
4. wallboards use the clean-sheet KPI data source rather than the legacy KPI surface
5. the views handle sparse or absent source data honestly rather than fabricating values
6. legacy KPI behaviour remains untouched

## Failure Conditions

- any core Phase 3 view surface is absent
- the views still depend on legacy KPI routes/tables as their authoritative data source
- wallboards are not actually rewired
- empty/sparse spaces are misrepresented rather than handled honestly
- legacy KPI behaviour is materially changed

## Notes

This convergence definition is for readiness for evaluation of the Phase 3 slice, not final programme convergence.
