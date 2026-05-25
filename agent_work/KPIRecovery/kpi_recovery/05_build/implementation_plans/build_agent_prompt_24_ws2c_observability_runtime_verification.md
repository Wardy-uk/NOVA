You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Run runtime verification for **WS2-C-FIX-01: derived KPI observability recovery**.

This is a **post-deploy verification loop**, not a new implementation loop.

## What Was Changed

The observability slice added:

- startup error logging instead of silent failure swallowing
- diagnostic logging inside `collectDerivedKpis()`
- an admin-only manual trigger route: `POST /api/kpi/derived/run`

## Your Responsibilities

- verify the observability path works in runtime
- verify the manual trigger can execute the derived KPI pipeline
- verify the new logs / outputs are enough to make the next formula-correction slice evidence-based
- report whether the observability slice is ready for SOURCE DEFINED promotion

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_observability_fix_report_loop02.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_derived_kpi_validation_report_loop01.md`

## Runtime Checks

### RV-WS2C-1 — Silent failure path no longer silent

Confirm derived KPI startup failure is now observable if it occurs.

### RV-WS2C-2 — Manual trigger works

Confirm `POST /api/kpi/derived/run` executes and returns a usable result.

### RV-WS2C-3 — Diagnostic logging is sufficient

Confirm the new logs expose enough information to distinguish:

- no source data
- comment fetch failure
- CSAT field absence
- logic/output mismatch

### RV-WS2C-4 — No regression to trusted slices

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

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_observability_runtime_verification_report_loop03.md`

## Completion Standard

This loop is complete when the report clearly states:

- whether startup failures are now visible
- whether manual triggering works
- whether the logs are good enough to support the next derived-KPI fix slice
- whether WS2-C-FIX-01 is ready for SOURCE DEFINED promotion
