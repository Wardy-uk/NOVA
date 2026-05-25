# Portal Phase3 Plan — Reopened / Follow-up Ticket Continuity

## Phase

- Name: Reopened / follow-up ticket continuity
- Goal: Make clear referenced-ticket follow-up requests behave like a coherent continuation path rather than a passive status lookup.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: what happens immediately after a customer references an existing portal ticket.
- Touches existing behaviour without broad rewrite: ticket-reference detection already exists in partial form.
- Can be evaluated independently: evaluator can test recognised ticket-reference journeys through the live portal runtime.

## Inputs

- Gap anchor: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Phase anchor: `agent_work/Portal Phase3/spec/portal_phase3_anchor.md`
- Req 1A decision: `agent_work/Portal Phase3/manager_log/2026-05-24_req1a_convergence_decision.md`
- Slice spec: `agent_work/Portal Phase3/spec/followup_ticket_continuity.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/followup_ticket_continuity_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/followup_ticket_continuity_holdouts.md`

## Build Brief

- Change target: strengthen the runtime behaviour after an existing ticket reference is recognised.
- Constraints: preserve current ticket-reference detection, avoid broad workflow redesign, and keep routing/taxonomy hidden from customers.
- Non-goals: complaint/escalation handling, broad conversational category detection coverage, KB governance, and standalone refactor work.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can test recognised follow-up journeys through running software only
- Customers with clear referenced-ticket follow-up requests are no longer dropped into a passive status-only path
