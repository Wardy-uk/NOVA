# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, summary-body wording, and summary-stage confirmation recognition.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 6.

## Build Slice

- Name: Multi-turn progression plus submission recovery
- Goal: Restore reliable multi-turn progression into summary and recover a working ticket-creation path once summary is reached.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The conversational flow now works well in short, dense journeys and summary-stage chat confirmation is recognized, but two major blockers remain:

- longer conversational journeys still get trapped in detail-stage clarification when already-provided account/error details are not captured
- once summary is reached, ticket creation still fails through every tested path because of a downstream Jira creation failure

There is also a remaining behavioural gap before summary:

- when the system offers to create a ticket during detail stage, customer acceptance is still ignored in some journeys

## Desired User Outcome

A customer who provides details gradually over multiple messages should still be able to progress into summary without being trapped in repetitive clarification.

If the customer accepts a ticket offer before summary, that acceptance should move the journey forward rather than being ignored.

Once summary is reached, ticket creation should complete successfully instead of failing behind the scenes.

## Desired Operational Outcome

Support should receive a successfully created request from both:

- short high-information journeys
- longer multi-turn conversational journeys

without the customer being blocked by extraction misses, ignored ticket acceptance, or Jira creation failure.

## Scope For This Slice

- Focus on multi-turn conversational journeys that provide account/error context gradually.
- Focus on detail-stage ticket-offer acceptance when the customer says yes before summary.
- Focus on the downstream Jira creation failure once summary is reached.
- Keep the change as narrow and local as possible.

## What To Change

- Improve the path that captures already-provided account/error details in the tested multi-turn journeys so they can reach summary reliably.
- Make detail-stage acceptance of a ticket offer progress correctly instead of being ignored.
- Fix the downstream submission path that currently fails uniformly at Jira ticket creation.
- Preserve earlier conversational continuity gains while restoring reliable end-to-end completion.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, summary-body wording, and summary-stage confirmation recognition.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable behavioural and downstream fix set that restores reliable completion.

## Non-Goals

- General extraction perfection across every domain
- Reworking successful short-journey paths unless required by the fix
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- Reopening non-conversational intake behaviour

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journey reliably:

- progress from multi-turn clarification into summary
- honour ticket-offer acceptance before summary
- complete Jira ticket creation once summary is reached

Optimise for:

- multi-turn forward progress
- reduced re-asking for already-provided account/error details
- successful downstream submission
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- longer conversational journeys can still reach summary
- "yes, create the ticket" works both before and at summary stage
- once summary is reached, the request can actually be created successfully
- the whole path still feels like one coherent conversational support flow

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal can reliably progress from multi-turn conversational clarification through summary to successful ticket creation in the tested slice.
- Eval can assess the change through the running software only.
