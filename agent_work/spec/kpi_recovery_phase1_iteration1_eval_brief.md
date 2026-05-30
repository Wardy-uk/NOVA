# KPI Recovery Phase 1 Iteration 1 Evaluation Brief

## Work Package

`P1-WP1-ITER1` — Re-evaluation of foundation activation recovery.

## Evaluator Role Boundary

Evaluate observable behaviour only. Do not inspect source code, implementation notes, or build reasoning. Judge the running system, its exposed data/services, and operator-visible signals.

## Objective

Determine whether the activation recovery has removed the prior failure mode and whether the clean-sheet Phase 1 foundation is now observably active as a real parallel KPI substrate.

## Prior Failure To Retest

The previous evaluation failed because the new foundation was observably absent:

- no `kpi_*` tables
- no seeded configuration
- no snapshot job
- no reachable `/api/kpi/*` routes
- no surfaced init failure

This re-evaluation must explicitly confirm whether those failure conditions are gone.

## Scope

Evaluate only the Phase 1 foundation and its activation recovery:

- actual `kpi_*` schema presence in the intended NOVA database
- seeded space/metric/binding/tier availability
- foundation route reachability under `/api/kpi/*`
- foundation health/observability surface
- snapshot job registration and observable execution path
- on-demand snapshot execution behaviour
- coexistence with the untouched legacy KPI system

## Observable Evaluation Questions

1. Does the running system now create and expose the new `kpi_*` schema in the NOVA pool?
2. Are the seeded spaces, metric definitions, bindings, and tier rows now observably present?
3. Is `/api/kpi/*` now genuinely reachable and usable for foundation introspection?
4. Does the foundation now surface clear runtime state, including explicit failure if init cannot complete?
5. Is the snapshot path now registered and observable, either through health state or runtime execution?
6. Does forced snapshot execution behave honestly, including legitimate skips outside compute windows?
7. Does the activation recovery preserve legacy KPI non-regression?

## Known Bounded Non-Blocking Inputs

- NTPJ story points may still read zero because source Jira data is currently zero.
- STBY may still show empty computed data because it has zero cache rows.
- A sync cycle may still be required before newly added fields fully populate the cache.
- Some seeded metric definitions are intentionally not computed in Phase 1.
- Backfill remains intentionally partial in this phase.

These are not automatic failures if the foundation itself is now observably present and honest.

## Deliverable

Write one markdown report to `agent_work/eval_output/phase1_iteration1_eval_report_2026-05-30.md` that states:

- pass / qualified pass / fail
- whether the prior failure mode is resolved
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether `P1-WP1-ITER1` closes the activation-recovery loop and leaves Phase 1 converged for its scoped foundation outcome
