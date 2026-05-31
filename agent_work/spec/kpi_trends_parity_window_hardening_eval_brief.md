# KPI Trends Parity Window Hardening Eval Brief

## Work Package

`KPX-WP7B` — Trends window-parameter hardening.

## Objective

Determine whether the Trends route now handles supported and invalid window values honestly and predictably without regressing the existing honest Trends behaviour.

## Evaluate Only

- window parameter handling on the clean-sheet Trends route
- support for canonical `window` requests
- legacy alias behaviour if present
- honest clamping/defaulting behaviour
- preservation of awaiting-history and not-wired classifications
- legacy isolation and clean-sheet sibling non-regression

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\eval_output\kpi_trends_parity_window_hardening_eval_2026-05-31.md`

The report must state:

- pass / qualified pass / fail
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether the next best step is checkpointing Trends parity or waiting for a second EOD freeze to verify the supported path
