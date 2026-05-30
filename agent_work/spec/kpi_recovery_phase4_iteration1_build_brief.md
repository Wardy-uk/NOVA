# KPI Recovery Phase 4 Iteration 1 Build Brief

## Work Package

`P4-WP1-ITER1` — Restore observable manual-entry/import write capability.

## Objective

Recover the already-scoped Phase 4 slice so the evaluator can actually exercise manual entry, promotion, and tracker import behaviour at runtime.

## Background

Independent evaluation failed `P4-WP1` on 2026-05-30.

The evaluator observed:

- clean-sheet manual-team read surfaces exist
- manual/non-Jira teams are registered correctly
- but the entire write/import surface is absent at runtime
- route probes for manual load/save and tracker import returned route-level 404s

This is a scoped activation/mounting failure inside Phase 4, not a reason to broaden the slice.

## Required Behavioural Outcome

The clean-sheet KPI platform must expose a real, observable Phase 4 write/import path so the evaluator can verify:

1. manual entry load/prefill
2. manual save into `kpi_manual_entries`
3. promotion into `kpi_daily`
4. import dry-run preview
5. real import write/promote behaviour
6. honest unmapped/rejected reporting

## In Scope

- bounded work required to make the manual write/import routes genuinely mounted and reachable
- bounded work required to make the existing Phase 4 save/import path observable at runtime
- bounded work required to surface honest failure if the write/import capability still cannot initialise

## Out Of Scope

- new manual metrics or teams beyond current scope
- Phase 5 digests/polish
- admin UI
- broader Phase 3 or dashboard polish
- auth-process redesign beyond what is necessary to exercise the already-scoped Phase 4 routes

## Constraints

- Keep the legacy KPI system behaviourally untouched.
- Keep the iteration tightly focused on making the existing Phase 4 capability real and testable.
- Do not consume evaluator holdouts.
- Do not expand the slice because the evaluator found 404s.

## Deliverable

Write one markdown completion report to `agent_work/build_status/p4-wp1-iter1-activation-recovery-2026-05-30.md` that states:

- what route/mounting or activation issue(s) were found
- what was changed to make the write/import capability observable
- how runtime observability now proves prefill/save/import/promotion are live
- any remaining bounded gap
- whether the work package is ready for re-evaluation
