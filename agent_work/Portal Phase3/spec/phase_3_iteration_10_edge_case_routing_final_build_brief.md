# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Portal Phase3 Iteration 10.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless the brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 10.

## Build Slice

- Name: Edge-case routing final hardening
- Goal: Close the remaining routing-sensitivity defects without reopening broader domain work.
- Owner: Build Agent

## Behavioural Gaps Being Addressed

Three local defects remain:

1. `NT-XXXXX is not fixed` follow-up routing is inconsistent across ticket numbers
2. letters precedence overcorrects and steals website-primary requests
3. website wording with `property` still misroutes to property in a protected control case

## Desired User Outcome

A customer should get the intuitively correct route for these edge cases:

- `NT-12345 is not fixed` should reach follow-up reliably
- website-primary requests should remain website even if letters are mentioned incidentally
- `property images on my website are not loading` should remain website

## Desired Operational Outcome

These routes should become locally reliable without destabilising protected domains or reopening broader routing work.

## Scope For This Slice

- Focus only on the three named routing defects.
- Focus on local precedence/pattern/disambiguation changes needed to fix them.
- Focus on the smallest viable change that closes the misses and regression.

## What To Change

- Make `is not fixed` follow-up detection stable across representative ticket numbers.
- Add a guard so letters precedence only wins when correspondence is clearly the main request.
- Protect website intent when `property` appears as website content/context rather than portal-listing intent.

## Constraints

- Preserve all protected domains, including Req 1A, follow-up continuity, complaint-aware behaviour, website, and property paths.
- Do not expose internal routing mechanics or implementation terms.
- Do not widen this into complaint metadata work, shared-config work, or broad intent redesign.
- Prefer the smallest viable local fix that closes the three named issues.

## Non-Goals

- Shared-config consolidation
- Broad letters/website mixed-intent redesign
- Broad follow-up lexical expansion beyond stabilising the named phrase
- Complaint metadata/structured-state cleanup

## Build Agent Instructions

Implement the smallest viable final hardening change that makes these edge-case routes reliable without disturbing protected behaviour.

Optimise for:

- local routing determinism
- customer-visible correctness
- low regression risk

Do not optimise for:

- broad architecture changes
- unrelated cleanup
- speculative improvements outside the three named defects

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.
- The running portal handles the three named routing defects correctly in the tested slice.
- Eval can assess the change through the running software only.
