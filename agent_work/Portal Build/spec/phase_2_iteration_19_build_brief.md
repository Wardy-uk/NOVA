# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged vague follow-up verification, metadata/visible-summary alignment, description synthesis consistency where it already works, and converged portal/channel clarification recovery.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 19.

## Build Slice

- Name: Extraction accuracy and summary-readiness hardening
- Goal: Improve field-extraction accuracy and prevent incomplete or contaminated summaries in the remaining problematic paths.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The portal/channel clarification blocker is now resolved, but several narrower extraction-quality issues remain:

- phone-number fragments can still be misread as listing/reference IDs
- account names can still be omitted or inconsistently captured in the final summary
- some journeys still produce raw concatenated description instead of a clean synthesized summary
- some journeys can present summary before the latest critical detail has actually been absorbed

These issues affect summary fidelity and downstream usefulness even though overall conversational continuity has improved substantially.

## Desired User Outcome

A customer should be able to:

- provide a phone number without it being mistaken for a listing/reference
- provide an account name and see it appear reliably in the summary
- give a late problem detail or correction and have it reflected before summary/confirmation
- see a clean summary instead of a raw transcript in the remaining problematic paths

## Desired Operational Outcome

Support should receive more reliable account/reference separation and cleaner summaries, with fewer missing or contaminated fields in the residual edge cases.

## Scope For This Slice

- Focus on phone-number versus listing/reference separation.
- Focus on account capture reliability in summaries.
- Focus on ensuring late detail is absorbed before summary is finalised.
- Focus on the remaining paths where description synthesis still falls back to raw concatenation.
- Keep the fix as narrow and local as possible.

## What To Change

- Strengthen listing/reference extraction so phone-number-shaped values are not accepted as listing/reference IDs.
- Improve account capture so user-provided account names are more consistently reflected in the summary.
- Prevent summary from being treated as ready when the latest material detail has not yet been absorbed.
- Improve description synthesis triggering or fallback so the remaining raw-concatenation path is cleaned up.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged vague follow-up verification, metadata/visible-summary alignment, description synthesis consistency where it already works, and converged portal/channel clarification recovery.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves extraction accuracy and summary readiness.

## Non-Goals

- Reopening portal/channel clarification recovery
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys more reliably:

- keep phone numbers out of listing/reference fields
- capture account names into summary when they are clearly provided
- absorb the latest material detail before summary/confirmation
- produce synthesized descriptions in the remaining problematic path

Optimise for:

- cleaner field separation
- stronger summary readiness
- more reliable account capture
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- phone numbers remain phone numbers
- listing/reference fields only contain genuine identifiers
- account names appear reliably when given
- summaries are not shown before the important detail is actually reflected
- the remaining raw-transcript summary path is cleaned up

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal produces cleaner field separation, more reliable account capture, better summary readiness, and fewer raw-transcript summaries in the tested slice.
- Eval can assess the change through the running software only.
