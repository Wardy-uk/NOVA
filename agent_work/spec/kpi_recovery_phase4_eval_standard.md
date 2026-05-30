# KPI Recovery Phase 4 Evaluation Standard

## Work Package

`P4-WP1`

## Pass Standard

`P4-WP1` passes when:

1. manual entry exists for the scoped non-Jira teams
2. any-date edit flow works
3. stored/promoted values are observably prefilled
4. value-type validation is observably enforced
5. valid entries observably persist into `kpi_manual_entries`
6. valid entries observably promote into `kpi_daily`
7. spreadsheet dry-run and real import behave honestly
8. unmapped/rejected rows are reported rather than silently lost
9. legacy KPI behaviour remains materially unaffected

## Qualified Pass Standard

`P4-WP1` may receive a qualified pass when the core entry/import and promotion path is observably correct, even if bounded real-workbook mapping gaps or downstream-display polish gaps remain visible.

## Fail Standard

Evaluation fails if any of the following occurs:

- manual entry is absent for a scoped team
- date editing is restricted incorrectly
- valid saves do not persist/promote
- import writes silently mis-map or discard rows
- the slice materially regresses legacy KPI behaviour
