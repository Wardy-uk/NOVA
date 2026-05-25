# Portal Phase3 Plan — Deterministic Routing Hardening

## Phase

- Name: Deterministic routing hardening
- Goal: Close the remaining customer-visible routing gaps where portal requests should follow predictable deterministic paths.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: a small set of known routing cases should behave predictably.
- Anchored to explicit remaining routing gaps from the 24 May 2026 analysis rather than broad routing redesign.
- Can be evaluated independently through runtime routing behaviour and resulting summary/submission outcomes.

## Inputs

- Gap anchor: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Phase anchor: `agent_work/Portal Phase3/spec/portal_phase3_anchor.md`
- Regression bundle decision: `agent_work/Portal Phase3/manager_log/2026-05-25_regression_bundle_decision.md`
- Slice spec: `agent_work/Portal Phase3/spec/deterministic_routing_hardening.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/deterministic_routing_hardening_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/deterministic_routing_hardening_holdouts.md`

## Build Brief

- Change target: close the known deterministic-routing gaps for the targeted routing cases.
- Constraints: preserve protected Phase 3 behaviours and avoid general routing-table redesign beyond what the targeted deterministic paths require.
- Non-goals: shared-config consolidation, broad conversational detection expansion, and unrelated category growth.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can test the targeted deterministic-routing cases through the running portal only
- The targeted routing cases behave predictably and coherently without exposing internal routing mechanics
