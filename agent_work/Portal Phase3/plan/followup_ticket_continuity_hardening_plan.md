# Portal Phase3 Plan — Follow-Up Ticket Continuity Hardening

## Phase

- Name: Reopened / follow-up ticket continuity hardening
- Goal: Close the specific blockers preventing convergence of the follow-up continuity slice.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: recognised follow-up requests reliably behave like continuity journeys with visible referenced-ticket context.
- Touches an existing partial behaviour rather than introducing a new domain.
- Can be evaluated independently through the runtime path with a small scenario set.

## Inputs

- Slice spec: `agent_work/Portal Phase3/spec/followup_ticket_continuity.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/followup_ticket_continuity_eval_standard.md`
- Eval report: `agent_work/Portal Phase3/eval_output/iteration2_followup_continuity_eval.md`
- Manager decision: `agent_work/Portal Phase3/manager_log/2026-05-24_followup_eval_decision.md`

## Build Brief

- Change target: fix the observed blockers in trigger coverage and referenced-ticket context hydration.
- Constraints: preserve already-working continuation behaviour, keep scope local to follow-up continuity, and avoid reopening unrelated conversational-routing work.
- Non-goals: complaint workflow, general conversational detection expansion, pure status-check redesign, and unrelated routing changes.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify the two primary phrasings and runtime context preservation through the running portal
- Recognised follow-up journeys show the referenced-ticket continuity behaviour rather than partial or misleading continuity
