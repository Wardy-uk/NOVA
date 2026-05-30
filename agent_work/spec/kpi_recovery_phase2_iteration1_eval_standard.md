# KPI Recovery Phase 2 Iteration 1 Evaluation Standard

## Work Package

`P2-WP1-ITER1`

## Pass Standard

`P2-WP1-ITER1` passes when:

1. the previous “cannot demonstrate freeze path” failure mode is no longer present
2. forced/on-demand capture observably writes `kpi_daily`
3. forced/on-demand capture observably writes `kpi_agent_daily` for the in-scope implemented metrics
4. forced/on-demand capture observably writes `kpi_eod_snapshot`
5. RAG is visibly persisted on frozen daily rows
6. repeated forced capture is idempotent
7. legacy KPI behaviour remains materially unaffected

## Qualified Pass Standard

The iteration may receive a qualified pass when the forced freeze/capture path is observably correct and idempotent, even if pre-declared bounded gaps around limited agent metrics, manual-team exclusion, or missing source data remain visible.

## Fail Standard

The iteration fails if any of the following remains true:

- forced capture still cannot demonstrate frozen writes
- frozen output tables remain unobservable after trigger execution
- recapture duplicates rather than converging
- daily-report payload still does not reflect frozen outputs
- legacy KPI behaviour is materially regressed
