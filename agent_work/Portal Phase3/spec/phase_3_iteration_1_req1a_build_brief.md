# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Portal Phase3 Iteration 1.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless the brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 1.

## Build Slice

- Name: Req 1A — Missing intake category completion
- Goal: Complete the missing portal intake category coverage identified in the 24 May 2026 gap analysis using the smallest fast-slice that keeps portal behaviour stable.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The portal currently lacks four request types as intake categories:

- Website Security
- General Service Request
- Reopened / Follow-up
- Complaint / Escalation

This leaves the intake surface incomplete relative to the active Req 1 target.

## Desired User Outcome

A customer using the portal can start a request under each of the four missing request types and experience a coherent basic intake path rather than a missing or obviously unsupported route.

## Desired Operational Outcome

Support receives usable intake coverage for the four missing request types without destabilising already-converged portal behaviour.

## Scope For This Slice

- Focus on making the four missing request types exist as supported portal intake categories.
- Focus on basic customer-safe question/template coverage for each category.
- Focus on preserving a coherent portal new-request experience.
- Focus on the smallest viable change that closes the intake coverage gap quickly.

## What To Change

- Add Website Security as a portal intake category.
- Add General Service Request as a portal intake category.
- Add Reopened / Follow-up as a portal intake category.
- Add Complaint / Escalation as a portal intake category.
- Ensure each category has a usable basic intake path rather than a dead-end or placeholder-only path.
- Keep labels and wording customer-safe.

## Constraints

- Preserve existing portal submission behaviour outside this slice.
- Preserve already-converged website and property portal behaviour.
- Do not expose internal routing teams, implementation language, or operational taxonomy.
- Do not treat this slice as the full solution for reopened continuity behaviour.
- Do not treat this slice as the full solution for complaint-management escalation behaviour.
- Avoid broad portal redesign.
- Prefer the smallest viable change that materially closes the missing-category gap.

## Non-Goals

- Original-handler routing for follow-up requests
- Linked reopened-ticket operational workflow
- Complaint-management notification, bypass, or management alerting
- Full deterministic routing expansion for all categories
- Shared client/server config consolidation as a standalone refactor
- KB deflection governance work

## Build Agent Instructions

Implement the smallest viable change that makes the four missing request types genuinely present in portal intake and basically usable.

Optimise for:

- fast coverage completion
- safe customer-facing labels
- coherent intake entry
- low regression risk
- preservation of existing portal gains

Do not optimise for:

- deep workflow redesign
- speculative architecture work
- unrelated portal clean-up
- solving later slices early

Preferred behavioural shape:

- the customer can select or enter each missing request type through the portal intake surface
- the portal behaves as if the request type is supported
- the customer is not shown internal taxonomy or routing mechanics
- the path remains a basic intake path, not an overclaimed special workflow

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.
- The running portal supports the four missing request types as intake categories in the tested slice.
- Eval can assess the change through the running software only.
