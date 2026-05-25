You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Review the remaining **derived KPI definition defects** now that execution and observability are proven.

This is a **tight definition-review loop**, not a refactor and not a plumbing investigation.

## Scope

Review and classify:

- `1st Line Resolution Rate %`
- `FCR Rate %`
- `Bug Ack Time (hours)`

`CSAT % (Derived)` is out of scope here because it is blocked by the separate CSAT field runtime path.

## Confirmed Context

- Derived KPI execution is working
- manual trigger works
- diagnostics are visible
- the remaining problems are semantic / definitional

Known observations:

- `1st Line Resolution Rate %` appears to calculate CC request-type share rather than actual first-line resolution
- `FCR Rate %` uses an unconventional definition and depends on Jira comment history
- `Bug Ack Time` is sparse and appears to measure creation-to-comment rather than escalation-to-ack

## Your Responsibilities

- trace the exact current formula for each metric
- compare the implemented formula to the intended business meaning
- determine whether each metric needs:
  - a bounded formula correction
  - a definition decision
  - deprecation / deferment
- recommend the smallest safe next correction slice

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_derived_kpi_validation_report_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_observability_runtime_verification_report_loop03.md`

## Required Output

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_definition_review_report_loop04.md`

## Completion Standard

This loop is complete when the report clearly states:

- the current formula for each metric
- the intended meaning mismatch, if any
- which metric is the best next bounded correction slice
- whether any metric should be parked rather than fixed immediately
