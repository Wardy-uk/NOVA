# Manager Log — 2026-05-25 Deterministic Routing Activation

## Decision

The next active Portal Phase3 slice is:

- Deterministic routing hardening

## Why This Slice Now

- The newly converged Phase 3 domains are now protected
- Deterministic routing was explicitly left partial in the 24 May gap analysis
- It remains customer-visible and operationally meaningful
- It is a better next behavioural slice than shared-config structural work

## Scope Boundaries

In scope:

- the remaining targeted routing cases from the gap analysis
- customer-visible routing behaviour and operational outcome

Out of scope:

- broad routing redesign
- structural config consolidation
- reopening protected domains unless a regression is found

## Active Artefacts

- `agent_work/Portal Phase3/plan/deterministic_routing_hardening_plan.md`
- `agent_work/Portal Phase3/spec/deterministic_routing_hardening.md`
- `agent_work/Portal Phase3/spec/deterministic_routing_hardening_eval_standard.md`
- `agent_work/Portal Phase3/spec/deterministic_routing_hardening_holdouts.md`
- `agent_work/Portal Phase3/spec/phase_3_iteration_8_deterministic_routing_build_brief.md`
