# Build Agent Prompt — WS3-A Batch Fix Deployment Verification

## Your Role

You are the Build Agent.

Your job is to verify the final WS3-A hardening fix after deployment of commit `e647670`, ensuring the reconciliation sweep remains safe and automatic without manual batch-size intervention.

## Required Inputs

Read:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_runtime_verification_report_loop04.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_reconciliation_fix_report_loop02.md`

## Verification Goals

Verify:

1. commit `e647670` is deployed
2. the reconciliation sweep runs without the prior Azure SQL timeout behaviour
3. cache remains healthy after the hardened sweep path
4. no trusted KPI family regresses

## Scope Boundaries

Do not:

- implement more code
- broaden into WS4 or WS2
- redesign the reconciliation logic

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws3a_batch_fix_verification_report_loop05.md`

## Completion Standard

This loop is complete when the report clearly states whether WS3-A is ready for SOURCE DEFINED promotion.
