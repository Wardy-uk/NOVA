# Claude Code Prompt — Eval Agent

## Role

You are the Eval Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Evaluate the running software behaviourally only.
- Read evaluation-facing material as needed for this prompt, but do not inspect source code, diffs, or build-status notes.
- Judge what the product does, not how it was built.
- Write results to `agent_work/Portal Build/eval_output/`.
- Keep findings focused on observable URL clarification behaviour and mixed-field extraction cleanliness in the tested slice.

## Phase And Slice

This prompt is for Phase 2 Iteration 17.

## Phase Context

Earlier Phase 2 work has already materially improved:

- conversational activation
- hidden routing
- natural clarification
- stable non-looping failure handling
- property-question narrowing
- natural summary confirmation recognition
- preserved summary review in system-offer flows
- description synthesis consistency when summary is reached

The current dominant blocker is now summary reachability:

- conversations often loop on URL clarification even when a URL has already been provided

Related remaining issues include:

- mixed account/URL messages still contaminating field extraction
- phone numbers contaminating listing/reference fields

## Your Evaluation Objective

Evaluate whether the current portal now provides more reliable progression into summary by handling URLs and mixed fields better.

## What To Observe

Assess the running experience for:

- whether provided URLs are captured reliably
- whether the system stops re-asking for URLs that were already given
- whether account, URL, and listing/reference fields are kept separate in mixed messages
- whether phone numbers still contaminate listing/reference fields
- whether more journeys now reach summary
- whether earlier conversational continuity gains remain intact

## Behavioural Questions To Answer

- When the user provides a URL, is it captured and reused correctly?
- Does the system avoid repeated URL clarification once the URL is known?
- Are account, URL, and listing/reference fields cleaner and less cross-contaminated in mixed messages?
- Are phone numbers still being misread as listing/reference IDs?
- Do these fixes make it easier for journeys to reach summary?
- Were any earlier Phase 2 conversational gains lost while improving URL and mixed-field handling?

## Guardrails

- Evaluate through UI, API, or CLI interaction only.
- Do not judge based on probable implementation.
- Do not use source-code awareness to fill in missing behavioural evidence.
- Do not inspect source code, implementation notes, or build-status files.
- Preserve Phase 1 as the baseline for already-converged behaviours.
- Preserve earlier Phase 2 gains as the baseline for already-converged behaviour.
- If you find issues outside this phase, note them separately rather than expanding scope mid-pass.

## Output Expectation

Write a behavioural evaluation note to `agent_work/Portal Build/eval_output/` that clearly states:

- what journeys were tested
- whether URL capture improved
- whether repeated URL clarification was reduced
- whether mixed-field contamination improved
- whether phone-number contamination improved
- whether summary reachability improved
- whether earlier conversational continuity remained intact
- whether this slice appears converged, partially converged, or not yet converged
