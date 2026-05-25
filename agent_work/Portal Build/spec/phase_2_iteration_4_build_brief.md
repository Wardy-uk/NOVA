# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, and natural clarification.
- Preserve the existing summary-body customer-facing improvement.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 4.

## Build Slice

- Name: Detail-to-summary progression restoration
- Goal: Restore a reliable conversational path from clarification into summary.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The conversational intake journey currently fails before completion-stage evaluation can even begin.

Observed behavioural blockers:

- when the system offers to create a ticket and the customer accepts, the journey loops instead of progressing
- no tested conversational path reliably reaches the summary stage
- account extraction is unreliable enough to trigger repeated clarification even after the customer has answered

Because of this, the summary-stage continuity work cannot be meaningfully assessed yet.

## Desired User Outcome

A customer who has described their issue and then accepts the system's offer to create a ticket should progress coherently into the next stage of the journey rather than entering an error-and-re-offer loop.

If the customer has already supplied the requested account or context in natural language, the journey should avoid repetitive clarification that blocks forward progress in the tested slice.

## Desired Operational Outcome

Support should still receive a structured request, but the conversational intake flow must be able to move from clarification into summary generation reliably enough for downstream completion behaviour to be exercised.

## Scope For This Slice

- Focus on the path from late clarification / ticket-creation offer into summary.
- Focus on eliminating the acceptance loop when the customer says yes to ticket creation.
- Focus on reducing repeated blocked clarification in the tested path where a required field has already been stated conversationally.
- Keep the fix as narrow and local as possible.

## What To Change

- Restore a working behavioural path from accepted ticket creation to summary-stage progression in conversational mode.
- Prevent the infinite loop where the system re-offers ticket creation after an affirmative customer response.
- Improve required-field recognition only to the extent needed to stop the tested conversational journeys from getting stuck before summary.
- Preserve earlier conversational continuity gains while restoring forward progress.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 clarification continuity and hidden-routing behaviour.
- Preserve the current customer-facing summary-body improvement.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable behavioural change that restores reliable progression.

## Non-Goals

- General field-extraction perfection across every intake domain
- Reworking earlier clarification tone or prompt style unless required to restore progression
- Portal-wide summary-card redesign
- Broad architecture changes to the support flow
- Reopening non-conversational intake behaviour

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journey reliably progress from late clarification into summary.

Optimise for:

- forward progress after ticket-creation acceptance
- elimination of the error-and-re-offer loop
- reduced repetitive clarification in the tested account-style journeys
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the blocking path

Preferred behavioural shape:

- once the system offers to create a ticket, an affirmative customer response progresses the journey rather than looping
- a customer who has already supplied the requested account/context is not repeatedly blocked in the same clarification step
- the journey reaches the summary stage reliably enough for downstream completion behaviour to be evaluated

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal can reliably progress from conversational clarification into summary in the tested slice.
- Eval can assess the change through the running software only.
