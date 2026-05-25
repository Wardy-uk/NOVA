# WS2 Manager Brief — Loop 01

## Scope

Activate **WS2 Calculation Validation** with a deliberately small first slice:

- **WS2-A: Escalation and rejection count calculation validation**

This slice covers the current KPI family:

- `Tickets escalated to Development`
- `Tickets escalated to Tier 2`
- `Tickets escalated to Tier 3`
- `Tickets rejected by Development`
- `Tickets rejected by Tier 2`
- `Tickets rejected by Tier 3`
- `Escalation Accuracy %`

## Why This Slice First

This is the fastest high-value WS2 entry point because:

- the current outputs are visibly suspect (`0` across multiple days in the audit)
- the KPI family is internally related and likely shares one code path
- it is still team-level logic, so it does not drag us into agent-level expansion
- it is likely a bounded calculation / event-history problem rather than a new-source integration problem

## Governing Question

Do the current escalation and rejection KPIs correctly reflect tier-change behaviour recorded in NOVA's Jira cache and supporting history, or are they structurally zeroed / filtered / reset incorrectly?

## Build Loop 01 Objective

Produce a factual calculation-validation report that answers:

1. Where each of the escalation / rejection KPIs is calculated
2. What source tables / fields / history are used
3. Whether the current implementation is mathematically and behaviourally capable of producing non-zero values
4. Whether the observed all-zero output is caused by:
   - no source events
   - broken event extraction
   - wrong reset window
   - wrong grouping / filter logic
   - wrong definition
5. What the smallest safe remediation slice would be if a defect is confirmed

## Required Output Shape

The first WS2 build loop is **tight discovery with code tracing and data-shape inspection**.

It should end with one of only three outcomes:

1. **No defect** — current zeroes are behaviourally justified
2. **Bounded defect confirmed** — direct build fix can be routed next
3. **Definition ambiguity remains** — requires a human decision before build

## Out of Scope

Do not expand this loop into:

- CSAT recovery
- derived KPI recovery
- FCR / 1st Line / Bug Ack
- agent-level KPI design
- missing KPI expansion from `KpiSnapshot`
- wallboard presentation issues
- n8n parity redesign

## Expected Next Step

If the build report confirms a bounded defect, the next handoff should be a direct implementation brief for **WS2-A correction**, not another generic discovery loop.
