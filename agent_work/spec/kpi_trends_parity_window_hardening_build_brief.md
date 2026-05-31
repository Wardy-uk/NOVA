# KPI Trends Parity Window Hardening Build Brief

## Work Package

`KPX-WP7B` — Trends window-parameter hardening.

## Objective

Close the remaining concrete build-side defect in the Trends parity slice by making the window parameter behave honestly and predictably.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet Trends surface should:

1. honour supported window values for trend requests
2. reject or clamp invalid window values honestly and consistently
3. preserve the existing honest awaiting-history and not-wired behaviour
4. remain isolated from the legacy KPI system

## In Scope

- window parameter parsing and handling for the clean-sheet Trends route
- bounded validation/normalisation behaviour for supported values
- any additive route/read-model fix strictly required for honest window behaviour

## Out Of Scope

- broad Trends redesign
- synthetic history generation
- unrelated KPI source work
- legacy KPI changes

## Constraints

- Do not consume evaluator holdouts.
- Keep the slice focused on window behaviour only.
- Do not fabricate supported multi-day trends where history still does not exist.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_trends_parity_window_hardening_2026-05-31.md`

The report must clearly state:

- what window-handling defect was found
- what was changed
- how the route now behaves for supported and invalid window values
- any remaining bounded gap
- whether the slice is ready for independent evaluation
