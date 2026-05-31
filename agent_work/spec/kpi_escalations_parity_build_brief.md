# KPI Escalations Parity Build Brief

## Work Package

`KPX-WP6` — Escalations parity-screen delivery.

## Objective

Deliver the clean-sheet Escalations parity surface now that the escalation-family source and capture paths are materially wired and runtime-proven.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should provide an Escalations surface that:

1. uses the clean-sheet escalation-family sources only
2. surfaces `escalation_rate`, `escalation_accuracy`, and `rejection_rate` honestly
3. handles absent capture rows honestly with null/awaiting states rather than fabricated percentages
4. remains isolated from the legacy KPI surface

## In Scope

- the clean-sheet Escalations parity screen/surface
- any bounded read-model/API additions strictly required for that screen
- honest rendering of captured vs not-yet-captured states

## Out Of Scope

- broader KPI redesign
- QA screen changes
- unrelated source-family work
- changes to legacy KPI screens

## Constraints

- Do not consume evaluator holdouts.
- Do not fabricate escalation-family values when capture rows are absent.
- Keep the slice focused on parity-screen delivery now that the source family is proven.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_escalations_parity_screen_2026-05-31.md`

The report must clearly state:

- what Escalations parity surface was delivered
- what clean-sheet source/data path it uses
- what remains bounded or environment-dependent
- whether the slice is ready for independent evaluation
