# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged vague follow-up verification, converged portal/channel clarification recovery, and the materially improved user-facing summary experience.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 20.

## Build Slice

- Name: Downstream summary fidelity hardening
- Goal: Make the stored/downstream summary data as clean and trustworthy as the visible customer summary.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The user-facing conversational journey is now materially stable, but downstream data fidelity still has four remaining gaps:

- phone-number fragments can still be misread as listing/reference IDs
- account names can still be captured imperfectly in some edge cases
- the downstream description field can still remain raw transcript even when the visible summary is clean
- post-summary corrections do not always propagate cleanly through all summary representations

These issues affect what support ultimately receives, even when the customer-facing experience is acceptable.

## Desired User Outcome

A customer should be able to:

- see a summary whose stored/downstream values match what they reviewed
- correct details after summary and trust that the corrected values are the ones ultimately carried forward

## Desired Operational Outcome

Support should receive clean, structured, non-transcript summary data:

- phone numbers should stay phone numbers
- listing/reference fields should contain real identifiers only
- account names should be trimmed and reliable
- the description sent downstream should match the synthesized description shown to the customer

## Scope For This Slice

- Focus on canonical description fidelity between visible summary and downstream fields.
- Focus on phone-number vs listing/reference separation.
- Focus on account carry-through and trimming reliability.
- Focus on post-summary correction propagation.
- Keep the fix as narrow and local as possible.

## What To Change

- Make the synthesized description the canonical downstream description wherever appropriate, not just the visible card text.
- Further strengthen listing/reference extraction so phone-number-shaped values are rejected consistently.
- Improve account capture/trimming so edge-case trailing fragments do not remain in the final summary.
- Ensure post-summary edits reflow through all summary representations, not just a subset of fields.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged vague follow-up verification, converged portal/channel clarification recovery, and the materially improved user-facing summary experience.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves downstream summary fidelity.

## Non-Goals

- Reopening portal/channel clarification recovery
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys more reliably:

- keep phone numbers out of listing/reference fields
- carry clean account values through to the final summary
- make downstream description match the synthesized summary
- propagate post-summary corrections through the final stored summary state

Optimise for:

- stronger downstream data fidelity
- cleaner phone/reference separation
- cleaner account carry-through
- preserved alignment between visible and stored summaries
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- the clean summary shown to the customer is the same summary carried downstream
- phone numbers never become listing/reference IDs
- account values are clean in the final state
- post-summary corrections are reflected everywhere they need to be

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal preserves clean downstream summary fidelity, cleaner phone/reference separation, and better correction propagation in the tested slice.
- Eval can assess the change through the running software only.
