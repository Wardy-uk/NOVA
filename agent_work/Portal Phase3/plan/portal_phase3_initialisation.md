# Portal Phase3 Initialisation

## Phase

- Name: Portal Phase3
- Goal: Start the next governed portal convergence phase from the 24 May 2026 gap analysis
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: reopened / follow-up ticket continuity
- Touches existing behaviour without broad rewrite: ticket-reference follow-up path already exists in partial form
- Can be evaluated independently: evaluator can test recognised ticket-reference follow-up journeys through the running portal

## Inputs

- Spec file: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Anchor note: `agent_work/Portal Phase3/spec/portal_phase3_anchor.md`
- Existing methodology docs: `agent_work/Portal Phase3/spec/orchestration/` and `agent_work/Portal Phase3/spec/regression/`

## Proposed First Convergence Slice

- Change target: improve reopened / follow-up ticket handling after a customer references an existing portal ticket
- Constraints: preserve current ticket-reference detection, avoid broad portal redesign, avoid exposing internal routing logic
- Non-goals: complaint workflow, KB dashboarding, full category expansion, shared-config refactor as a standalone effort

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can test the reopened / follow-up path through the running software only
- Customer-visible follow-up handling no longer stops at passive status display if the referenced ticket clearly needs renewed action
