# KPI Recovery Phase 0 Blocker-Closure Convergence

## Work Package

`P0-WP2`

## Observable Success Criteria

This work package is converged when the Manager can make an explicit Phase 0 clearance decision from the Build Agent report.

The report must clearly state:

1. the exact source-of-truth identity for NTPJ story points
2. whether story points are now exposed in a usable way for the clean-sheet design
3. whether `/api/kpi/*` is safe to keep as the new KPI route family
4. whether Phase 0 is cleared or still blocked

## Allowed Outcomes

- Cleared: both blockers resolved or formally reclassified out of the Phase 1 path
- Still blocked: one or both blockers remain active

## Failure Conditions

- story-points field identity remains ambiguous
- route-family decision remains ambiguous
- report does not end in a clear cleared / blocked decision
