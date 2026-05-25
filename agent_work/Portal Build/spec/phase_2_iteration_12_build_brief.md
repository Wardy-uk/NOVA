# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, summary rendering, natural summary confirmation recognition, working summary edits, improved account extraction, and improved bundled URL capture.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 12.

## Build Slice

- Name: Deep summary-quality and sequencing hardening
- Goal: Improve concrete-problem verification, subject consistency, description quality, and preserve summary review when the system itself offers ticket creation.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The broader Phase 2 continuity problems are now materially reduced, but four summary-boundary quality gaps remain:

- vague follow-up answers are not always checked for a concrete problem before the journey progresses
- subject generation is still inconsistent across journeys
- description fields are still too verbatim and transcript-like
- when the system itself offers ticket creation mid-conversation, accepting that offer can still skip summary review

There is also a related residual gap:

- account extraction can still regress when the journey progresses without explicitly eliciting the account first

## Desired User Outcome

A customer should be able to:

- answer a vague follow-up with a real problem description and have that recognised before the journey moves on
- see a cleaner, more issue-focused subject and a less noisy description in summary
- review the summary before submission even when the system itself offers to create a ticket mid-conversation
- avoid having message text misused as the account name because the journey progressed too early

## Desired Operational Outcome

Support should receive clearer summary data, and customers should experience a more deliberate, review-first transition into submission with fewer noisy or misassigned fields.

## Scope For This Slice

- Focus on vague follow-up answers that still do not verify a concrete problem.
- Focus on subject and description quality in the tested summaries.
- Focus on preserving summary review when the system-initiated ticket offer is accepted.
- Focus on avoiding account-field regression caused by premature summary progression.
- Keep the fix as narrow and local as possible.

## What To Change

- Ensure that after a vague opener, the user's follow-up must contain an actual problem description before the journey progresses.
- Improve subject generation consistency so more summaries reflect the actual issue rather than raw message text.
- Improve description quality so the summary is less like a raw transcript dump.
- Ensure that accepting a system-offered ticket creation prompt still routes through summary review before submission is attempted.
- Prevent account fields from being filled with problem-description text when account data has not actually been gathered.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, summary rendering, natural summary confirmation recognition, working summary edits, improved account extraction, and improved bundled URL capture.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves summary quality and sequencing consistency.

## Non-Goals

- Reopening property-question narrowing
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- verify the actual problem before vague journeys progress
- produce cleaner, more consistent issue-focused subjects
- produce less transcript-like descriptions
- show summary before submission when system-offered ticket creation is accepted
- avoid account-field misassignment caused by premature progression

Optimise for:

- better concrete-problem verification after vague follow-up answers
- cleaner subject/description quality
- preserved summary review step in system-offer flows
- reduced account-field regression
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- vague journeys do not progress until the follow-up contains a real problem description
- subjects consistently reflect the issue rather than the greeting or vague opener
- descriptions are cleaner than raw message concatenation
- system-offered ticket creation still leads through summary review
- account fields are not populated with problem text

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal verifies concrete problems more reliably, produces cleaner summaries, preserves summary review in system-offer flows, and avoids account-field regression in the tested slice.
- Eval can assess the change through the running software only.
