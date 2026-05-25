# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Portal Phase3 Iteration 8.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless the brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 8.

## Build Slice

- Name: Deterministic routing hardening
- Goal: Close the remaining targeted routing gaps identified in the 24 May 2026 portal analysis.
- Owner: Build Agent

## Behavioural Gap Being Addressed

Deterministic routing was previously only partially complete. The active gap analysis specifically called out unresolved routing cases where a known request type should route predictably rather than depending on generic ambiguity handling.

## Desired User Outcome

A customer using one of the targeted routing cases should experience a coherent path that behaves consistently and predictably.

The customer should not be exposed to internal routing mechanics or be bounced into an avoidably ambiguous path when the intended route is already known.

## Desired Operational Outcome

The resulting request should follow the intended deterministic operational path for the targeted cases, without reopening protected Phase 3 behaviours.

## Scope For This Slice

- Focus on the specific targeted routing gaps from the active analysis.
- Focus on the immediate routing behaviour and resulting request/submission outcome.
- Focus on the smallest viable change that makes the targeted routes predictable.

## What To Change

- Harden the targeted deterministic-routing paths so they behave consistently for the intended cases.
- Remove avoidable ambiguity where the route should already be known.
- Preserve customer-safe wording and hidden routing complexity.

## Constraints

- Preserve all protected domains, including Req 1A category coverage, follow-up continuity, complaint-aware behaviour, website, and property behaviours.
- Do not expose internal routing teams, project keys, queue names, or implementation language.
- Do not collapse this slice into a broad routing redesign, shared-config refactor, or unrelated conversational cleanup.
- Prefer the smallest viable change that closes the targeted routing gaps.

## Non-Goals

- Shared client/server config consolidation
- Broad routing-table cleanup across unrelated cases
- Complaint/follow-up feature changes unless required by a direct regression fix
- Dashboarding/reporting or other structural programmes

## Build Agent Instructions

Implement the smallest viable change that makes the targeted routing cases reliably predictable and operationally coherent.

Optimise for:

- deterministic routing consistency
- hidden routing complexity
- customer-visible coherence
- low regression risk

Do not optimise for:

- broad architecture work
- unrelated taxonomy cleanup
- speculative routing redesign

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.
- The running portal handles the targeted routing cases predictably in the tested slice.
- Eval can assess the change through the running software only.
