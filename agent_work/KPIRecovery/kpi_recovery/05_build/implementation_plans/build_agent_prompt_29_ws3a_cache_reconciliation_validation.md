# Build Agent Prompt — WS3-A Cache Reconciliation Validation

## Your Role

You are the Build Agent.

Your job is to inspect the codebase and current persistence path for deleted Jira ticket handling and produce a factual recommendation for the smallest safe permanent reconciliation fix.

## Your Responsibilities

- inspect code only
- trace current cache persistence behaviour
- identify where deleted Jira tickets can persist indefinitely
- identify downstream assumptions that could be affected by reconciliation
- recommend the smallest safe fix shape
- write a factual report only

Do not implement the fix in this loop.

## Required Inputs

Read:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws3_sql_snapshot_integrity\ws3_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws1d_cache_recovery_report_loop02.md`

Inspect likely relevant code paths, including:

- `jira-sync-service.ts`
- any `fullSync`, incremental sync, or single-issue sync logic
- any cache cleanup or reconciliation logic
- any snapshot/persistence consumers that assume rows are only upserted

## Questions To Answer

1. Exactly where does the current sync path fail to remove deleted Jira issues?
2. Can the smallest safe permanent fix be done without schema change?
3. Is the best fix shape:
   - reconciliation sweep during full sync
   - 404-driven hard delete during targeted sync
   - soft-delete flag plus filtered reads
   - or some combination?
4. What downstream tables, reports, or jobs could be affected by permanent row removal?
5. What is the narrowest credible next implementation slice?

## Scope Boundaries

Do not:

- change production code in this loop
- broaden into KPI maths
- broaden into n8n
- propose a large redesign unless a bounded fix is clearly unsafe

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_cache_reconciliation_validation_report_loop01.md`

## Completion Standard

This loop is complete when the report clearly states:

- current failure mechanism
- affected code paths
- safest minimal permanent fix shape
- whether schema change is actually required
- the exact next implementation slice to run
