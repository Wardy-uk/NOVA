# KPI Agent Breaches Parity Fixture Build Brief

## Work Package

`KPX-WP8A` — Agent Breaches populated-path proof fixture.

## Objective

Prove the populated Agent Breaches path behaviourally by introducing a tightly bounded, disposable fixture path that allows evaluation of real breach / at-risk / clear outcomes, then supports clean teardown.

## Required Behavioural Outcome

At the end of this work package, the clean-sheet KPI platform should make it possible for an evaluator to:

1. create or invoke a minimal disposable agent-breach fixture using the clean-sheet path only
2. observe at least one agent classified as breaching
3. observe at least one agent classified as at-risk
4. observe at least one agent classified as clear / met
5. clean the proof fixture back out so the environment is left in a known state

## In Scope

- a bounded fixture/proof path for Agent Breaches only
- any additive clean-sheet trigger or helper strictly required to make the populated path observable
- teardown/cleanup support for any proof rows introduced

## Out Of Scope

- broad KPI redesign
- legacy KPI changes
- long-lived demo data left behind in shared environments
- unrelated source-family work

## Constraints

- Do not consume evaluator holdouts.
- Do not fabricate breach results outside the real clean-sheet data path.
- Keep the slice tightly focused on proving populated Agent Breaches behaviour and cleaning up after itself.
- Preserve honest empty-state behaviour when the fixture is not present.

## Deliverable

Write one markdown report to:

`C:\Users\NickW\Claude\windows automation\daypilot\agent_work\build_status\kpi_agent_breaches_parity_fixture_2026-05-31.md`

The report must clearly state:

- what fixture/proof path was added
- how it exercises real Agent Breaches populated behaviour
- how cleanup/teardown is performed
- any remaining bounded gap
- whether the slice is ready for independent evaluation
