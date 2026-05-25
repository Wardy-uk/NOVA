# Build Agent Prompt 04 — WS1 Regression Execution

Use this prompt for the next Build Agent loop in the NOVA KPI Engine Recovery & Trust Restoration programme.

---

## Prompt

You are the Build Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to execute the first regression-protection run for WS1-A/B/C.

This is not a feature build. It is a regression protection execution loop.

## Current State

Manager Loop 06 has already:

- frozen the WS1 baseline set conceptually
- defined six regression checks
- decided that no hardening item blocks protection
- routed the regression execution brief

Your task is to convert that into concrete baseline artefacts, a repeatable regression check, and the first regression report.

## Required Inputs

Read and use these artefacts first:

- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop06.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/ws1_regression_plan.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_scripts/ws1_regression_execution_brief.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_runtime_verification_post_deploy.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`

## Scope

In scope:

- create frozen baseline artefact files BF-001 through BF-005
- implement the regression check execution path
- run the first regression check
- produce the first regression report

Out of scope:

- reopening WS1 implementation work
- changing KPI logic
- touching WS1-D Development backlog
- surface divergence fixes
- CSAT, escalations/rejections, agent KPIs

## Required Work

### 1. Freeze Baseline Artefacts

Create the baseline files defined by the manager:

- `06_regression/frozen_baselines/bf_001_ghost_suppression.md`
- `06_regression/frozen_baselines/bf_002_resolution_sla.md`
- `06_regression/frozen_baselines/bf_003_frt_recovery.md`
- `06_regression/frozen_baselines/bf_004_cc_null_handling.md`
- `06_regression/frozen_baselines/bf_005_crosscheck_tickets.md`

Populate them using post-deploy runtime verification and evaluation evidence.

### 2. Create Regression Check Script

Create the first executable regression check script, expected name:

- `06_regression/regression_scripts/ws1_regression_check.mjs`

It should implement RC-001 through RC-006, or clearly orchestrate the checks if some are SQL/query driven.

### 3. Execute First Regression Run

Run the script or documented manual check path against the current environment.

Use the primary path if available.
If DB credential access is still unavailable, use the approved fallback via `jira_issue_cache`.

### 4. Produce First Regression Report

Write:

- `06_regression/regression_reports/ws1_regression_report_01.md`

Follow the report contract already defined in:

- `06_regression/regression_reports/ws1_regression_report_contract.md`

## Required Check Set

The first run must cover:

- RC-001 no ghost tier emission
- RC-002 governed tier conservation
- RC-003 CC null handling stable
- RC-004 Resolution SLA plausible
- RC-005 FRT non-trivial
- RC-006 per-tier FRT breaches present

## Allowed Evidence Paths

Primary:

- direct query of `jira_kpi_daily`

Fallback:

- `jira_issue_cache`

If you must use fallback, say so clearly in the report.

## Required Output Sections

Your regression report should include:

1. Baseline artefacts created
2. Execution method used
3. Result for each regression check
4. PASS / FAIL status for the run
5. Any ambiguous results
6. Any new blocker or unexpected regression
7. Recommendation for manager next step

## Success Standard

This loop is complete when:

- baseline artefacts exist
- regression check implementation exists
- the first regression run has been executed
- the first regression report is written

## Important Rule

Do not reinterpret the manager’s gate.

Your job is to execute and report.

Whether WS1-A/B/C are promoted to `REGRESSION PROTECTED` is a Manager Agent decision after reviewing your report.
