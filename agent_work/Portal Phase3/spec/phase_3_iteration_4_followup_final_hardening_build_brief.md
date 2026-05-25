# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Portal Phase3 Iteration 4.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless the brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 4.

## Build Slice

- Name: Reopened / follow-up ticket continuity final hardening
- Goal: Close the final blocker and remove the remaining unnecessary repetition in the follow-up path.
- Owner: Build Agent

## Behavioural Gaps Being Addressed

The evaluator found one remaining blocker and two tightly-coupled continuity issues:

1. `still not fixed` plus ticket reference still routes into frustration handling instead of the follow-up continuity path.
2. The known ticket reference is not flowing into `followUpTicketKey`, so customer-visible summary behaviour still shows `Listing ref` rather than `Related ticket`.
3. The portal asks for a ticket reference even when the customer already provided one.

## Desired User Outcome

A customer who says `NT-123 is still not fixed` should be recognised as a follow-up case immediately, should not be diverted into a generic frustration-offer path, and should not be asked again for the ticket reference they already supplied.

The customer should see that the portal is carrying the referenced ticket through the intended follow-up path.

## Desired Operational Outcome

The follow-up path should preserve the referenced ticket key through the intended follow-up metadata so support receives a coherent continuation signal even when Jira cache hydration is incomplete.

## Scope For This Slice

- Focus on `still not fixed` plus ticket-reference style messages.
- Focus on the interaction between follow-up/chase routing and frustration handling.
- Focus on direct propagation of the extracted ticket key into the intended follow-up metadata path.
- Focus on suppressing redundant ticket-reference prompts when the key is already known.

## What To Change

- Ensure follow-up/chase handling wins for canonical referenced-ticket follow-up phrasing instead of frustration interception.
- Ensure the extracted ticket reference populates `followUpTicketKey` even when richer hydration data is unavailable.
- Ensure customer-visible summary behaviour uses the intended `Related ticket` path rather than falling back to `Listing ref` for follow-up references.
- Ensure the portal does not ask for the ticket reference again when it has already been recognised.

## Constraints

- Preserve the already-working follow-up patterns fixed in Iteration 3.
- Preserve Req 1A intake-category coverage.
- Preserve existing portal behaviour outside this slice.
- Do not redesign complaint handling, pure status-check behaviour, or mixed-intent routing generally.
- Prefer the smallest viable change that closes the named blocker and removes the coupled repetition defects.

## Non-Goals

- Jira cache/data completeness improvements
- Full Jira summary/status hydration redesign
- Pure status-check workflow without chase language
- General mixed-intent priority redesign
- Shared config refactor or unrelated routing cleanup

## Build Agent Instructions

Implement the smallest viable final hardening change that makes the most common real-world follow-up phrasing behave like a clear continuation path and uses the known ticket key coherently.

Optimise for:

- blocker closure for `still not fixed`
- direct related-ticket continuity
- reduced customer repetition
- low regression risk

Do not optimise for:

- broad conversational redesign
- unrelated polish
- speculative architecture work
- deferred non-blocking items

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.
- The running portal correctly handles `still not fixed` plus ticket reference as a follow-up continuity case.
- The known ticket key appears through the intended `Related ticket` path without redundant ticket-ref prompting in the tested slice.
