# KPI Daily History Parity Build Brief

## Work Package

`KPX-WP9` — Daily History parity surface delivery.

## Objective

Deliver the next clearly named remaining legacy-surface parity slice by building a clean-sheet Daily History surface on top of the converged clean-sheet KPI platform and current replacement-parity substrate.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should provide a Daily History surface that:

1. uses the clean-sheet KPI data path only
2. presents a multi-day historical grid or table view beyond the existing sparkline/trends treatments
3. surfaces currently supported historical metric values honestly
4. handles missing days, unsupported metrics, or thin history honestly rather than fabricating rows or backfilling values
5. remains isolated from the legacy KPI system

## In Scope

- a clean-sheet Daily History parity screen/surface
- any bounded read-model/API additions strictly required for that screen
- honest rendering of supported vs unsupported or sparse daily-history output

## Out Of Scope

- broad KPI redesign
- raw KPI data export/grid parity
- Board MI
- legacy wallboard replacement
- unrelated source-family work
- fabrication of historical rows for unsupported metrics

## Constraints

- Do not consume evaluator holdouts.
- Use the clean-sheet KPI path only.
- Do not fabricate historical rows where the clean-sheet data path does not support them.
- Keep the slice focused on Daily History parity rather than a general reporting rebuild.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_daily_history_parity_screen_2026-05-31.md`

The report must clearly state:

- what Daily History parity surface was delivered
- what clean-sheet source/data path it uses
- which history families are currently supported vs honestly unsupported
- what remains bounded or environment-dependent
- whether the slice is ready for independent evaluation
