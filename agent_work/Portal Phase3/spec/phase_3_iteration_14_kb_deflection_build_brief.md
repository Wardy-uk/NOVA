# Portal Phase3 Iteration 14 Build Brief

## Role

You are the Build Agent for Portal Phase3 Iteration 14.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless this brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 14.

Build Slice:

- Name: KB deflection baseline and target
- Goal: Make KB deflection performance visible against the 20-30% target through a small runtime-usable operational surface.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The portal already tracks KB deflection, but the original analysis still identified missing governance outcome:

- no clear baseline
- no explicit target threshold
- no simple progress outcome against the 20-30% objective

## Desired Operational Outcome

An operator using the running software can tell:

- the current KB deflection rate
- the configured target band
- whether current performance is below target, within target, or above target

## Scope For This Slice

Focus on the smallest viable runtime-visible governance outcome.

What to change:

- expose a current KB deflection baseline
- add or surface a target band for the 20-30% objective
- expose simple status against that target band

## Constraints

- Preserve existing KB suggestion, deflection tracking, and helpfulness behaviour.
- Do not widen this into broad dashboard/reporting redesign.
- Do not reopen unrelated routing, taxonomy, complaint, or shared-config work.
- Prefer the smallest viable change that makes the KB target operationally real.

## Non-Goals

- broad analytics or BI work
- KB content optimisation tooling
- recommendation/ranking redesign
- unrelated portal admin cleanup

## Output

Make the required implementation changes in the codebase.

Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:

- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.

The running portal exposes a small but real KB deflection baseline/target outcome that evaluation can judge through software behaviour only.
