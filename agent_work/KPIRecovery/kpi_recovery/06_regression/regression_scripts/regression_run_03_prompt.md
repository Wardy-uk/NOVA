# Regression Run 03 Prompt — WS1-A/B/C

Use this prompt now.

This is the third consecutive regression run for WS1-A/B/C under the updated `TRUSTED` gate:

- `D-033`: `TRUSTED` requires **3 consecutive clean regression runs**
- `D-036`: same-day runs may count if they are against fresh runtime/snapshot states and there have been no code changes between runs

---

## Prompt

You are the Build Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Execute **Regression Run 03** for WS1-A/B/C.

This is a regression execution loop only. Do not change implementation.

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/06_regression/ws1_regression_plan.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_scripts/ws1_regression_check.mjs`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_run01.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_run02.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`

## Scope

Run the existing regression checks only:

- RC-001 no ghost tier emission
- RC-002 governed tier conservation
- RC-003 CC null handling stable
- RC-004 Resolution SLA plausible
- RC-005 FRT non-trivial
- RC-006 per-tier FRT breaches present

Confirm in the report that:

- this run occurred after Run 02
- no code changes were introduced between Run 02 and Run 03
- the runtime state used was fresh enough to count as a consecutive evidence point under `D-036`

## Required Output

Write:

- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_run03.md`

Include:

1. Run date/time
2. Execution method
3. Confirmation of no code changes since Run 02
4. Result for RC-001 through RC-006
5. Overall PASS / FAIL / AMBIGUOUS
6. Drift observations vs Run 02
7. Any new blocker or regression
8. Explicit recommendation on whether the `TRUSTED` promotion gate is now satisfied

## Success Standard

This run is complete when all six checks are executed and the report is written.

If all checks pass cleanly, explicitly state whether WS1-A/B/C now satisfy the regression-run portion of the `TRUSTED` gate.

If any check fails, do not speculate. Report exact evidence and hand back to the Manager Agent.
