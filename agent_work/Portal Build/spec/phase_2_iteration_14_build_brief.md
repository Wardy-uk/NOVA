# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, improved account-field protection, improved bundled URL capture, and converged vague follow-up verification.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 14.

## Build Slice

- Name: Summary fidelity hardening
- Goal: Make summary synthesis more consistent and make multi-field summary edits reliable both visually and in underlying metadata.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The broader Phase 2 continuity and readiness problems are now materially reduced, but three fidelity gaps remain:

- multi-field summary edits still fail consistently
- visible summary synthesis is inconsistent across journeys
- the underlying metadata description remains transcript-like even when the summary card body looks clean

This means customers may see a better summary than the one that is actually stored and used downstream, and edit behaviour is still not trustworthy when multiple fields are changed together.

## Desired User Outcome

A customer should be able to:

- request multiple summary-field changes in one message and see each change applied correctly
- see consistently clean subject and description synthesis across similar journeys
- trust that the clean summary they review is the same summary being carried forward downstream

## Desired Operational Outcome

Support should receive the same cleaner synthesized summary content that the customer reviewed, and customers should experience a trustworthy edit-and-review step before the journey ends.

## Scope For This Slice

- Focus on multi-field summary edit requests in a single message.
- Focus on consistency of subject/description synthesis in the tested journeys.
- Focus on getting synthesized description into the underlying metadata fields used downstream.
- Keep the fix as narrow and local as possible.

## What To Change

- Make multi-field summary edit parsing segment and apply each requested field cleanly and independently.
- Improve synthesis triggering so customer-facing subject and description quality is more consistent across comparable journeys.
- Ensure that when a synthesized description exists, it is reflected in the underlying metadata summary fields rather than only in the visible card body.
- Preserve the already-working vague follow-up verification, summary review flow, and other earlier Phase 2 gains.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, improved account-field protection, improved bundled URL capture, and converged vague follow-up verification.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves summary fidelity.

## Non-Goals

- Reopening property-question narrowing
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- apply multi-field summary edits correctly in one turn
- produce more consistent synthesized subjects and descriptions
- carry synthesized description into the underlying metadata used downstream

Optimise for:

- robust multi-field edit behaviour
- stronger consistency between visible summary and stored summary
- cleaner subject/description fidelity
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- multi-field edit requests update every requested field cleanly
- clean synthesis appears consistently across similar journeys
- the clean summary shown to the user is also the one stored downstream

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal applies multi-field summary edits correctly, produces more consistent synthesis, and stores cleaner summary description downstream in the tested slice.
- Eval can assess the change through the running software only.
