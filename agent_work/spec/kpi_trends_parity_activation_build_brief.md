# KPI Trends Parity Activation Build Brief

## Work Package

`KPX-WP7A` — Trends parity activation recovery.

## Objective

Restore the already-scoped clean-sheet Trends surface so it is genuinely reachable and observable in the runtime used for evaluation.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should:

1. serve the Trends surface from a real clean-sheet API route
2. make the canonical Trends route reachable in the evaluated runtime
3. preserve the previously claimed clean-sheet Trends behaviour without broadening scope
4. keep the rest of the clean-sheet and legacy KPI surfaces non-regressed

## In Scope

- route wiring / registration / runtime activation for the Trends surface
- any bounded runtime/build activation fix strictly required to make the surface observable
- surfacing enough runtime evidence that the evaluator can hit the real route

## Out Of Scope

- broad KPI redesign
- new trend families
- Board MI
- legacy wallboard replacement
- unrelated source-family work

## Constraints

- Do not consume evaluator holdouts.
- Keep the slice focused on runtime activation and observability only.
- Do not broaden into Trends feature redesign if the issue is route/build/runtime activation.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_trends_parity_activation_2026-05-31.md`

The report must clearly state:

- what route/runtime activation issue was found
- what was changed to make the Trends surface observable
- how runtime observability now proves the route is live
- any remaining bounded gap
- whether the slice is ready for independent evaluation
