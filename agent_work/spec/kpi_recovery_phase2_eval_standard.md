# KPI Recovery Phase 2 Evaluation Standard

## Work Package

`P2-WP1`

## Pass Standard

`P2-WP1` passes when:

1. EOD capture can produce official daily outputs in the new clean-sheet path
2. `kpi_daily`, `kpi_agent_daily`, and `kpi_eod_snapshot` are observably written for the in-scope implemented outputs
3. RAG behaviour is observably driven by stored targets and amber bands
4. the daily-report payload endpoint is observably present and populated from frozen outputs
5. repeated capture is idempotent
6. STBY's timezone-specific handling is preserved where data exists
7. legacy KPI behaviour remains materially unaffected

## Qualified Pass Standard

`P2-WP1` may receive a qualified pass when the core freeze/capture path is observably correct but pre-declared bounded gaps remain visible, such as limited agent metrics, manual-team omission, or absent source data for certain spaces.

## Fail Standard

Evaluation fails if any of the following occurs:

- official daily outputs are not actually written
- daily-report payload is absent or not sourced from the frozen tables
- capture duplicates rather than converging
- RAG depends on hardcoded logic instead of stored config
- STBY handling collapses into UK-only behaviour
- legacy KPI behaviour is materially regressed
