# Build Agent Prompt — WS3-A Runtime Verification

## Your Role

You are the Build Agent.

Your job is to verify that the deployed WS3-A reconciliation fix works in runtime without damaging trusted KPI behaviour.

## Your Responsibilities

- verify the reconciliation sweep executed safely
- verify deleted Jira issues no longer persist in cache after full sync
- verify `syncSingleIssue()` now removes confirmed-missing issues
- verify no obvious regression in trusted KPI families
- write a factual runtime report only

## Required Inputs

Read:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_reconciliation_fix_report_loop02.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws3_sql_snapshot_integrity\ws3_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`

## Runtime Checks

Verify at minimum:

1. Full-sync reconciliation did not wipe or abnormally shrink `jira_issue_cache`
2. Previously stale/deleted ticket behaviour is corrected
3. `syncSingleIssue()` hard-delete path is observable or credibly evidenced
4. Development backlog count remains plausible / aligned
5. No obvious regression in trusted WS1 / WS5 KPI surfaces

## Scope Boundaries

Do not:

- implement more code in this loop
- broaden into WS4 or n8n
- redesign soft-delete behaviour

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_runtime_verification_report_loop03.md`

## Completion Standard

This loop is complete when the report clearly states:

- whether runtime verification passed, qualified passed, or failed
- whether the sweep guard behaved safely
- whether deleted-ticket persistence is materially fixed
- whether any trusted KPI family regressed
- the exact next lifecycle step
