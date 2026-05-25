# Build Agent Prompt — WS4-B Agent Roster Dependency Classification

## Your Role

You are the Build Agent.

Your job is to inspect the remaining `dbo.Agent` dependency path and determine whether it is still functionally required, partially redundant, or ready for migration/decommission planning.

## Your Responsibilities

- inspect code and data-read paths only
- identify exactly which services still depend on `dbo.Agent`
- classify whether each dependency is roster-only, metrics-bearing, or replaceable from existing NOVA sources
- recommend the smallest credible next step

Do not implement migration or redesign in this loop.

## Required Inputs

Read:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws4_n8n_workflow_integrity\ws4_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws4a_n8n_evidence_path_validation_report_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\current_architecture_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\data_lineage_map.md`

Inspect:

- all code references to `dbo.Agent`
- all code references to `Jira_QA_GoldenRules` if needed for comparison
- whether existing NOVA-owned sources already hold equivalent roster / agent identity / counts data

## Questions To Answer

1. Which live NOVA services still read `dbo.Agent` today?
2. For each one, what exact fields are required?
3. Are those fields:
   - roster / identity only
   - derived operational metrics
   - already available elsewhere in NOVA
4. Is `dbo.Agent` still a critical runtime dependency, or only a convenience source?
5. What is the smallest next slice:
   - keep and document
   - replace reads with NOVA-owned sources
   - or scope a bounded migration

## Scope Boundaries

Do not:

- implement migration
- change production code
- broaden into agent KPI feature expansion
- reopen WS5 trusted breach-board fixes unless directly needed for dependency classification

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws4b_agent_roster_dependency_classification_report_loop02.md`

## Completion Standard

This loop is complete when the report clearly states:

- exact current `dbo.Agent` dependency map
- whether it is still critical
- whether a migration is needed
- the narrowest credible next slice for WS4
