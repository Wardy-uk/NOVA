You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Implement the next bounded **WS2-C** correction slice:

**WS2-C-FIX-02 — 1st Line Resolution Rate % formula correction**

## Confirmed Defect

`1st Line Resolution Rate %` currently measures **Customer Care request-type share**, not the intended concept of **tickets resolved without escalation beyond first line**.

The validation report indicates the required source field is already present in the existing query.

## In Scope

Implement only the bounded formula correction for:

- `1st Line Resolution Rate %`

Expected change shape:

- replace the current request-type based condition
- use the already-available tier information to identify tickets resolved at first line (`current_tier === 'Customer Care'` or the exact equivalent present in the code path)

## Out of Scope

- `FCR Rate %`
- `Bug Ack Time`
- `CSAT % (Derived)`
- broader derived KPI refactors
- schedule changes
- observability changes already completed

## Required Inputs

Read and use:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_definition_review_report_loop04.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_observability_runtime_verification_report_loop03.md`

## Required Output

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws2c_fix_1st_line_resolution_report_loop05.md`

## Completion Standard

This loop is complete when the report clearly states:

- what formula changed
- why the new formula better matches the intended meaning
- that the code compiles
- what deploy/runtime verification should check next
