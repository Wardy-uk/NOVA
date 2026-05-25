# Portal Phase3 Plan — Single Shared Config Protection

## Phase

- Name: Single shared config protection
- Goal: Eliminate drift between client and server category field configuration by establishing one canonical shared source.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single structural slice: one duplicated config should become one authoritative config.
- Customer-visible value is indirect but important: prevents future mismatch between form rendering and server expectations.
- Can be evaluated independently through code-adjacent runtime behaviour without opening a new behavioural domain.

## Inputs

- Gap anchor: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Phase anchor: `agent_work/Portal Phase3/spec/portal_phase3_anchor.md`
- Deterministic routing convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-25_deterministic_routing_convergence_decision.md`
- Slice spec: `agent_work/Portal Phase3/spec/single_shared_config_protection.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/single_shared_config_protection_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/single_shared_config_protection_holdouts.md`

## Build Brief

- Change target: one canonical field-config source used by both client and server.
- Constraints: preserve all protected and converged portal behaviour; no category or routing redesign.
- Non-goals: broader config deduplication, unrelated taxonomy cleanup, or conversational logic redesign.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify that client and server derive field behaviour from a single source and that runtime behaviour remains stable
- The prior drift condition no longer exists for category field config
