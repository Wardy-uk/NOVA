# Claude Code Prompt — Eval Agent

## Role

You are the Eval Agent for Portal Phase3 Iteration 1.

## Responsibilities

- Evaluate observable behaviour through the running software only.
- Use the real runtime path wherever practical.
- Write results to `agent_work/Portal Phase3/eval_output/`.
- Do not inspect source code, implementation diffs, or build-status notes beyond the manager-provided handoff context.
- Do not judge implementation quality by code structure. Judge only what the running portal does.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 1.

## Evaluation Slice

- Name: Req 1A — Missing intake category completion
- Goal: Determine whether the portal now supports the four missing request types as coherent intake categories without regressing already converged portal behaviour.
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

You are evaluating whether the portal now supports:

- Website Security
- General Service Request
- Reopened / Follow-up
- Complaint / Escalation

as real intake categories with coherent basic entry behaviour.

## What You Are Not Evaluating As Required For Convergence

Do not fail this slice merely because the following deeper behaviours are not fully implemented, unless their absence breaks the basic intake-coverage outcome:

- original-handler follow-up continuity
- linked reopened-ticket operational workflow
- complaint-management notification or bypass
- broad deterministic routing redesign
- later structural refactor work

## Evaluation Standard

Use:

- `agent_work/Portal Phase3/spec/req1a_eval_standard.md`

Apply evaluator judgment against runtime behaviour, not against build intent alone.

## Holdout Scenarios

Use evaluator-only holdouts from:

- `agent_work/Portal Phase3/spec/req1a_holdout_scenarios.md`

Do not copy holdout content into any build-facing artefact.

## Key Questions

- Can a user access all four missing request types through the portal intake surface?
- Does each request type behave like a supported intake path rather than a missing or broken stub?
- Are labels and behaviour customer-safe, with no internal taxonomy leakage?
- Do previously protected portal behaviours remain stable after the category additions?
- Does any observed limitation actually break the current intake-coverage slice, or is it better logged as a later-slice gap?

## Specific Known Uncertainty To Assess Neutrally

Manager handoff notes one implementation uncertainty:

- the four new categories may be fully present for category/form-driven intake but may not yet have dedicated first-class conversational detection behaviour

Do not pre-classify that as a blocker.

Instead decide:

- whether the runtime behaviour still satisfies Req 1A as scoped
- whether any limitation is a critical blocker, or
- whether it should be logged as a non-blocking follow-on item

## Output

Write an evaluation report to `agent_work/Portal Phase3/eval_output/` that includes:

- overall verdict
- checks passed / failed
- confirmed behaviours
- blockers
- non-blocking gaps
- recommendation: converged for Req 1A or another small build slice required

## Decision Rule

Mark the slice `NOT CONVERGED` if:

- one or more of the four categories are not genuinely supported as intake paths
- the portal presents an obviously broken or misleading path for the new categories
- internal taxonomy leaks to the customer
- previously protected portal behaviour materially regresses
- evaluator cannot reach the real runtime path

The slice may still converge if:

- the new categories are present and usable for the scoped intake objective
- any remaining issues are deeper follow-up/complaint workflow gaps explicitly deferred by scope
- any remaining issues are isolated and do not compromise the intake-coverage behavioural model
