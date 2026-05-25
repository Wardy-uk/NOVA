# Portal Phase3 Plan — Edge-Case Routing Final Hardening

## Phase

- Name: Edge-case routing final hardening
- Goal: Close the remaining local routing-sensitivity defects without reopening broader domain work.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: the two deferred misses plus one directly related protected-control regression now behave correctly.
- Touches only local precedence/pattern behaviour in the conversational path.
- Can be evaluated independently through a very small runtime scenario set.

## Inputs

- Slice spec: `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_eval_standard.md`
- Eval report: `agent_work/Portal Phase3/eval_output/iteration9_edge_case_routing_sensitivity_eval.md`
- Manager decision: `agent_work/Portal Phase3/manager_log/2026-05-25_edge_case_routing_eval_decision.md`

## Build Brief

- Change target: close the remaining routing-sensitivity defects without widening the slice.
- Constraints: preserve protected domains and avoid broad intent-cascade redesign.
- Non-goals: shared-config consolidation, complaint metadata cleanup, and unrelated routing-table work.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify the named ticket-number follow-up cases, website-vs-letters precedence, and website-vs-property control case
- No remaining critical blocker prevents convergence of this polish slice
