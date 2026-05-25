# Portal Phase3 Plan — Complaint / Escalation Hardening

## Phase

- Name: Complaint / escalation operational behaviour hardening
- Goal: Close the three local defects preventing convergence of the complaint path.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: complaint-aware journeys remain complaint-aware across the second turn and mixed-domain messages.
- Touches only the local complaint-routing logic in the existing conversational path.
- Can be evaluated independently through a small runtime scenario set.

## Inputs

- Slice spec: `agent_work/Portal Phase3/spec/complaint_escalation_operational_behaviour.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/complaint_escalation_operational_behaviour_eval_standard.md`
- Eval report: `agent_work/Portal Phase3/eval_output/iteration5_complaint_escalation_eval.md`
- Manager decision: `agent_work/Portal Phase3/manager_log/2026-05-24_complaint_eval_decision.md`

## Build Brief

- Change target: fix the observed complaint-path overrides and phrase gaps.
- Constraints: preserve the already-working complaint-aware behaviour and avoid broad routing redesign.
- Non-goals: dashboarding, management tooling, unrelated conversational cleanup, and queue architecture work.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can verify short complaint journeys, mixed-domain complaint wording, and the newly covered complaint phrasings through the running portal
- No remaining critical blocker prevents convergence of the complaint behavioural model
