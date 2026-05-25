# Portal Phase3 Plan — Edge-Case Routing Sensitivity Hardening

## Phase

- Name: Edge-case routing sensitivity hardening
- Goal: Close two deferred customer-visible routing misses without reopening broader deterministic routing or follow-up domains.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: obvious edge-case phrasings should land on the intended path instead of a near-miss path.
- Both issues are local detection/precedence defects, not new product domains.
- Can be evaluated independently through a very small runtime scenario set.

## Inputs

- Deterministic routing convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-25_deterministic_routing_convergence_decision.md`
- Follow-up convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-24_followup_convergence_decision.md`
- Slice spec: `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_holdouts.md`

## Build Brief

- Change target: harden two known routing sensitivity misses in the conversational path.
- Constraints: preserve protected and converged domains, avoid broad routing redesign, and keep changes local to precedence/pattern handling.
- Non-goals: shared-config consolidation, general LLM cleanup, and unrelated taxonomy/routing refactors.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify the two named edge cases through the running portal
- The two deferred misses no longer occur in the tested slice
