# KPI Agent Breaches Parity Build Brief

## Work Package

`KPX-WP8` — Agent Breaches parity surface delivery.

## Objective

Deliver the next clearly named remaining legacy-surface parity slice by building a clean-sheet Agent Breaches surface on top of the converged clean-sheet KPI platform and current replacement-parity substrate.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should provide an Agent Breaches surface that:

1. uses the clean-sheet KPI data path only
2. presents agent-level breach-oriented output for the metrics the clean-sheet platform can already support honestly
3. handles unsupported breach families or missing agent history honestly rather than fabricating rows
4. remains isolated from the legacy KPI system

## In Scope

- a clean-sheet Agent Breaches parity screen/surface
- any bounded read-model/API additions strictly required for that screen
- honest rendering of supported vs unsupported or empty agent-breach output

## Out Of Scope

- broad KPI redesign
- raw KPI data grid/export
- Board MI
- legacy wallboard replacement
- unrelated source-family work
- fabrication of breach rows for unsupported metrics

## Constraints

- Do not consume evaluator holdouts.
- Use the clean-sheet KPI path only.
- Do not fabricate agent-breach rows where the clean-sheet data path does not support them.
- Keep the slice focused on Agent Breaches parity rather than a general analytics rebuild.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_agent_breaches_parity_screen_2026-05-31.md`

The report must clearly state:

- what Agent Breaches parity surface was delivered
- what clean-sheet source/data path it uses
- which breach families are currently supported vs honestly unsupported
- what remains bounded or environment-dependent
- whether the slice is ready for independent evaluation
