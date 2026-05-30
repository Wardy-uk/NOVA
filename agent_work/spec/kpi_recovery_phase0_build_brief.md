# KPI Recovery Phase 0 Build Brief

## Work Package

`P0-WP1` — Live prerequisite audit for the clean-sheet KPI recovery programme.

## Objective

Establish whether the Phase 1 foundation build can begin without first extending the live Jira cache sync or changing the planned API route prefix.

## Required Behavioural Outcome

Produce a factual findings report, based on live environment inspection, that tells the Manager whether:

1. `jira_issue_cache` already contains the prerequisite data needed by the clean-sheet KPI design.
2. the planned `/api/kpi/*` route family is safe to introduce without colliding with existing routes.

## Scope

Inspect and report only. This work package is a prerequisite audit, not a foundation implementation slice.

## Required Checks

### A. `jira_issue_cache` prerequisite field audit

Inspect the live NOVA environment and confirm whether `jira_issue_cache` exposes each of the following:

- first public comment timestamp
- resolution date
- satisfaction rating
- labels array
- NTPJ story points custom field

For each item, report one of:

- present and directly usable
- present but needs interpretation / mapping clarification
- missing

### B. Route-prefix safety audit

Inspect the existing route surface and confirm whether introducing new endpoints under `/api/kpi/*` would collide with anything already present.

The brief already expects legacy routes such as `/api/kpi-data/*` and `/api/trends/*` to remain untouched. The outcome required here is whether `/api/kpi/*` itself is clean and available.

## Deliverable

Write one markdown report to `agent_work/build_status/` for this work package that includes:

- date of inspection
- evidence summary for each required field
- route-prefix findings
- explicit statement of whether Phase 1 is unblocked or blocked
- if blocked, a short factual statement of what prerequisite extension is required

## Constraints

- Do not implement Phase 1 in this work package.
- Do not redesign the clean-sheet spec.
- Do not read evaluator holdouts or ask for hidden evaluation logic.
- Keep findings factual and environment-based.

## Manager Decision Rule

- If any required `jira_issue_cache` field is missing, Phase 1 is blocked until the sync is extended.
- If `/api/kpi/*` collides with an existing route family, Phase 1 is blocked until the route plan is reclassified.
