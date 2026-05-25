# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged vague follow-up verification, metadata/visible-summary alignment, and description synthesis consistency when summary is reached.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 18.

## Build Slice

- Name: Portal/channel clarification recovery
- Goal: Restore reliable progression to summary by preventing portal/channel clarification from becoming the next mandatory loop.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The prior URL clarification loop is materially improved, but a new loop has replaced it:

- the system can get stuck on "is this affecting your website, Rightmove, Zoopla, or somewhere else?" and never progress

This matters most in property-related journeys where:

- a website URL is already known
- the user has already provided enough useful problem context
- the channel choice is either inferable or not important enough to block forward progress indefinitely

There is also a smaller related extraction gap:

- account fields can still pick up fragments in some mixed messages

## Desired User Outcome

A customer should be able to:

- provide a website URL and have the system infer a website-related channel when appropriate
- avoid getting trapped in repeated portal/channel clarification once enough context already exists
- progress to summary once the issue is sufficiently understood

## Desired Operational Outcome

Support should receive a usable routed request without the customer being blocked on a clarification field that can often be inferred or safely defaulted.

## Scope For This Slice

- Focus on the portal/channel clarification question and its surrounding logic.
- Focus on property-related and website-related journeys where a URL or equivalent channel clue is already present.
- Focus on preventing repeated re-asking of the portal/channel choice when enough context exists to move forward.
- Focus secondarily on remaining account-fragment leakage in mixed messages.
- Keep the fix as narrow and local as possible.

## What To Change

- Infer `website` when a website URL is already present and no stronger contradictory signal exists.
- Prevent portal/channel clarification from becoming an indefinite blocker after one failed or ambiguous attempt.
- Allow the journey to move forward when enough useful issue detail exists, even if the channel choice is not perfectly explicit.
- Further reduce account-field fragment leakage where it still appears in the tested paths.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, converged vague follow-up verification, metadata/visible-summary alignment, and description synthesis consistency when summary is reached.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that restores summary reachability by relaxing or inferring the portal/channel field where safe.

## Non-Goals

- Reopening URL recognition improvements that now work
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- stop looping on portal/channel clarification
- infer website/channel context when the URL already makes it obvious
- progress to summary once the issue is sufficiently understood
- reduce remaining mixed-message account fragment leakage

Optimise for:

- fewer clarification loops
- stronger summary reachability
- sensible channel inference/defaulting
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- if a website URL is already known, the journey does not get stuck asking which channel is affected
- ambiguous portal/channel answers do not block progress forever
- more property/website journeys reach summary cleanly
- account fields remain clean in mixed messages

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal reaches summary more reliably by avoiding portal/channel clarification loops and inferring website context where appropriate in the tested slice.
- Eval can assess the change through the running software only.
