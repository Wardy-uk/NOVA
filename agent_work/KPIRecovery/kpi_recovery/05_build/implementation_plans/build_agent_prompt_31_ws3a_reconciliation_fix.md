# Build Agent Prompt — WS3-A Cache Reconciliation Fix

## Your Role

You are the Build Agent.

Your job is to implement the smallest safe permanent reconciliation fix for deleted Jira tickets in `jira_issue_cache`.

## Your Responsibilities

- make a tightly bounded code change
- preserve current successful sync behaviour
- add reconciliation only where validated as safe
- keep the change as local as possible
- compile-check and report what changed

## Required Inputs

Read:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws3_sql_snapshot_integrity\ws3_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_cache_reconciliation_validation_report_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`

Primary file expected:

- `jira-sync-service.ts`

## Approved Fix Shape

Implement the validated minimal fix:

1. Add a reconciliation sweep at the end of `fullSync()`
   - delete rows from `jira_issue_cache` where `synced_at < syncStartTimestamp`
   - run this only after a successful upsert pass
   - include a minimum issue-count / safety threshold so a failed or partial Jira fetch cannot wipe the cache

2. Add a 404-driven hard delete in `syncSingleIssue()`
   - if Jira confirms the issue no longer exists, remove it from `jira_issue_cache`

## Scope Boundaries

Do not:

- add schema changes
- broaden into snapshot-table redesign
- modify KPI maths
- touch n8n
- clean up unrelated dead code in this loop

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_reconciliation_fix_report_loop02.md`

## Completion Standard

This loop is complete when the report states:

- exactly what was changed
- safety guard used for the full-sync sweep
- whether `syncSingleIssue()` now deletes confirmed-missing tickets
- compile / verification result
- what runtime verification should prove next
