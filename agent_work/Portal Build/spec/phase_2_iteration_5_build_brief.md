# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, and customer-facing summary-body wording.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 5.

## Build Slice

- Name: Submission-path restoration
- Goal: Restore a reliable conversational path from late clarification through summary into successful ticket creation.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The conversational journey is still not completing reliably.

Observed behavioural blockers:

- accepting the ticket-creation offer in chat still does not reliably advance the journey
- even when summary is reached, the confirm endpoint fails and ticket creation does not complete
- longer conversational journeys still get stuck in repetitive clarification before or around handoff

The result is that customers can have a more conversational intake experience, but the path to actually submitting a request remains fragile or broken.

## Desired User Outcome

A customer who has described their issue, answered the relevant clarification questions, and agreed to create a ticket should be able to progress coherently through summary and complete ticket creation successfully.

If the customer has already supplied the requested account or context in natural language, the system should avoid repetitive clarification that prevents that progression in the tested path.

## Desired Operational Outcome

Support should receive a structured, successfully created request outcome from the conversational journey, without requiring the customer to fight through loops, repeated clarification, or a failed confirmation endpoint.

## Scope For This Slice

- Focus on the path from late clarification into summary for multi-turn conversational journeys.
- Focus on the chat-level acceptance path when the system offers to create a ticket.
- Focus on the confirm endpoint or equivalent final ticket-creation path once summary is reached.
- Focus on reducing repetitive blocked clarification only where it prevents tested journeys from progressing.
- Keep the fix as narrow and local as possible.

## What To Change

- Restore a reliable behavioural path from ticket-creation offer acceptance to actual forward progression.
- Fix the path that creates a server-side failure when summary confirmation attempts to create the ticket.
- Reduce the repetitive clarification pattern in the tested conversational journeys where the needed context has already been provided.
- Preserve earlier conversational continuity gains while restoring dependable submission behaviour.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 clarification continuity, hidden-routing behaviour, and summary-body wording improvement.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable behavioural change that restores reliable submission-path behaviour.

## Non-Goals

- General extraction perfection across every intake domain
- Reworking earlier clarification tone unless required to restore submission progress
- Portal-wide summary-card redesign
- Broad architecture changes to the support flow
- Reopening non-conversational intake behaviour

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journey reliably progress from late clarification through summary into successful ticket creation.

Optimise for:

- forward progress after chat-level ticket-creation acceptance
- successful completion of the confirm path once summary is reached
- reduced repetitive clarification in the tested longer journeys
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the blocking path

Preferred behavioural shape:

- once the system offers to create a ticket, an affirmative customer response progresses the journey rather than being ignored or looped
- once summary is reached, confirmation can successfully create the ticket
- longer conversational journeys are not repeatedly blocked by re-asking for already-provided account/context in the tested path
- the journey can be completed as one coherent conversational support flow

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal can reliably progress from conversational clarification through summary to successful ticket creation in the tested slice.
- Eval can assess the change through the running software only.
