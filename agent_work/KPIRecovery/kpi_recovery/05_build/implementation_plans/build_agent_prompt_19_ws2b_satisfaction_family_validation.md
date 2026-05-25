You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Investigate the next WS2 calculation-validation slice:

**WS2-B: Satisfaction-family metric recovery**

This is a **tight validation / tracing loop**, not a broad implementation loop.

## Scope

Validate the current implementation and source paths for:

- `CSAT %`
- `KAM Satisfaction`
- `CSM Satisfaction`

If the product uses slightly different exact labels on some surfaces, map them clearly in the report.

## Why This Slice

This metric family is:

- visibly wrong in live surfaces
- likely source-related rather than threshold-related
- grouped by common “satisfaction” semantics
- a better bundled slice than mixing it with derived KPIs or agent KPI expansion

## Your Responsibilities

- trace where each satisfaction-family metric is sourced from
- determine whether the current values are:
  - real
  - stubbed
  - disconnected
  - sourced from the wrong store
- identify which surfaces use which source
- classify the smallest safe next remediation slice

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\kpi_comprehensive_audit_2026-05-20.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\kpi_inventory.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws2_calculation_validation\ws2_manager_brief_loop01.md`

Then inspect the relevant code and data-access paths.

## What You Must Determine

By the end of this loop, answer:

1. How `CSAT %` is currently calculated in NOVA
2. Whether `CSAT % = 0` is caused by:
   - no source data
   - wrong field extraction
   - wrong ticket population
   - a placeholder / stub
3. Where `KAM Satisfaction` and `CSM Satisfaction` are supposed to come from
4. Whether those metrics are:
   - implemented and disconnected
   - intentionally survey-backed only
   - missing from the current pipeline
5. Whether the three metrics belong in one bounded remediation slice or need splitting
6. What the smallest safe next build slice is

## Constraints

- Do **not** implement fixes in this loop unless something is trivially obvious and tiny
- Do **not** broaden into derived KPIs, FCR, 1st Line, or Bug Ack
- Do **not** broaden into agent KPI platform design
- Keep this loop evidence-based and source-specific

## Required Outputs

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2b_satisfaction_family_validation_report_loop01.md`

Update if materially useful:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\current_architecture_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\data_lineage_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\known_failures_log.md`

## Completion Standard

This loop is complete when the report clearly states:

- the source path for each satisfaction-family metric
- whether each one is real, stubbed, or disconnected
- the most likely defect class
- the smallest safe next remediation slice
