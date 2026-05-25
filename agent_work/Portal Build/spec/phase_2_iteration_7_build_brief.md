# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Phase 2 — Conversational Intake Continuity.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve all converged Phase 1 behaviour.
- Preserve the earlier Phase 2 gains around conversational activation, hidden routing, natural clarification, summary rendering, and summary-stage confirmation recognition.
- Write a factual readiness note to `agent_work/Portal Build/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Phase 2 Iteration 7.

## Build Slice

- Name: Jira submission recovery plus website-flow unblocking
- Goal: Restore a working ticket-creation path and remove the Website/Listings clarification dead-end that blocks progression.
- Owner: Build Agent

## Behavioural Gap Being Addressed

Two blockers now dominate the remaining Phase 2 gap:

- once the journey reaches submission, Jira ticket creation fails through every tested path
- in longer Website/Listings journeys, the detail stage keeps demanding property-specific information even when the customer has clearly described a site-wide issue

These two issues prevent reliable completion even though conversational activation, hidden routing, and short-journey summary behaviour are already in much better shape.

## Desired User Outcome

A customer should be able to:

- progress through a Website/Listings support journey without being trapped in repeated property-address questions when the issue is clearly site-wide
- reach summary when enough information has been gathered
- successfully create the ticket once summary is confirmed

## Desired Operational Outcome

Support should receive a successfully created request from these conversational journeys without the customer being blocked by:

- a broken Jira creation path
- category-inappropriate clarification that prevents forward progress

## Scope For This Slice

- Focus on the downstream Jira ticket creation failure across the tested submission paths.
- Focus on Website/Listings detail-stage progression when the customer indicates there is no single affected property.
- Focus on detail-stage ticket-offer acceptance only where it overlaps with these blocked flows.
- Keep the fix as narrow and local as possible.

## What To Change

- Fix the downstream Jira creation path so submission can actually complete.
- Adjust the Website/Listings conversational detail path so site-wide issues are not forced into repeated property-specific questioning.
- Ensure that once a blocked Website/Listings journey has enough usable detail, it can move forward toward summary instead of looping.
- Preserve earlier conversational continuity gains while restoring actual completion.

## Constraints

- Preserve all converged Phase 1 behaviour.
- Preserve earlier Phase 2 conversational activation, hidden-routing behaviour, natural clarification, summary rendering, and summary-stage confirmation recognition.
- Do not redesign the portal broadly.
- Do not replace the support platform or routing model.
- Do not broaden into unrelated ticket-tracking, status-display, or generic UI cleanup work.
- Prefer the smallest viable fix set that restores reliable submission and unblocks the Website/Listings path.

## Non-Goals

- General extraction perfection across every domain
- Reworking already-working short-journey paths unless required by the fix
- Portal-wide summary-card redesign
- Broad architecture changes outside the blocking path
- Reopening non-conversational intake behaviour

## Build Agent Instructions

Implement the smallest viable change that makes the tested conversational journeys reliably:

- escape the Website/Listings property-question dead-end when the issue is site-wide
- progress to summary once enough usable detail exists
- complete Jira ticket creation successfully once summary is confirmed

Optimise for:

- successful downstream Jira submission
- reduced property-specific re-asking in site-wide Website/Listings issues
- preservation of earlier Phase 2 continuity gains
- preservation of Phase 1 behaviour

Do not optimise for:

- broad redesign
- speculative architecture work
- unrelated support experience improvements
- generic extraction improvements outside the tested blocking path

Preferred behavioural shape:

- site-wide website/listings issues no longer get trapped in repeated requests for a specific property address
- once the customer has given enough useful context, the journey reaches summary
- once summary is reached, confirmation successfully creates the ticket
- the whole path still feels like one coherent conversational support flow

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Build/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Build/build_status/`.
- The running portal can complete Jira ticket creation and no longer traps site-wide Website/Listings journeys in property-specific clarification loops in the tested slice.
- Eval can assess the change through the running software only.
