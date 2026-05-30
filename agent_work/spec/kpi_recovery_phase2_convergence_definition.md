# KPI Recovery Phase 2 Convergence Definition

## Work Package

`P2-WP1`

## Observable Success Criteria

Phase 2 is ready for independent evaluation when all of the following are true:

1. EOD capture exists for UK spaces and STBY on the intended schedules
2. daily rows can be written into `kpi_daily`
3. agent daily rows can be written into `kpi_agent_daily` for the implemented agent metrics in scope
4. EOD ticket-state rows can be written into `kpi_eod_snapshot`
5. RAG status is computed from stored targets/bands rather than hardcoded logic
6. the daily-report payload endpoint is observably present
7. legacy KPI behaviour remains untouched

## Failure Conditions

- any core Phase 2 output surface is absent
- EOD capture is not separated by the required timezone handling
- daily freeze outputs are not actually written
- RAG depends on hardcoded targets
- legacy KPI behaviour is materially changed

## Notes

This convergence definition is for readiness for evaluation of the Phase 2 slice, not final programme convergence.
