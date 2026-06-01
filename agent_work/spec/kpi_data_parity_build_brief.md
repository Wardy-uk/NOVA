# KPI Data Parity Build Brief

## Work Package

`KPX-WP10` — KPI Data parity surface delivery.

## Objective

Deliver the next clearly named remaining legacy-surface parity slice by building a clean-sheet KPI Data surface on top of the converged clean-sheet KPI platform and current replacement-parity substrate.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should provide a KPI Data surface that:

1. uses the clean-sheet KPI data path only
2. presents a raw/grid-style inspectable view of clean-sheet KPI outputs rather than only summarised cards and charts
3. surfaces currently supported rows and values honestly
4. handles sparse, missing, unsupported, or not-yet-frozen data honestly rather than fabricating rows or columns
5. remains isolated from the legacy KPI system

## In Scope

- a clean-sheet KPI Data parity screen/surface
- any bounded read-model/API additions strictly required for that surface
- honest rendering of supported vs unsupported or sparse KPI rows/columns

## Out Of Scope

- broad KPI redesign
- CSV/export tooling unless already trivial and naturally part of the same slice
- Board MI
- legacy wallboard replacement
- unrelated source-family work
- fabrication of raw rows for unsupported metrics

## Constraints

- Do not consume evaluator holdouts.
- Use the clean-sheet KPI path only.
- Do not fabricate raw rows or columns where the clean-sheet data path does not support them.
- Keep the slice focused on KPI Data parity rather than a generic analytics workbench.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_data_parity_screen_2026-06-01.md`

The report must clearly state:

- what KPI Data parity surface was delivered
- what clean-sheet source/data path it uses
- which row/column families are currently supported vs honestly unsupported
- what remains bounded or environment-dependent
- whether the slice is ready for independent evaluation
