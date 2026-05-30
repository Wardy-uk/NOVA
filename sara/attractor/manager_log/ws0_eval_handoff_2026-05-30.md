# WS0 Evaluation Handoff

## Date

2026-05-30

## Recipient

Evaluator Agent

## Evaluation Timing

Use this standard only after the Build Agent has written a readiness report in `sara/attractor/build_status/`.

## Evaluation Standard

Judge only observable runtime behaviour.

Required checks:

1. determine whether the intended Pi 5 startup path brings SARA up without manual application launch
2. determine whether the frontend is reachable in its intended always-on runtime mode
3. determine whether the backend is reachable and serving the expected runtime path
4. determine whether frontend/backend communication actually works in the running system
5. determine whether any operator-visible failure state is surfaced honestly

## Holdout Focus Areas

Use a small number of hidden checks centred on mature-runtime risks such as:

- restart persistence after a service stop/start cycle
- honest degradation when backend communication fails
- empty or placeholder runtime payload handling
- configuration dependency failure surfacing

Do not reveal holdout specifics to the Build Agent.

## Reporting Standard

Write results to `sara/attractor/eval_output/` and report:

- pass/fail status for each observable criterion
- evidence gathered from runtime interaction
- any scoped regressions or blockers
- recommendation: converge, iterate, or block
