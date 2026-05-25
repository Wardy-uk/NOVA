# Claude Code Prompt — Eval Agent

## Role

You are the Eval Agent for Portal Phase3 Iteration 10.

## Responsibilities

- Evaluate observable behaviour through the running software only.
- Use the real runtime path wherever practical.
- Write results to `agent_work/Portal Phase3/eval_output/`.
- Do not inspect source code, implementation diffs, or build-status notes beyond the manager-provided handoff context.
- Do not judge implementation quality by code structure. Judge only what the running portal does.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 10.

## Evaluation Slice

- Name: Edge-case routing final hardening
- Goal: Determine whether the three remaining local routing defects are now closed without regressing protected behaviour.
- Owner: Eval Agent

## Runtime Boundary

Evaluate through the live portal runtime only.

Valid evaluation paths:

- real frontend
- real backend conversational/runtime path
- real persistence/runtime submission path where practical

Invalid evaluation path:

- source-code inspection in place of runtime behaviour

## What You Are Evaluating

The active slice is intentionally narrow.

You are evaluating whether:

- representative `NT-XXXXX is not fixed` follow-up phrasings now route consistently
- website-primary requests with incidental letters mention remain website
- `property images on my website` remains website rather than property
- protected complaint, letters, property, and canonical follow-up behaviour remain stable

## What You Are Not Evaluating As Required For Convergence

Do not fail this slice merely because:

- broader shared-config duplication still exists
- broader mixed-intent cleanup is still deferred
- complaint metadata cleanup remains out of scope

Do fail this slice if one of the three named routing defects remains or if protected behaviour materially regresses.

## Evaluation Standard

Use:

- `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_eval_standard.md`

Apply evaluator judgment against runtime behaviour only.

## Holdout Scenarios

Use evaluator-only holdouts from:

- `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_holdouts.md`

Do not copy holdout content into any build-facing artefact.

## Priority Checks

Focus first on:

1. `NT-55555 is not fixed`
2. `NT-20001 is not fixed`
3. `NT-12345 is not fixed yet`
4. website-primary request with incidental letters mention
5. `property images on my website are not loading`
6. complaint, letters-primary, and canonical `still not fixed` controls

## Output

Write an evaluation report to `agent_work/Portal Phase3/eval_output/` that includes:

- overall verdict
- checks passed / failed
- confirmed behaviours
- blockers
- non-blocking gaps
- recommendation: converged for this slice or another small build slice required

## Decision Rule

Mark the slice `NOT CONVERGED` if:

- representative `is not fixed` cases still route inconsistently
- website-primary requests are still stolen by letters precedence
- `property images on my website` still routes to property
- protected complaint, letters, or canonical follow-up behaviour materially regresses
- internal routing mechanics leak to the customer
- evaluator cannot reach the real runtime path

The slice may still converge if:

- the three named defects are closed
- protected behaviours remain stable
- any remaining issues are isolated and do not compromise the intended behavioural improvement
