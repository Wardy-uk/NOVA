# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Portal Phase3 Iteration 9.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless the brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 9.

## Build Slice

- Name: Edge-case routing sensitivity hardening
- Goal: Fix two deferred customer-visible routing misses without reopening broader routing domains.
- Owner: Build Agent

## Behavioural Gaps Being Addressed

Two known misses remain:

1. Mixed letters/correspondence requests that mention website detail can still let website precedence win
2. Follow-up phrasing `NT-XXXXX is not fixed` without `still` remains sensitivity-prone

## Desired User Outcome

A customer asking for letters/correspondence should land on the letters path even if they mention website detail incidentally.

A customer saying their ticket `is not fixed` should reach the follow-up path even if they do not say `still`.

## Desired Operational Outcome

The portal should route these two cases in the intuitively correct way while leaving already protected behaviours untouched.

## Scope For This Slice

- Focus only on the two named routing-sensitivity misses.
- Focus on local precedence/pattern changes needed to make those routes reliable.
- Focus on the smallest viable change that closes the named misses.

## What To Change

- Harden letters/correspondence precedence for the mixed letters+website case where letters is clearly the real intent.
- Harden follow-up detection for `ticket is not fixed` phrasing without requiring `still`.
- Preserve protected-domain routing behaviour.

## Constraints

- Preserve all protected domains, including Req 1A category coverage, follow-up continuity, complaint-aware behaviour, website, and property paths.
- Do not expose internal routing mechanics or implementation terms.
- Do not widen this into shared-config work or broader routing-table cleanup.
- Prefer the smallest viable local change that closes the two named misses.

## Non-Goals

- Shared-config consolidation
- Broad letters/website precedence redesign
- Broad follow-up phrase expansion
- Complaint, property, or website feature changes unless required by a direct regression fix

## Build Agent Instructions

Implement the smallest viable hardening change that makes these two edge-case routes behave correctly and predictably.

Optimise for:

- local precedence/pattern reliability
- customer-visible coherence
- low regression risk

Do not optimise for:

- broad intent-cascade redesign
- unrelated cleanup
- speculative architectural improvements

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.
- The running portal handles the two named routing-sensitivity cases correctly in the tested slice.
- Eval can assess the change through the running software only.
