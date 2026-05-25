# Manager Log — 2026-05-25 Edge-Case Routing Activation

## Decision

The next active Portal Phase3 slice is:

- Edge-case routing sensitivity hardening

## Why This Slice Now

- Two customer-visible misses were explicitly logged as non-blocking after convergence
- They are worth fixing before shifting fully into structural work
- They are small enough to bundle because both are local detection/precedence issues

## Scope Boundaries

In scope:

- mixed letters + website precedence where letters is the real intent
- follow-up phrasing `ticket is not fixed` without `still`

Out of scope:

- broader letters/website redesign
- broader follow-up lexical expansion
- shared-config consolidation

## Active Artefacts

- `agent_work/Portal Phase3/plan/edge_case_routing_sensitivity_hardening_plan.md`
- `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening.md`
- `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_eval_standard.md`
- `agent_work/Portal Phase3/spec/edge_case_routing_sensitivity_hardening_holdouts.md`
- `agent_work/Portal Phase3/spec/phase_3_iteration_9_edge_case_routing_build_brief.md`
