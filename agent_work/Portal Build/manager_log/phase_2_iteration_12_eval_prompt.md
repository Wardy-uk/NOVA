# Claude Code Prompt — Eval Agent

## Role

You are the Eval Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Evaluate the running software behaviourally only.
- Read evaluation-facing material as needed for this prompt, but do not inspect source code, diffs, or build-status notes.
- Judge what the product does, not how it was built.
- Write results to `agent_work/Portal Build/eval_output/`.
- Keep findings focused on observable summary-quality and sequencing consistency in the tested slice.

## Phase And Slice

This prompt is for Phase 2 Iteration 12.

## Phase Context

Earlier Phase 2 work has already materially improved:

- conversational activation
- hidden routing
- natural clarification
- stable non-looping failure handling
- property-question narrowing
- natural summary confirmation recognition
- working summary edits
- improved account extraction
- improved bundled URL capture

The current remaining gaps are now mostly about summary-quality and sequencing consistency:

- vague follow-up answers still do not always get verified as concrete problems
- subject generation remains inconsistent
- descriptions remain too transcript-like
- system-offered ticket creation can still bypass summary review
- account fields can still regress when the journey progresses too early

## Your Evaluation Objective

Evaluate whether the current portal now provides a more consistent and trustworthy summary boundary.

## What To Observe

Assess the running experience for:

- whether vague follow-up answers now need to contain a real problem before the journey progresses
- whether subject generation is more consistently issue-focused
- whether descriptions are less like raw transcript dumps
- whether accepting a system-offered ticket creation prompt still preserves summary review
- whether account-field regression is reduced
- whether earlier conversational continuity gains remain intact

## Behavioural Questions To Answer

- Do vague journeys now verify the actual problem before progressing?
- Are summary subjects more consistently issue-focused?
- Are summary descriptions cleaner and less transcript-like?
- When the system offers ticket creation mid-conversation and the user accepts, is summary review still shown before submission?
- Are account fields less likely to be populated with problem-description text?
- Were any earlier Phase 2 conversational gains lost while improving summary-quality and sequencing consistency?

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
- whether vague follow-up answers were verified as concrete problems before progressing
- whether subject consistency improved
- whether description quality improved
- whether summary review was preserved in system-offered ticket flows
- whether account-field regression improved
- whether earlier conversational continuity remained intact
- whether this slice appears converged, partially converged, or not yet converged
