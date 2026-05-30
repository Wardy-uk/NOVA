# KPI Recovery Phase 2 Evaluation Brief

## Work Package

`P2-WP1` — Independent evaluation of EOD and daily-capture delivery.

## Evaluator Role Boundary

Evaluate observable behaviour only. Do not inspect source code, implementation notes, or build reasoning. Judge what the running system does through its exposed data/services and operator-visible state.

## Objective

Determine whether the clean-sheet KPI system can now freeze official daily outputs and expose the daily-report payload as a real parallel Phase 2 capability, without regressing the legacy KPI system.

## Scope

Evaluate only the Phase 2 slice:

- EOD capture behaviour for UK spaces and STBY
- writes into `kpi_daily`
- writes into `kpi_agent_daily` for the implemented agent metrics in scope
- writes into `kpi_eod_snapshot`
- RAG computation from stored targets and amber bands
- daily-report payload endpoint behaviour
- idempotent recapture behaviour
- coexistence with the legacy KPI system

Do not expand into:

- Phase 3 views or dashboards
- Phase 4 manual-entry/import flows
- AI digests or admin UI
- optional Phase 1 auth-token evidence cleanup

## Observable Evaluation Questions

1. Can the running system perform an EOD capture that writes official daily rows into `kpi_daily`?
2. Are agent-level daily rows written into `kpi_agent_daily` for the implemented agent metrics?
3. Is EOD ticket-state written into `kpi_eod_snapshot`?
4. Does RAG visibly follow stored targets, amber bands, and metric direction rather than hardcoded outcomes?
5. Is `GET /api/kpi/daily-report/:date` present and populated from the frozen tables?
6. Does repeated capture converge idempotently instead of duplicating rows?
7. Does STBY retain its own timezone-specific EOD behaviour rather than being treated as a UK space?
8. Is the legacy KPI system still behaviourally untouched?

## Known Bounded Non-Blocking Inputs

- Agent-daily outputs are intentionally limited to implemented Phase 1 agent metrics.
- Manual/non-Jira spaces are intentionally outside computed capture in this phase.
- Pause-status subtraction is still not wired because status-change history is not yet available in the cache path.
- Empty data may still be legitimate for STBY or specific metrics where source data is absent.

These are not automatic failures if the scoped Phase 2 behaviour is present and honest.

## Deliverable

Write one markdown report to `agent_work/eval_output/phase2_eod_daily_eval_report_2026-05-30.md` that states:

- pass / qualified pass / fail
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether `P2-WP1` is converged for its scoped Phase 2 outcome
