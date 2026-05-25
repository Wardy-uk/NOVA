# Manager Agent Prompt 19 — WS5-A REGRESSION PROTECTED Promotion

Use this prompt now.

WS5-A regression protection has been established and the first regression run passed cleanly.

---

## Prompt

You are the **Manager Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to decide whether **WS5-A breach-board population recovery** should now be promoted from **EVALUATED** to **REGRESSION PROTECTED**.

This is a short promotion loop. The regression artefacts already exist and Run 01 has completed successfully.

## Your Responsibilities

- assess the regression-protection evidence neutrally
- confirm whether the promotion gate is met
- classify any residual issue as blocking or non-blocking
- update programme state and promotion records
- define the trust path from `REGRESSION PROTECTED` to `TRUSTED`

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\implementation_plans\build_agent_prompt_08_ws5a_regression_protection.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_reports\ws5a_regression_report_run01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_006_ws5a_dev_visibility.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_007_ws5a_oldest_ticket_key.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_008_ws5a_worst_oldest.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop05_ws5a_evaluated.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`

## Current Gate Context

WS5-A currently has:

- source-defined promotion complete
- independent evaluation PASS
- baselines frozen
- regression checks defined (`RC-007` through `RC-009`)
- first regression run PASS (3/3)

Loop output says the promotion gate conditions (`PG-6` through `PG-10`) are all met.

## Required Decisions

By the end of this loop, state clearly:

1. whether WS5-A is promoted to `REGRESSION PROTECTED`
2. whether any residual risk still blocks that promotion
3. what the gate to `TRUSTED` should be for WS5-A
4. whether WS5-A is now protected while WS5-B remains isolated

## Promotion Standard

Promote WS5-A to `REGRESSION PROTECTED` if:

- baselines are frozen
- regression checks exist
- first regression run passed
- no new blocking gaps appeared
- current residuals remain non-blocking

Do not invent a new gate if the existing artefacts already satisfy the protection standard.

## Scope Boundary

Do **not**:

- reopen WS5-B
- broaden into SLA-definition alignment
- reopen WS1
- require additional redesign before promotion

This loop is only about WS5-A promotion and trust-path definition.

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop06_ws5a_regression_protected.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
3. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
4. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`
5. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
   - only if residual status changes

## Completion Standard

This loop is complete when:

- the promotion decision is explicit
- the tracker and promotion log are updated
- the trust gate to `TRUSTED` is explicitly named

