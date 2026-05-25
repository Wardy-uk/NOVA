# WS5-B Regression Run Prompt

Use this prompt for each consecutive WS5-B regression run while it moves from `REGRESSION PROTECTED` toward `TRUSTED`.

---

## Prompt

You are the **Build Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to execute the next **WS5-B regression run** and report whether the protected model remains stable.

This is a regression execution loop only.

## Your Responsibilities

- run the existing WS5-B regression checks only
- report exact evidence for each check
- note any drift from the frozen baselines
- do not change implementation in this loop

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_scripts\ws5b_regression_check.mjs`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_009_ws5b_nonzero_sla.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_010_ws5b_filtered_sla_behaviour.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_reports\ws5b_regression_report_run01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`

## Trust Gate Context

WS5-B reaches `TRUSTED` when the following are met:

- `TG-9` — ≥ 3 consecutive clean regression runs
- `TG-10` — no manual intervention required to maintain green
- `TG-11` — no new blocking gaps
- `TG-12` — manager review of accumulated evidence

Same-day consecutive runs are permitted under `D-036` if they are against fresh runtime state and there are no code changes between runs.

## Regression Checks

Run and report:

- `RC-010` — `OpenTickets_Over2Hours` remains non-zero / non-trivial
- `RC-011` — WS5-A recovered behaviours remain stable under WS5-B:
  - Development visibility
  - `OldestTicketKey`
  - `WORST OLDEST`

## Required Output

Write the next sequential report in:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_reports\`

Suggested names:

- `ws5b_regression_report_run02.md`
- `ws5b_regression_report_run03.md`

Include:

1. run date/time
2. execution method
3. confirmation of no code changes since the previous run
4. result for `RC-010` and `RC-011`
5. overall `PASS / FAIL / AMBIGUOUS`
6. drift observations vs prior run and baselines
7. any blocker or regression
8. explicit recommendation on whether the regression-run portion of the `TRUSTED` gate is now satisfied

## Completion Standard

This loop is complete when both checks are executed and the report is written.

If any check fails, do not speculate. Report exact evidence and hand back to the Manager Agent.

