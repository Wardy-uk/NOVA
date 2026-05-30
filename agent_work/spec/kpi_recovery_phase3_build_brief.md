# KPI Recovery Phase 3 Build Brief

## Work Package

`P3-WP1` — Clean-sheet KPI views delivery.

## Objective

Deliver the clean-sheet Phase 3 slice so the new KPI platform exposes the intended SLT, team, agent, and wallboard views using the converged clean-sheet KPI data source rather than legacy KPI surfaces.

## Scope Source

The scope source of truth is:

- `C:\Users\NickW\Claude\windows automation\daypilot\KPI-Clean-Sheet-Design.md`

Deliver only the Phase 3 outcomes already defined there. Do not redesign or broaden them.

## Required Behavioural Outcome

At the end of this work package, the new parallel KPI system should be able to:

1. render an SLT cross-space dashboard view using the clean-sheet KPI data source
2. render a team dashboard view per space using the clean-sheet KPI data source
3. render an agent scorecard view using the clean-sheet KPI data source
4. rewire wallboards to the clean-sheet KPI data source

## Included Scope

- SLT dashboard view
- team dashboard view
- agent scorecard view
- clean-sheet data-source wiring for wallboards

## Constraints

- Keep the legacy KPI system untouched and running in parallel.
- Build on the converged Phase 1 foundation and Regression Protected Phase 2 slice.
- Do not broaden into Phase 4 manual entry/import, Phase 5 digests/polish, or admin UI.
- Do not consume evaluator holdouts.
- Preserve the established clean-sheet KPI route family and data source.
- Keep the slice focused on view delivery and wallboard rewiring only.

## Notes From Prior Phases

- Phase 1 and Phase 2 are already converged for scope.
- Phase 2 is Regression Protected.
- Manual/non-Jira spaces remain intentionally outside computed capture in current phases and should be represented honestly rather than faked.
- STBY may still have sparse/empty data where source sync coverage is absent; views must handle that honestly.

## Deliverable

Write one markdown completion report to `agent_work/build_status/p3-wp1-views-2026-05-30.md` that states:

- what was delivered
- what remains incomplete or bounded
- what assumptions were required
- whether the work package is ready for independent evaluation
