# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, summary rendering, natural summary confirmation recognition, and efficient concrete property-specific handling.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 10.

## Build Slice

- Name: Summary quality and readiness hardening
- Goal: Improve the quality of summary generation and ensure vague journeys gather the actual problem before progressing.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The larger Phase 2 routing and looping problems are now materially reduced, but three narrower quality gaps remain:

- vague journeys still gather account/URL context without establishing what is actually wrong
- summary fields can still be noisy or overly verbatim
- summary edit requests are still ignored or only partially applied

These issues weaken the final quality of the conversational intake experience even though the broader behavioural continuity has improved substantially.

## Desired User Outcome

A customer should be able to:

- describe a vague problem and be asked what is actually wrong before the system offers ticket creation
- see a cleaner summary with a meaningful subject, a clean account field, and less noisy description/person data
- request a correction at summary stage and see that correction reflected in the updated summary

## Desired Operational Outcome

Support should receive cleaner, more accurate summary data from conversational journeys, and customers should see that their clarifications and corrections are actually reflected before the journey ends.

## Scope For This Slice

- Focus on vague journeys that currently gather who/where but not what.
- Focus on summary field quality in the tested conversational paths.
- Focus on processing summary edit requests so they visibly update the summary.
- Keep the fix as narrow and local as possible.

## What To Change

- Ensure vague journeys gather the actual problem statement before collapsing into summary or ticket-offer flow.
- Improve summary field quality so account/subject/person/description are cleaner and less verbatim in the tested paths.
- Make summary edit requests apply to the relevant fields and re-render correctly.
- Preserve the already-working property-question narrowing, stable failure handling, and natural confirmation behaviour.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, stable non-looping failure handling, property-question narrowing, summary rendering, natural summary confirmation recognition, and efficient concrete property-specific paths.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that improves summary readiness and summary quality.

## Non-Goals

- Reopening property-question narrowing
- Reworking already-working stable failure handling
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- General extraction perfection across every field/domain

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- ask what is actually wrong before vague journeys progress too far
- produce cleaner summary fields
- apply summary edit requests visibly and correctly

Optimise for:

- better vague-journey problem elicitation
- cleaner account/subject/person/description fields
- working summary edits
- preservation of earlier Phase 2 gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- vague journeys do not move forward until the actual issue is clearer
- summaries look cleaner and less like raw transcript dumps
- asking to change a field at summary stage updates the summary
- the broader conversational continuity gains from earlier loops remain intact

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal gathers the actual problem before vague journeys progress, produces cleaner summaries, and applies summary edits in the tested slice.
- Eval can assess the change through the running software only.
