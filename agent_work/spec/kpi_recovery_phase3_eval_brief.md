# KPI Recovery Phase 3 Evaluation Brief

## Work Package

`P3-WP1` — Independent evaluation of clean-sheet KPI views delivery.

## Evaluator Role Boundary

Evaluate observable behaviour only. Do not inspect source code, implementation notes, or build reasoning. Judge what the running system renders and what the exposed services return.

## Objective

Determine whether the clean-sheet KPI platform now provides the intended SLT, team, agent, and wallboard views on the new KPI data source, without regressing the legacy KPI system.

## Scope

Evaluate only the Phase 3 slice:

- SLT cross-space dashboard view
- team dashboard view per space
- agent scorecard view
- clean-sheet wallboard routes / views
- honest handling of sparse/empty/manual-team data
- coexistence with the untouched legacy KPI system

Do not expand into:

- Phase 4 manual-entry/import
- Phase 5 digests/polish/admin UI
- optional auth-process cleanup

## Observable Evaluation Questions

1. Does the SLT view exist and use clean-sheet KPI data rather than legacy KPI sources?
2. Does the team dashboard exist per space and use clean-sheet KPI data rather than legacy KPI sources?
3. Does the agent scorecard exist and use clean-sheet KPI data rather than legacy KPI sources?
4. Are the new wallboards genuinely backed by the clean-sheet KPI data source?
5. Do STBY and manual/non-Jira teams show honest sparse/manual states instead of fabricated values?
6. Does the wallboard metric fallback behave honestly given the lack of `show_on_wallboard = 1` seed rows?
7. Does the legacy KPI system remain behaviourally untouched?

## Known Bounded Non-Blocking Inputs

- STBY may still have sparse or absent data where sync coverage is missing.
- Manual/non-Jira teams remain intentionally outside computed capture and should show honest manual-state behaviour.
- Agent scorecard depth remains bounded to the implemented agent metrics already available from earlier phases.
- Clean-sheet wallboards currently use a documented fallback selection because no seed rows yet set `show_on_wallboard = 1`.

These are not automatic failures if the views are honest and truly wired to the clean-sheet data source.

## Deliverable

Write one markdown report to `agent_work/eval_output/phase3_views_eval_report_2026-05-30.md` that states:

- pass / qualified pass / fail
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether `P3-WP1` is converged for its scoped Phase 3 outcome
