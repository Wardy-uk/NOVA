# Claude Code Prompt — Build Agent

## Role

You are the Build Agent for Portal Phase3 Iteration 5.

## Responsibilities

- Read source code and make implementation changes only within the scope of this brief.
- Deliver the smallest viable behavioural improvement for the active slice.
- Preserve already-converged portal behaviour unless the brief explicitly requires a local change.
- Write a factual readiness note to `agent_work/Portal Phase3/build_status/` when the slice is ready for evaluation.
- Do not request or use evaluation criteria, holdout scenarios, or evaluator scoring logic.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 5.

## Build Slice

- Name: Complaint / escalation operational behaviour
- Goal: Make clear complaints and escalation requests behave like a real portal complaint path rather than generic intake.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The portal now has a `Complaint / Escalation` intake category from Req 1A, but the active gap analysis says the portal still lacks:

- a complaint-aware conversational path
- a meaningful operational escalation outcome
- complaint-specific handling beyond generic intake

The customer should not have to rely on ordinary request handling when they are clearly making a complaint or asking for escalation.

## Desired User Outcome

A customer who says they want to complain or escalate an issue should experience a path that acknowledges that context, preserves what they said, and helps them move forward appropriately.

The customer should not feel ignored, softened into a generic request path, or shown internal operational mechanics.

## Desired Operational Outcome

Support/operations should receive a usable complaint/escalation request that clearly preserves the complaint context and behaves differently enough from ordinary intake to count as a real escalation-aware outcome.

## Scope For This Slice

- Focus on clear complaint messages.
- Focus on clear escalation requests.
- Focus on the immediate behaviour after the complaint/escalation intent is recognised.
- Focus on preserving complaint context through the resulting intake/summary path.

## What To Change

- Strengthen the behavioural path for complaint and escalation intent.
- Make the portal treat clear complaints as a first-class intake case rather than only generic support intake.
- Preserve the customer’s complaint detail and escalation intent in the resulting path.
- Keep the resulting behaviour safe, understandable, and customer-facing.

## Constraints

- Preserve existing portal behaviour outside this slice.
- Preserve Req 1A category coverage.
- Preserve converged follow-up continuity behaviour.
- Do not expose internal routing teams, project keys, implementation language, or operational taxonomy.
- Do not collapse this slice into broad queue redesign, dashboard/reporting work, or unrelated routing cleanup.
- Prefer the smallest viable change that makes the complaint path materially real.

## Non-Goals

- Full management dashboarding or reporting
- Broad queue architecture redesign
- General service-request routing redesign
- KB deflection governance work
- Shared config refactor as a standalone task

## Build Agent Instructions

Implement the smallest viable change that makes clear complaints and escalation requests feel intentional, complaint-aware, and operationally useful.

Optimise for:

- complaint/escalation recognition
- preservation of dissatisfaction context
- clear customer-facing progression
- hidden operational complexity
- low regression risk

Do not optimise for:

- broad workflow redesign
- speculative architecture work
- unrelated conversational cleanup
- future reporting/dashboard work

Preferred behavioural shape:

- the customer expresses complaint or escalation intent
- the portal recognises that context
- the next step reflects that this is not just an ordinary request
- the resulting request clearly preserves the complaint/escalation context

## Output

- Make the required implementation changes in the codebase.
- Write a concise completion note to `agent_work/Portal Phase3/build_status/` describing:
- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

## Done Signal

- Build Agent writes a readiness note to `agent_work/Portal Phase3/build_status/`.
- The running portal handles clear complaint/escalation requests as a coherent complaint-aware path in the tested slice.
- Eval can assess the change through the running software only.
