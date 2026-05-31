# KPI Escalations Parity Fixture Eval Brief

## Work Package

`KPX-WP6A` — Escalations parity populated-path proof fixture.

## Objective

Determine whether the new disposable Escalations fixture path proves the populated clean-sheet Escalations parity behaviour end to end and leaves the environment clean after teardown.

## Evaluate Only

- the Escalations fixture control surface
- seeded populated-path behaviour for:
  - `escalation_rate`
  - `escalation_accuracy`
  - `rejection_rate`
- 7-day history population
- per-agent breakdown population
- awaiting-to-populated transition after rejection capture
- teardown / cleanup behaviour
- isolation from real spaces and the legacy KPI system

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\eval_output\kpi_escalations_parity_fixture_eval_2026-05-31.md`

The report must state:

- pass / qualified pass / fail
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether the Escalations parity slice is now ready for checkpointing
