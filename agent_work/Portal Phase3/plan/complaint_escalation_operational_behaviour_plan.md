# Portal Phase3 Plan — Complaint / Escalation Operational Behaviour

## Phase

- Name: Complaint / escalation operational behaviour
- Goal: Make complaint/escalation a real portal path with safe customer-facing handling and a meaningful operational escalation outcome.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: what the portal does when a customer is clearly making a complaint or asking for escalation.
- Touches an already-present intake category from Req 1A rather than introducing a new intake domain from scratch.
- Can be evaluated independently through the runtime path using complaint-language scenarios.

## Inputs

- Gap anchor: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Phase anchor: `agent_work/Portal Phase3/spec/portal_phase3_anchor.md`
- Req 1A decision: `agent_work/Portal Phase3/manager_log/2026-05-24_req1a_convergence_decision.md`
- Follow-up convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-24_followup_convergence_decision.md`
- Slice spec: `agent_work/Portal Phase3/spec/complaint_escalation_operational_behaviour.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/complaint_escalation_operational_behaviour_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/complaint_escalation_operational_behaviour_holdouts.md`

## Build Brief

- Change target: strengthen the complaint/escalation path so clear complaints are treated as a first-class intake and operational escalation case.
- Constraints: keep customer-facing behaviour safe, preserve hidden routing/taxonomy, and avoid broad workflow redesign outside the complaint path.
- Non-goals: full dashboarding, broad queue architecture redesign, KB governance, and unrelated conversational detection cleanup.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can test clear complaint/escalation journeys through the running portal only
- Clear complaint messages no longer behave like generic intake when a complaint/escalation response is the expected behavioural outcome
