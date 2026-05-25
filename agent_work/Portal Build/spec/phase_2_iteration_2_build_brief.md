# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the now-converged clarification continuity from Phase 2 Iteration 1.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 2.

## Build Slice

- Name: Summary and confirmation continuity
- Goal: Keep the conversational support journey coherent through summary and final confirmation.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The portal now stays conversational through clarification, but the journey still breaks at the late stage:

- the summary card exposes internal routing taxonomy to the customer
- natural-language confirmation does not advance the journey to submission

The result is that the customer can begin and clarify conversationally, but the final steps no longer feel like the same conversational support flow.

## Desired User Outcome

A customer who has already described their issue and answered clarification questions should see a summary that still feels customer-facing and conversational.

If the customer confirms naturally in plain language, the request should progress coherently toward submission rather than stalling or looping back into summary.

## Desired Operational Outcome

Support should still receive a structured, usable request outcome, but the customer-facing summary and completion step should not reveal internal operational taxonomy or require the customer to understand a separate non-conversational submission model.

## Scope For This Slice

- Focus only on the summary and confirmation portion of the conversational intake journey.
- Focus on the customer-facing subject/summary presentation.
- Focus on how natural-language confirmation is interpreted once the customer reaches the confirmation stage.
- Keep the earlier clarification continuity intact.

## What To Change

- Remove visible internal category or subcategory labels from customer-facing summary-stage presentation in the conversational path.
- Make the progression from summary to submission respond coherently to natural-language confirmation.
- Preserve a clear sense that the system is still handling the same conversational request from start to finish.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve the elimination of the category picker from the conversational path.
- Do not redesign the portal broadly.
- Do not replace the support platform or underlying routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable behavioural change that closes the late-stage continuity gap.

## Non-Goals

- Reworking the earlier clarification turns unless necessary to preserve the late-stage fix
- Portal-wide summary-card redesign
- Rebuilding support submission architecture end to end
- Broad UX polish
- Expanding into unrelated intake domains

## Build Agent Instructions

Implement the smallest viable change that makes the tested slice behave like one coherent conversational journey through summary and final confirmation.

Optimise for:

- hidden routing complexity at summary stage
- trustworthy confirmation behaviour
- smooth progression to submission
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated customer-support improvements
- general-purpose content rewriting outside the tested slice

Preferred behavioural shape:

- the customer reaches a summary that reads as customer-facing rather than internally classified
- the customer can confirm in natural language without being trapped in a loop
- the final progression still feels like part of the same support conversation
- support still receives a usable intake result

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal keeps the summary and confirmation stage customer-facing and conversational in the tested slice.
- Eval can assess the change through the running software only.
