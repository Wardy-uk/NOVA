# KPI Recovery Phase 1 Holdouts

Restricted: Manager / Evaluator use only. Do not share with Build Agent.

## Holdout Themes

- detect apparent completeness that omits one of the required Phase 1 foundation elements
- detect hidden dependence on legacy KPI paths rather than true parallel separation
- detect nominal SLA/business-hours support that does not cover all scoped Jira spaces

## Holdout Scenarios

1. Schema and seeds exist, but the snapshot path is absent or not actually wired into the new foundation.
2. The foundation computes from a forbidden or legacy-authoritative table path while still presenting itself as clean-sheet parallel delivery.
3. NT works, but NTPJ, YO, or STBY are not genuinely represented in the business-hours or computation setup.
4. Backfill exists only for one legacy table family while the report implies full Phase 1 completion.
