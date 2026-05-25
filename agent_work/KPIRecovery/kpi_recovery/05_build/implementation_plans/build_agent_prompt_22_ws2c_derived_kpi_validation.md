You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Investigate the next WS2 calculation-validation slice:

**WS2-C: Derived KPI family validation**

This is a **tight validation / tracing loop**, not a broad implementation loop.

## Scope

Validate the current implementation and source paths for:

- `FCR Rate %`
- `1st Line Resolution Rate %`
- `Bug Ack Time (hours)`
- any directly related `Derived` KPI pipeline output that shares the same code path

## Why This Slice

This family is already flagged as broken / absent in the audit and likely shares one implementation area:

- `collectDerivedKpis()`
- resolved-ticket history
- comment / timeline interpretation

That makes it a good parallel slice while the CSAT field re-sync runs.

## Your Responsibilities

- trace where each derived KPI is supposed to come from
- determine whether each KPI is:
  - implemented and broken
  - stubbed / disabled
  - partially wired
  - blocked by missing source data
- identify the smallest safe next remediation slice

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\kpi_comprehensive_audit_2026-05-20.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\kpi_inventory.md`

Then inspect the relevant code and data-access paths.

## What You Must Determine

By the end of this loop, answer:

1. Where each derived KPI is currently calculated
2. Whether the code path is active, disabled, or dead
3. Whether the metric is missing because of:
   - disabled nodes / dead route
   - broken logic
   - missing source data
   - unresolved definition ambiguity
4. Whether the derived KPI family can stay bundled or needs splitting
5. What the smallest safe next build slice is

## Constraints

- Do **not** implement fixes in this loop unless something is trivially obvious and tiny
- Do **not** broaden into CSAT, KAM/CSM survey setup, or agent KPI expansion
- Keep this loop source-specific and evidence-based

## Required Output

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_derived_kpi_validation_report_loop01.md`

## Completion Standard

This loop is complete when the report clearly states:

- source path for each derived KPI
- whether each one is real, dead, disabled, or broken
- the most likely defect class
- the smallest safe next remediation slice
