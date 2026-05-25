# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, improved bundled URL capture, converged vague follow-up verification, converged metadata/visible-summary alignment, and converged description synthesis consistency.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 16.

## Build Slice

- Name: Field-boundary and edit-value hardening
- Goal: Fix boundary detection so extracted values stop cleanly and multi-field edit instructions do not contaminate one another.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The broader Phase 2 continuity and summary-fidelity problems are now materially reduced, but three field-boundary issues remain:

- inline account extraction can still capture trailing text or miss the intended account value
- filler instruction wording can still remain in edited field values
- 3-field simultaneous edit requests can still regress and allow one field to absorb the next field's instruction text

These are now the clearest remaining defects in the summary-quality path.

## Desired User Outcome

A customer should be able to:

- provide an account name inline with other text and have only the account name captured
- request edits in natural language without filler phrases appearing in the updated values
- change multiple fields in one message and see each field updated independently and correctly

## Desired Operational Outcome

Support should receive cleaner downstream field values, and customers should experience a summary-edit step where fields do not contaminate each other.

## Scope For This Slice

- Focus on inline/mixed account extraction boundary handling.
- Focus on stripping filler wording from edited field values.
- Focus on reliable parsing of 3-field simultaneous edit requests.
- Keep the fix as narrow and local as possible.

## What To Change

- Improve account extraction so the value stops at sensible boundaries and excludes trailing instruction or problem text.
- Improve edit-value cleanup so phrases like "just be", "should be", "change to", and similar instruction residue do not appear in the stored field value.
- Improve edit segmentation so 3-field simultaneous edits do not let the second field absorb text intended for the third.
- Preserve the already-working synthesis consistency, summary review, and other earlier Phase 2 gains.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, improved bundled URL capture, converged vague follow-up verification, converged metadata/visible-summary alignment, and converged description synthesis consistency.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves field-boundary detection and edit-value cleanliness.

## Non-Goals

- Reopening property-question narrowing
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- capture just the account name in inline/mixed messages
- strip filler wording from edit-derived values
- apply 3-field simultaneous edits without cross-field contamination

Optimise for:

- stronger field-boundary detection
- cleaner final field values
- robust 3-field edit parsing
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- account fields stop cleanly at the account name
- edit-derived values contain just the requested value
- 3-field edit requests update all three fields cleanly

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal captures cleaner account values, strips edit filler, and applies 3-field edits without contamination in the tested slice.
- Eval can assess the change through the running software only.
