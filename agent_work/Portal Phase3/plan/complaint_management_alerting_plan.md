# Portal Phase3 Plan — Complaint Management Alerting

## Phase

- Name: Complaint management alerting
- Goal: Add a meaningful management-aware operational alerting outcome for complaint cases that now enter the converged complaint path.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single operational slice: what happens downstream when a complaint is recognised.
- Builds on the already converged complaint intake path rather than redesigning complaint recognition again.
- Can be evaluated independently through complaint submission/runtime outcomes.

## Inputs

- Gap anchor: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Complaint convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-25_complaint_convergence_decision.md`
- Slice spec: `agent_work/Portal Phase3/spec/complaint_management_alerting.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/complaint_management_alerting_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/complaint_management_alerting_holdouts.md`

## Build Brief

- Change target: add the smallest viable operational alerting/escalation behaviour for complaint cases.
- Constraints: preserve the converged complaint-aware customer path and avoid broad reporting/dashboard or queue-architecture redesign.
- Non-goals: complaint recognition redesign, dashboarding, SLA reporting, or unrelated routing cleanup.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify that complaint cases produce a distinguishable management-aware operational outcome
- Clear complaint cases no longer end as ordinary tickets with no extra escalation/alerting signal
