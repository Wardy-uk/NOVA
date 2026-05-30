# KPI Recovery Phase 1 Eval Decision

## Evaluator Outcome

`P1-WP1` received a FAIL in `agent_work/eval_output/phase1_foundation_eval_report_2026-05-30.md`.

## Manager Classification

This is a material blocker inside current scope, not a case for scope expansion.

### Failure class

- Structural activation failure
- Silent observability failure
- Legacy non-regression preserved

### What failed

- the claimed foundation was not observably active in runtime
- no schema, no seeds, no scheduler, and no live route surface were observed
- failure was not surfaced honestly

### What did not fail

- legacy KPI behaviour remained intact
- the programme's isolation strategy held

## Routing Decision

Open a single bounded recovery iteration: `P1-WP1-ITER1`.

The next build brief focuses only on:

- making the existing Phase 1 foundation actually activate
- making activation observable
- surfacing failure honestly if activation still cannot complete

It must not broaden into new Phase 2+ work or absorb the declared bounded metric/backfill gaps.
