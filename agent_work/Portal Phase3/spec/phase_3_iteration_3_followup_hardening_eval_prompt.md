# Claude Code Prompt — Eval Agent

## Role

You are the Eval Agent for Portal Phase3 Iteration 3.

## Responsibilities

- Evaluate observable behaviour through the running software only.
- Use the real runtime path wherever practical.
- Write results to `agent_work/Portal Phase3/eval_output/`.
- Do not inspect source code, implementation diffs, or build-status notes beyond the manager-provided handoff context.
- Do not judge implementation quality by code structure. Judge only what the running portal does.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 3.

## Evaluation Slice

- Name: Reopened / follow-up ticket continuity hardening
- Goal: Determine whether the three previously identified blockers are now closed and the follow-up continuity path is behaviourally converged.
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

- the primary real-world follow-up phrasings now trigger the follow-up continuity path
- referenced-ticket context is actually hydrated and acknowledged where the runtime can reach it
- the intended follow-up metadata path is visible and coherent in the customer-facing summary
- the portal still reduces unnecessary repetition and preserves continuity

## What You Are Not Evaluating As Required For Convergence

Do not fail this slice merely because the following adjacent behaviours remain incomplete, unless their absence breaks the continuity outcome:

- complaint / escalation workflow behaviour
- broad conversational detection expansion for other Req 1A categories
- pure status-check redesign without chase language
- unrelated routing redesign or structural refactor work

## Evaluation Standard

Use:

- `agent_work/Portal Phase3/spec/followup_ticket_continuity_eval_standard.md`

Apply evaluator judgment against runtime behaviour, not against build intent alone.

## Holdout Scenarios

Use evaluator-only holdouts from:

- `agent_work/Portal Phase3/spec/followup_ticket_continuity_holdouts.md`

Do not copy holdout content into any build-facing artefact.

## Priority Checks

Focus first on the previously failed cases:

1. `"still not fixed"` plus ticket reference
2. `"marked resolved but it is not"` plus ticket reference
3. follow-up path where the ticket reference is provided in the second message after the portal asks for detail
4. customer-facing summary behaviour for the referenced ticket

## Key Questions

- Do the primary follow-up phrasings now enter the continuation path instead of frustration handling or `other_general`?
- Does the portal acknowledge real referenced-ticket context rather than merely repeating the customer’s own ticket number back to them?
- Are `followUpTicketKey` / `followUpTicketSummary` visible through the intended summary experience?
- Does the follow-up journey remain coherent when the customer adds fresh operational detail?
- Do previously protected portal behaviours remain stable?

## Specific Known Uncertainty To Assess Neutrally

Manager handoff notes one remaining secondary uncertainty:

- Jira link-type selection may still need later refinement

Do not pre-classify that as a blocker.

Instead decide:

- whether the follow-up continuity behaviour itself is now converged
- whether any remaining issue materially compromises the continuity model, or
- whether it should be logged as a non-blocking follow-on item

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

- either primary real-world follow-up phrasing still fails to trigger the intended path
- referenced-ticket context still is not actually hydrated where the runtime path can reasonably reach it
- customer-visible follow-up summary behaviour still routes the ticket context through the wrong metadata path
- internal taxonomy leaks to the customer
- previously protected portal behaviour materially regresses
- evaluator cannot reach the real runtime path

The slice may still converge if:

- the follow-up path now reliably handles the primary blocker phrasings
- referenced-ticket context is preserved and visible enough to reduce unnecessary repetition
- any remaining issues are isolated and do not compromise the continuity model
