# Build Agent Prompt 06 — WS5 Breach Board Discovery

Use this prompt now.

This is a **discovery-only** loop for the first WS5 surface-divergence slice.

---

## Prompt

You are the **Build Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to perform a **bounded technical discovery** for the SLA Breach Board divergence slice covering:

- `G-009` — Dashboard `SLA Breached = 103` vs Breach Board `0`
- `G-011` — Dashboard `Oldest Development = 197d` vs Breach Board `WORST OLDEST = 76d`

You are not being asked to fix the breach board in this loop.

## Your Responsibilities

- inspect the breach board endpoint and query path
- determine exactly how `dbo.Agent` is being used
- map displayed breach-board fields to `jira_kpi_daily` equivalents where possible
- identify where no pipeline equivalent exists
- report whether the likely next step is:
  - a simple source swap
  - a source swap plus minor aggregation change
  - or blocked by missing per-agent pipeline data

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\current_architecture_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\data_lineage_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`

## Objective

Answer this question with evidence:

> Can the SLA Breach Board be repointed from `dbo.Agent` to pipeline-authoritative `jira_kpi_daily` with an acceptable behavioural match, or does the current board depend on data the pipeline does not emit?

## Discovery Tasks

1. Locate the breach board endpoint / route handler and the exact query path behind:
   - `TICKETS OVER SLA`
   - `WORST OLDEST`
   - any per-agent breach / solved-today values shown on that board

2. Identify:
   - which tables are queried
   - which columns are used
   - whether the values are sourced from `dbo.Agent`, `jira_kpi_daily`, or another store

3. For each major displayed value on the breach board, map:
   - current source field / query
   - closest `jira_kpi_daily` or pipeline equivalent
   - equivalence status:
     - exact equivalent
     - approximate equivalent
     - no equivalent

4. Determine whether the per-agent section of the board depends on:
   - data already available from the pipeline
   - data only available from `dbo.Agent`
   - or a mixture

5. Conclude the smallest credible next implementation shape:
   - simple source swap
   - source swap + small transformation
   - blocked by missing per-agent KPI emission

## In Scope

- source tracing
- field mapping
- equivalence analysis
- risk identification for the next implementation loop

## Out of Scope

- changing the breach board
- changing database schema
- adding new KPIs
- implementing per-agent KPI emission
- fixing other wallboards
- touching WS1 trusted slices

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5_breach_board_discovery_report_loop01.md`

Your report must include:

1. breach board endpoint / handler location
2. exact source tables and queries used
3. field-by-field mapping table:
   - breach-board value
   - current source
   - pipeline equivalent
   - equivalence status
4. explicit finding on whether `dbo.Agent` is the divergence source
5. recommendation for the next manager/build loop:
   - simple swap
   - swap plus transformation
   - blocked by missing per-agent data
6. any blockers or uncertainties

## Completion Standard

This loop is complete when the discovery report is written and the next implementation shape is explicit.

If you discover a likely fix, do not implement it yet. Stop at the discovery boundary and hand back the report.

