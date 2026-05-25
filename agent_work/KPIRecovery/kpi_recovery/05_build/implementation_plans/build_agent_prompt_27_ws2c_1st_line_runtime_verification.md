You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Run runtime verification for **WS2-C-FIX-02: 1st Line Resolution Rate % formula correction**.

This is a **post-deploy verification loop**, not a new implementation loop.

## What Changed

The numerator for `1st Line Resolution Rate %` was changed from:

- Customer Care request-type membership

to:

- tickets resolved with `classifyTier(current_tier) === 'Customer Care'`

## Your Responsibilities

- verify the corrected metric now reflects actual first-line resolution rather than request-type composition
- verify the derived KPI pipeline still runs correctly via the manual trigger
- verify no regression to other trusted KPI areas
- report whether this slice is ready for SOURCE DEFINED promotion

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_fix_1st_line_resolution_report_loop05.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_observability_runtime_verification_report_loop03.md`

## Runtime Checks

### RV-WS2C-5 — Corrected 1st Line meaning

Verify that the metric output now aligns with tickets resolved at first line rather than CC request-type composition.

### RV-WS2C-6 — Manual trigger still works

Trigger the derived KPI pipeline and confirm the updated metric executes cleanly.

### RV-WS2C-7 — No regression to other derived outputs

Spot-check:

- FCR still executes
- Bug Ack still executes
- CSAT Derived remains only blocked by the separate CSAT field issue

### RV-WS2C-8 — No regression to trusted slices

Spot-check:

- WS1 trusted KPI family
- WS2-A trusted escalation/rejection family
- WS5 trusted breach-board family

## Allowed Outcomes

- `PASS`
- `QUALIFIED PASS`
- `BLOCKED`
- `FAIL`

## Required Output

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_1st_line_runtime_verification_report_loop06.md`

## Completion Standard

This loop is complete when the report clearly states:

- whether the metric meaning is now corrected
- whether the updated value is runtime-confirmed
- whether the slice is ready for SOURCE DEFINED promotion
