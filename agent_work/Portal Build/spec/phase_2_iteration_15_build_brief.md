# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, improved bundled URL capture, converged vague follow-up verification, converged multi-field summary edits, and metadata/visible-summary alignment.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 15.

## Build Slice

- Name: Summary synthesis reliability and extraction cleanup
- Goal: Make summary synthesis fire more consistently, improve inline account extraction, and strip filler language from edit values.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The broader Phase 2 continuity and summary-fidelity problems are now materially reduced, but three reliability gaps remain:

- description synthesis still does not fire on all journeys, especially some multi-turn problem-report paths
- account extraction still occasionally captures trailing text or misses inline account information
- field values extracted from natural-language edit requests can still include filler wording such as "just be" or other instruction text

These are now refinement issues, but they still affect the quality and trustworthiness of the final summary experience.

## Desired User Outcome

A customer should be able to:

- see a clean synthesized description consistently across similar summary journeys
- provide account information inline with other details without it being missed or polluted by trailing text
- request summary edits in natural language without filler words appearing in the resulting field values

## Desired Operational Outcome

Support should receive cleaner summary content more consistently, with more accurate account fields and cleaner edited values in the downstream summary data.

## Scope For This Slice

- Focus on summary journeys where description synthesis is currently inconsistent.
- Focus on inline/mixed-context account extraction quality.
- Focus on cleanup of values extracted from natural-language edit requests.
- Keep the fix as narrow and local as possible.

## What To Change

- Improve synthesis triggering so clean description synthesis appears more consistently across comparable summary paths, especially multi-turn problem journeys.
- Strengthen account extraction so inline account mentions are captured more reliably and trailing text is stripped more effectively.
- Clean extracted edit values so filler phrases and instruction residue are not retained in the updated fields.
- Preserve the already-working vague verification, summary review, multi-field edit mechanics, and metadata alignment.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, improved bundled URL capture, converged vague follow-up verification, converged multi-field summary edits, and metadata/visible-summary alignment.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves synthesis reliability and extraction cleanup.

## Non-Goals

- Reopening property-question narrowing
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- produce synthesized descriptions more consistently
- extract inline account names more cleanly
- strip filler wording from edited field values

Optimise for:

- stronger synthesis consistency
- more robust inline account extraction
- cleaner field values after edit requests
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- multi-turn problem journeys consistently show clean synthesized descriptions
- account fields contain just the account name even when provided inline with other details
- edit requests do not leave instruction residue in the updated values

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal produces more consistent synthesized descriptions, cleaner inline account extraction, and cleaner edit values in the tested slice.
- Eval can assess the change through the running software only.
