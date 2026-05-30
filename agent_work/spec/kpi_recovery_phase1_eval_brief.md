# KPI Recovery Phase 1 Evaluation Brief

## Work Package

`P1-WP1` — Independent evaluation of the clean-sheet KPI foundation delivery.

## Evaluator Role Boundary

Evaluate observable behaviour only. Do not inspect source code, implementation notes, or build reasoning. Judge what the running system does and what the exposed data/services show.

## Objective

Determine whether the delivered Phase 1 foundation behaves as a coherent new parallel KPI substrate for the scoped features already promised, without regressing the legacy KPI system.

## Scope

Evaluate only the Phase 1 foundation slice:

- new `kpi_*` schema presence and basic operability
- seeded space/metric/tier configuration availability
- business-hours behaviour at observable boundaries
- computation-path availability for implemented metrics
- snapshot scheduling / execution behaviour
- delivered backfill behaviour for the implemented legacy sources
- coexistence with the legacy KPI system

Do not expand into:

- Phase 2 EOD and daily-capture behaviour beyond what Phase 1 explicitly includes
- Phase 3 views or dashboards
- Phase 4 manual-entry/import workflows
- AI digests or admin UI

## Observable Evaluation Questions

1. Is there a new, separate `kpi_*` foundation present and queryable without displacing the legacy KPI system?
2. Are the expected spaces, metric definitions, space bindings, and NT tier definitions observable through the new KPI surface?
3. Does the business-hours engine produce correct observable outcomes for the scoped Jira spaces when probed through exposed execution paths?
4. Can the new KPI computation path produce snapshot data for implemented metrics from the NOVA-side cache path?
5. Does the delivered snapshot execution path run on demand or on schedule without colliding with the legacy KPI surface?
6. Do the delivered backfill paths behave correctly for the legacy sources that were explicitly included?
7. Are the declared residual gaps honestly bounded rather than hidden as silent failures?

## Known Non-Blocking Inputs

These are not automatic failures by themselves, but the evaluator should account for them when judging behaviour:

- NTPJ story points may legitimately read zero because source Jira data is currently zero.
- STBY may show empty computed data because it currently has zero cache rows.
- A sync cycle may be required before newly added fields fully populate the cache.
- Some seeded metric definitions are intentionally not computed in Phase 1.
- Backfill is intentionally partial rather than universal in this phase.

## Deliverable

Write one markdown report to `agent_work/eval_output/phase1_foundation_eval_report_2026-05-30.md` that states:

- pass / qualified pass / fail
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether `P1-WP1` is converged for its scoped Phase 1 foundation outcome
