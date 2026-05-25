# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping submission failure handling, property-question narrowing, summary rendering, and efficient concrete property-specific handling.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 9.

## Build Slice

- Name: Summary-boundary quality hardening
- Goal: Improve the late-detail / summary boundary so confirmation works naturally, vague journeys do not jump to summary too early, and account extraction is cleaner.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The major Phase 2 blockers are now materially reduced, but three quality gaps remain:

- summary-stage confirmation text is still treated as additional input rather than as a submission trigger
- vague conversational starts can still reach summary prematurely with poor or noisy fields
- account extraction still captures verbatim phrasing rather than the actual account name in some journeys

These issues weaken the final conversational polish of the intake journey even though the larger routing and looping problems have been addressed.

## Desired User Outcome

A customer should be able to:

- say "yes, that looks right, submit it" at summary stage and have that treated naturally as confirmation
- avoid being shown a premature summary when too little useful detail has been gathered
- see cleaner, more accurate account information in the summary rather than raw fragments of their earlier message

## Desired Operational Outcome

Support should receive cleaner summary data from conversational journeys, and the customer should experience a more coherent transition from clarification into summary and confirmation.

## Scope For This Slice

- Focus on summary-stage natural confirmation handling.
- Focus on the threshold/behaviour that allows vague journeys to jump to summary too early.
- Focus on account extraction quality in the tested conversational paths.
- Keep the fix as narrow and local as possible.

## What To Change

- Make summary-stage natural confirmation phrases behave as a real submission trigger.
- Prevent clearly under-specified vague journeys from collapsing into summary too early.
- Improve account extraction so the account field contains the account name rather than verbatim surrounding text in the tested paths.
- Preserve the already-working property-question narrowing and stable failure end-state.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping submission-failure handling, property-question narrowing, summary rendering, and efficient concrete property-specific paths.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves the late-detail / summary boundary.

## Non-Goals

- Reopening property-question narrowing
- Reworking already-working stable failure handling for unavailable submission
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- treat natural summary confirmation as confirmation
- avoid premature summary when the journey is still too vague
- show cleaner account extraction in summary

Optimise for:

- natural confirmation behaviour at summary stage
- better summary readiness judgement for vague journeys
- cleaner account-field extraction
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- "Yes, that looks correct, please submit" works naturally at summary stage
- vague two-message journeys do not prematurely collapse into a noisy summary
- account fields contain the account name rather than raw conversational fragments
- the broader conversational continuity gains from earlier loops remain intact

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal handles natural summary confirmation, avoids premature vague-summary jumps, and shows cleaner account extraction in the tested slice.
- Eval can assess the change through the running software only.
