You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Implement the bounded **WS2-B-1: CSAT field acquisition fix**.

This is a **tiny corrective build loop**, not a broad satisfaction redesign.

## Confirmed Root Cause

`CSAT %` is stuck at `0` because:

- `parseCsat()` expects Jira field `customfield_12802`
- `jira-sync-service.ts` does not request `customfield_12802` in `ALL_FIELDS`
- therefore Jira never returns the rating field into cached `fields_json`
- therefore `parseCsat()` always sees `null`

## In Scope

Implement only:

1. add `customfield_12802` to the Jira sync field whitelist
2. verify the code compiles
3. state exactly what deploy / re-sync is required next

## Out of Scope

- KAM Satisfaction
- CSM Satisfaction
- survey creation
- derived KPI work
- agent KPI expansion
- any broader refactor

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2b_satisfaction_family_validation_report_loop01.md`

## Required Output

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2b1_csat_field_fix_report_loop02.md`

## Completion Standard

This loop is complete when the report clearly states:

- what line/file changed
- that the build compiles
- that deploy + full re-sync are the next runtime steps
