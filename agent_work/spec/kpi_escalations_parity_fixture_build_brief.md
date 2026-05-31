# KPI Escalations Parity Fixture Build Brief

## Work Package

`KPX-WP6A` — Escalations parity populated-path proof fixture.

## Objective

Prove the populated Escalations parity path behaviourally by introducing a tightly bounded, disposable fixture path that allows evaluation of real escalation-family values, history, and per-agent output, then supports clean teardown.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should make it possible for an evaluator to:

1. create or invoke a minimal disposable escalation-family fixture using the clean-sheet path only
2. observe `escalation_rate` as a real populated value rather than an honest null/awaiting state
3. observe `escalation_accuracy` and `rejection_rate` transition from awaiting-capture to real values once a rejection/bounce-back is present
4. observe 7-day history and per-agent breakdown populate from clean-sheet KPI outputs
5. clean the proof fixture back out so the environment is left in a known state

## In Scope

- a bounded fixture/proof path for Escalations parity only
- any additive clean-sheet trigger or helper strictly required to make the populated path observable
- teardown/cleanup support for any proof rows introduced

## Out Of Scope

- broader KPI redesign
- QA surface changes
- unrelated source-family work
- legacy KPI changes
- long-lived demo data left behind in shared environments

## Constraints

- Do not consume evaluator holdouts.
- Do not fabricate escalation-family values outside the real clean-sheet data path.
- Keep the slice tightly focused on proving populated Escalations parity behaviour and cleaning up after itself.
- Preserve honest null/awaiting behaviour when the fixture is not present.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_escalations_parity_fixture_2026-05-31.md`

The report must clearly state:

- what fixture/proof path was added
- how it exercises real Escalations parity populated behaviour
- how cleanup/teardown is performed
- any remaining bounded gap
- whether the slice is ready for independent evaluation
