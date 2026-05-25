# Portal Phase3 Plan — Follow-Up Ticket Continuity Final Hardening

## Phase

- Name: Reopened / follow-up ticket continuity final hardening
- Goal: Close the final convergence blocker and remove the remaining unnecessary repetition in the follow-up path.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: the most common follow-up phrasing now reliably enters the continuation path and uses the known ticket reference coherently.
- Touches one existing routing conflict plus two tightly-coupled continuity behaviours.
- Can be evaluated independently through a very small runtime scenario set.

## Inputs

- Slice spec: `agent_work/Portal Phase3/spec/followup_ticket_continuity.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/followup_ticket_continuity_eval_standard.md`
- Eval report: `agent_work/Portal Phase3/eval_output/iteration3_followup_continuity_eval.md`
- Manager decision: `agent_work/Portal Phase3/manager_log/2026-05-24_followup_iteration3_eval_decision.md`

## Build Brief

- Change target: remove frustration-handler preemption for canonical follow-up phrasing and ensure the known ticket key is used through the intended follow-up path.
- Constraints: preserve the already-working follow-up cases and avoid broad conversational redesign.
- Non-goals: Jira cache completeness, pure status-check redesign, mixed-intent priority redesign, and unrelated routing work.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify `still not fixed` + ticket reference, direct related-ticket summary behaviour, and no redundant ticket-ref request through the running portal
- No remaining critical blocker prevents convergence of the follow-up continuity slice
