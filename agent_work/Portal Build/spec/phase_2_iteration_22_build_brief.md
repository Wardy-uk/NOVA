# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged portal/channel clarification recovery, materially improved user-facing summary quality, converged account-field reliability, converged correction propagation, and converged phone-number protection in structured identifier fields.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 22.

## Build Slice

- Name: Multi-segment reference preservation
- Goal: Preserve full customer-provided alphanumeric listing/reference IDs in the structured summary field.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The remaining structured-field fidelity gap is now very narrow:

- multi-segment alphanumeric references are still being truncated in the structured `listingId` field
- the visible description can preserve the full reference, but the structured field still drops trailing segments

This creates a downstream mismatch where support may receive an incomplete identifier even though the customer provided the full one.

## Desired User Outcome

A customer should be able to:

- provide a reference like `RM-45821-A` or `ABC-12345-XZ`
- see that full reference carried through into the structured summary state
- correct or restate a reference without losing suffix segments

## Desired Operational Outcome

Support should receive:

- the full customer-provided alphanumeric reference in the structured field
- no truncation after the second hyphen or segment
- continued phone-number protection so phone values are still excluded

## Scope For This Slice

- Focus on preserving full multi-segment alphanumeric listing/reference values in the structured field.
- Focus on keeping the structured reference aligned with the already-correct description/reference context.
- Keep the fix as narrow and local as possible.

## What To Change

- Recover full structured capture for customer-provided references with three or more segments.
- Ensure suffix segments are preserved rather than truncated.
- Ensure corrected or restated references also preserve their full value.
- Preserve the already-working account extraction, correction propagation, phone-number protection, and conversational continuity gains.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged portal/channel clarification recovery, materially improved summary quality, converged account reliability, converged correction propagation, and converged phone-number separation in structured fields.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated extraction or summary polish work outside this blocking path.
- Prefer the smallest viable fix set that improves structured reference fidelity.

## Non-Goals

- Reopening account-field recovery
- Reworking already-working correction propagation
- Broad summary-card redesign
- Generic extraction cleanup outside the listing/reference blocking path
- Broad Jira or submission-path work

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys more reliably:

- preserve full multi-segment listing/reference IDs in the structured field
- keep structured references aligned with the full reference preserved elsewhere in the summary state
- continue excluding phone-number-shaped values from identifier fields

Optimise for:

- full reference preservation
- structured-field fidelity
- no regression in recently-converged structured-field gains
- preservation of earlier conversational continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated extraction improvements
- generic summary rewrites

Preferred behavioural shape:

- the customer’s full alphanumeric reference survives intact in the structured `listingId` field
- suffix segments are preserved
- corrections do not reintroduce truncation
- phone numbers still do not appear as identifiers

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal preserves full multi-segment alphanumeric references in the structured field for the tested slice.
- Eval can assess the change through the running software only.
