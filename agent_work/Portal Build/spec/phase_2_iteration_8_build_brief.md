# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, summary rendering, summary-stage confirmation recognition, and efficient property-specific handling when a concrete address is provided.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 8.

## Build Slice

- Name: Submission-path recovery plus property-question narrowing
- Goal: Restore a usable end-state for ticket submission and stop property-address questioning from appearing in journeys where it is not warranted.
- Owner: Build Agent

## Behavioural Gap Being Addressed

Two blockers now dominate the remaining Phase 2 gap:

- submission fails across every tested path, and the customer is left in an offer / fail / re-offer loop
- property-specific clarification is being asked in journeys where property context is irrelevant or where the customer has explicitly said the issue is site-wide

These issues prevent reliable completion and weaken the conversational trust established earlier in the journey.

## Desired User Outcome

A customer should be able to:

- complete the submission path successfully when ticket creation is available
- or, if submission is unavailable, receive a clear non-looping failure state rather than repeated offers that cannot succeed
- progress through non-property or site-wide issues without being repeatedly asked for a specific property address

## Desired Operational Outcome

Support should either receive a successfully created request, or the customer should be moved into a clear fallback state that does not falsely imply ticket creation is still available.

The detail journey should ask for property-level information only when the issue genuinely requires it.

## Scope For This Slice

- Focus on the submission path once the customer reaches summary or accepts ticket creation.
- Focus on eliminating the offer / fail / re-offer loop when submission is unavailable.
- Focus on narrowing property-question behaviour so it no longer appears in clearly non-property or explicitly site-wide journeys.
- Preserve the existing strong path for genuinely property-specific issues with a named address.
- Keep the fix as narrow and local as possible.

## What To Change

- Restore a working ticket-submission path if the current failure is recoverable within the portal flow and configuration used by this product.
- If submission cannot succeed in the current environment, stop the portal from repeatedly offering a broken path and provide a clear fallback outcome instead.
- Adjust conversational detail collection so property-address questions only appear when truly relevant.
- Ensure explicit customer signals such as "not a specific property", "all listings", or clearly non-property issue descriptions can move the journey forward without repeated property-address demands.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, summary rendering, summary-stage confirmation recognition, and the already-working property-specific path.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that restores a usable submission end-state and narrows inappropriate property questioning.

## Non-Goals

- General extraction perfection across every domain
- Reworking already-working property-specific flows unless required by the fix
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- Reopening non-conversational intake behaviour

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- complete ticket submission when possible, or fail clearly without looping when not possible
- avoid property-address questioning in clearly non-property and explicitly site-wide journeys
- preserve the efficient path for genuinely property-specific issues

Optimise for:

- usable submission outcomes
- elimination of the offer / fail / re-offer loop
- more appropriate follow-up questioning by issue type
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- once the customer reaches the end of the journey, the portal either successfully creates the ticket or gives a clear stable fallback outcome
- clearly non-property issues are not dragged into property-address questioning
- explicitly site-wide issues are not treated as if they require a single affected property
- genuinely property-specific issues with a named address still move efficiently to summary

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal no longer loops on broken submission attempts and no longer asks for property addresses in clearly non-property or explicitly site-wide journeys in the tested slice.
- Eval can assess the change through the running software only.
