# KPI Recovery Phase 0 Blocker-Closure Brief

## Work Package

`P0-WP2` — Close or crisply classify the prerequisites currently blocking entry into the clean-sheet KPI foundation phase.

## Objective

Produce a factual blocker-closure report that lets the Manager decide whether Phase 0 can be cleared and Phase 1 opened.

## Background

`P0-WP1` concluded that Phase 1 is blocked by two independent prerequisites:

1. NTPJ story points are not currently exposed in a usable way through the Jira cache path.
2. `/api/kpi/*` is already partially occupied by `POST /api/kpi/derived/run`.

This work package is to close those blockers to decision standard, not to begin Phase 1.

## Required Behavioural Outcome

The Build Agent must return a factual report that makes these two questions answerable:

1. What exact live Jira field identity should be treated as the NTPJ story-points source of truth, and can the NOVA sync path be extended to expose it for the clean-sheet KPI design?
2. Can the planned new KPI API family safely coexist under `/api/kpi/*`, or must the route family be reclassified before Phase 1?

## Scope

Investigate and, if necessary, perform only the minimum bounded prerequisite changes needed to remove ambiguity around these blockers.

## Required Checks

### A. NTPJ story-points prerequisite closure

- Confirm the exact live Jira field identity used for NTPJ story points.
- Confirm whether current NTPJ cached rows can expose that field after sync-path extension.
- If bounded prerequisite work is needed to expose the field, carry that work only far enough to prove whether Phase 1 is unblocked.
- Report whether the field becomes:
  - directly usable
  - present but still requiring mapping
  - still missing

### B. `/api/kpi/*` namespace classification

- Inspect how the existing `POST /api/kpi/derived/run` endpoint occupies the namespace.
- Determine whether the clean-sheet KPI API family can safely live under `/api/kpi/*` without route ambiguity or whether the route family must be reclassified.
- If a bounded prerequisite change is required to make the namespace safe, carry that work only far enough to support a clear Manager decision.

### C. Optional read-only evidence strengthening

- If practical, add row-level read-only confirmation for the mapped-but-non-blocking cache fields so the final Phase 0 outcome is based on both schema/path inspection and live data reality.

## Deliverable

Write one markdown report to `agent_work/build_status/` for this work package that includes:

- story-points source-of-truth finding
- whether story points are now usable for the clean-sheet KPI design
- route namespace finding
- whether `/api/kpi/*` remains viable or must be reclassified
- explicit statement of whether Phase 0 is now cleared or still blocked
- if still blocked, the exact remaining blocker(s)

## Constraints

- Do not start the broader Phase 1 foundation build in this work package.
- Do not redesign the clean-sheet KPI spec.
- Do not consume evaluator holdouts.
- Keep any changes tightly limited to prerequisite closure only.
