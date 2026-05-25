# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the now-converged clarification continuity from earlier Phase 2 iterations.
- Preserve the customer-facing summary-body improvement already achieved.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 3.

## Build Slice

- Name: Completion-stage conversational coherence
- Goal: Close the final customer-facing continuity gaps at summary and confirmation.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The conversational journey now remains coherent through clarification and has improved at summary-body level, but two customer-visible breaks remain:

- the auto-generated subject line in conversational mode still exposes internal routing taxonomy
- typed natural-language confirmation at the summary stage still does not progress the request to submission

These two issues prevent the experience from feeling like one complete conversational support flow from start to finish.

## Desired User Outcome

When a customer reaches the summary stage after a conversational intake journey:

- the summary should still read as customer-facing rather than internally classified
- the subject line should feel natural and non-taxonomic
- if the customer confirms naturally in plain language, the request should progress cleanly to submission

## Desired Operational Outcome

Support should still receive a structured and usable intake outcome, but the customer-facing completion step should not reveal internal routing taxonomy or require the customer to abandon the conversational model to finish the request.

## Scope For This Slice

- Focus only on customer-facing subject generation in conversational mode.
- Focus only on typed natural-language confirmation handling at the summary stage.
- Preserve earlier clarification and summary-body gains.
- Keep the change as narrow and local as possible.

## What To Change

- Remove internal category/subcategory framing from the customer-visible summary subject in the conversational path.
- Make summary-stage natural-language confirmation progress coherently to submission rather than re-entering summary-edit behaviour.
- Preserve the sense that the customer is still within the same conversational support journey at the moment of completion.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve category-picker removal and clarification continuity from earlier Phase 2 work.
- Preserve the current customer-facing summary-body improvement.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated intake, ticketing, or generic UI cleanup work.
- Prefer the smallest viable behavioural change that closes the final completion-stage gap.

## Non-Goals

- Reworking earlier clarification turns
- Portal-wide summary-card redesign
- Broad subject-generation refactors outside the tested conversational path
- General architecture changes to the support flow
- Unrelated content polish

## Build Agent Instructions

Implement the smallest viable change that makes the tested slice behave like one coherent conversational journey through completion.

Optimise for:

- customer-friendly summary subject presentation
- trustworthy natural-language confirmation behaviour
- smooth progression from summary to submission
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- general-purpose rewriting outside the conversational completion slice

Preferred behavioural shape:

- a conversational-path summary shows a natural, customer-facing subject
- the customer can type an affirmative response such as "yes" or "please go ahead" and the request progresses correctly
- completion still feels like the end of the same support conversation
- support still receives a usable intake result

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal keeps the customer-visible subject and typed confirmation behaviour conversational in the tested slice.
- Eval can assess the change through the running software only.
