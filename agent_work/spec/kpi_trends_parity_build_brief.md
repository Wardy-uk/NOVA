# KPI Trends Parity Build Brief

## Work Package

`KPX-WP7` — Trends parity surface delivery.

## Objective

Deliver the next highest-value remaining legacy-surface parity slice by building a clean-sheet Trends surface on top of the converged clean-sheet KPI platform and current replacement-parity substrate.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should provide a Trends surface that:

1. uses the clean-sheet KPI data path only
2. presents multi-day trend/history behaviour beyond the current thin sparkline treatment
3. surfaces currently supported trendable metrics honestly
4. handles unsupported or still-unwired metric families honestly rather than fabricating trend lines
5. remains isolated from the legacy KPI system

## In Scope

- a clean-sheet Trends parity screen/surface
- any bounded read-model/API additions strictly required for that screen
- honest rendering of supported vs unsupported metric history

## Out Of Scope

- broad KPI redesign
- Board MI
- legacy wallboard replacement
- unrelated source-family work
- fabrication of historical values for metrics without real clean-sheet history

## Constraints

- Do not consume evaluator holdouts.
- Use the clean-sheet KPI path only.
- Do not fabricate historical values for unsupported metrics.
- Keep the slice focused on Trends parity rather than a general reporting rebuild.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_trends_parity_screen_2026-05-31.md`

The report must clearly state:

- what Trends parity surface was delivered
- what clean-sheet source/data path it uses
- which trend families are currently supported vs honestly unsupported
- what remains bounded or environment-dependent
- whether the slice is ready for independent evaluation
