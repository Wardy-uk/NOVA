# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged portal/channel clarification recovery, and the materially improved user-facing summary experience.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 21.

## Build Slice

- Name: Structured-field fidelity recovery
- Goal: Bring structured summary fields up to the same quality bar as the synthesized description.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The synthesized description quality is now materially better, but the structured fields that sit beside it are still unreliable in some important ways:

- account fields can regress and capture unrelated fragments
- structured fields do not always refresh after corrections that the description has already absorbed
- listing/reference extraction remains weak, especially for alphanumeric refs and phone-number separation

This creates an internal inconsistency where the visible summary looks more trustworthy than the individual fields support staff would rely on downstream.

## Desired User Outcome

A customer should be able to:

- provide an account name and see the correct account reflected in the summary
- correct an address, URL, or reference and see the structured field update along with the summary description
- provide a listing/reference ID without it being lost or confused with a phone number

## Desired Operational Outcome

Support should receive clean, up-to-date structured fields that match the latest corrected summary:

- correct account
- correct property/reference data
- correct URL
- no phone-number contamination

## Scope For This Slice

- Focus on account-field regression recovery.
- Focus on structured-field refresh after corrections are made.
- Focus on alphanumeric listing/reference extraction and phone-number separation.
- Keep the fix as narrow and local as possible.

## What To Change

- Recover account extraction so the field contains the actual account name rather than stray conversational fragments.
- Ensure that when later user input or corrections change key details, the corresponding structured fields are refreshed, not just the synthesized description.
- Improve listing/reference extraction so alphanumeric refs like `ABC-12345`, `BP-2024-001`, and `ML-9877` are captured reliably while phone numbers remain excluded.
- Preserve the already-working summary synthesis and conversational flow gains.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged portal/channel clarification recovery, and the materially improved user-facing summary experience.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves structured-field fidelity.

## Non-Goals

- Reopening portal/channel clarification recovery
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys more reliably:

- keep the account field clean and correct
- propagate corrections into structured fields as well as description
- capture alphanumeric listing/reference IDs without letting phone numbers through

Optimise for:

- stronger structured-field fidelity
- better correction propagation
- cleaner account carry-through
- better listing/reference accuracy
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- the account field contains the actual account name
- corrected property/url/reference details are reflected in the structured fields
- listing/reference IDs survive, phone numbers do not
- the structured fields align with the clean synthesized description

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal produces cleaner account fields, better correction propagation, and more reliable listing/reference extraction in the tested slice.
- Eval can assess the change through the running software only.
