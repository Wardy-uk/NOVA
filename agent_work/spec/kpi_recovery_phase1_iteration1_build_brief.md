# KPI Recovery Phase 1 Iteration 1 Build Brief

## Work Package

`P1-WP1-ITER1` — Foundation activation recovery.

## Objective

Recover the already-delivered Phase 1 foundation so that it is observably active at runtime in the evaluator environment, rather than silently inert.

## Background

Independent evaluation failed `P1-WP1` on 2026-05-30. The evaluator observed:

- no `kpi_*` tables created in the NOVA pool
- no seeded KPI foundation configuration
- no registered 3-minute snapshot job
- no live `/api/kpi/*` foundation surface
- no surfaced init failure in logs

Legacy KPI behaviour remained intact. Preserve that.

## Required Behavioural Outcome

On boot against the NOVA main pool, the clean-sheet KPI foundation must be observably active and honestly surfaced.

The recovered runtime must make all of the following externally true:

1. the `kpi_*` schema is actually created in the intended NOVA database
2. seed/config rows for spaces, metrics, bindings, and tiers are actually present
3. the foundation snapshot execution path is actually registered and observable
4. the foundation HTTP surface under `/api/kpi/*` is actually reachable where claimed
5. if initialisation cannot complete, the failure is surfaced clearly rather than silently hidden
6. legacy KPI behaviour remains untouched

## Scope

This is a recovery iteration for activation and observability of the already-scoped Phase 1 foundation. It is not a scope expansion.

## In Scope

- whatever bounded work is required to make the existing foundation actually initialise and surface its runtime state honestly
- bounded work to ensure the evaluator can observe the schema, seeds, scheduler, and foundation routes
- bounded work to ensure any init failure is visible in logs or another clear operator-facing signal

## Out Of Scope

- adding new metric computers beyond the already-scoped foundation
- extending backfill beyond the sources already claimed in Phase 1
- adding Phase 2, Phase 3, or Phase 4 features
- redesigning the route family or overall architecture unless required for the claimed `/api/kpi/*` surface to be real

## Constraints

- Keep the legacy KPI system behaviourally untouched.
- Keep the iteration tightly focused on activation recovery and honest surfacing.
- Do not consume evaluator holdouts.
- Do not broaden the phase because of the evaluation failure.

## Deliverable

Write one markdown completion report to `agent_work/build_status/p1-wp1-iter1-activation-recovery-2026-05-30.md` that states:

- what activation issue(s) were found
- what was changed to make the foundation observably active
- how runtime observability now proves schema, seeds, scheduler, and routes are live
- any remaining bounded gap
- whether the work package is ready for re-evaluation
