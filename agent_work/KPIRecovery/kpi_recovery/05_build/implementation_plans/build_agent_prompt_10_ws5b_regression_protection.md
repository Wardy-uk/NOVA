# Build Agent Prompt 10 — WS5-B Regression Protection

Use this prompt now.

WS5-B has been promoted to `EVALUATED`. The next lifecycle step is **regression protection**.

---

## Prompt

You are the **Build Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to establish **regression protection** for **WS5-B SLA-definition alignment**.

This is a bounded regression loop. You are not redesigning the breach board or reopening WS5-A.

## Your Responsibilities

- freeze the relevant WS5-B baselines
- define and/or implement the minimum regression checks needed for WS5-B
- execute the first regression run if feasible
- report exact evidence, drift, and blockers
- keep scope tightly bounded to the SLA-definition slice

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop10_ws5b_evaluated.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\04_eval\eval_reports\ws5b_eval_report_01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5b_runtime_verification_report_loop02.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`

## Current Governance Context

Loop 10 established:

- `D-082` — WS5-B promoted to `EVALUATED`
- `D-083` — qualification is non-blocking
- `D-084` — next lifecycle step is regression protection
- baselines to freeze: `BF-009` and `BF-010`
- regression checks to create/use: `RC-010` and `RC-011`

## Objective

Protect WS5-B against regression by establishing checks that catch the behaviours already recovered:

1. breach-board SLA counts are no longer trivially zero
2. the approved operational-filtered SLA behaviour remains stable and non-trivial

## Required Tasks

### A. Freeze Baselines

Create the WS5-B baseline artefacts covering:

- `BF-009` — non-zero `OpenTickets_Over2Hours` baseline
- `BF-010` — filtered SLA-behaviour / order-of-magnitude baseline

Write them under:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\`

### B. Define Regression Checks

Implement or document checks for:

- `RC-010` — `OpenTickets_Over2Hours` remains non-zero / non-trivial
- `RC-011` — filtered SLA behaviour remains within an acceptable stable band and does not regress to the dead-field zero state

If these can be added to an existing regression script cleanly, do that.
If not, create a WS5-B-specific regression script.

### C. Execute First Regression Run

If the checks are executable in this loop, run the first WS5-B regression check set and report:

- PASS / FAIL / AMBIGUOUS
- evidence for `RC-010` and `RC-011`
- any drift from the evaluation/runtime baselines

## In Scope

- WS5-B baselines
- WS5-B regression checks
- first regression execution if feasible
- evidence capture

## Out Of Scope

- WS5-A population-path work
- redesign of per-agent metrics
- all remaining wallboard divergence
- WS1 regression framework changes unless narrowly necessary for reuse
- changing the approved operational filters

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_009_ws5b_nonzero_sla.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_010_ws5b_filtered_sla_behaviour.md`
3. either:
   - update an existing regression script, or
   - create `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_scripts\ws5b_regression_check.mjs`
4. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_reports\ws5b_regression_report_run01.md`

## Report Requirements

The regression report must include:

1. run date/time
2. script/method used
3. baseline references used
4. result for `RC-010` and `RC-011`
5. overall `PASS / FAIL / AMBIGUOUS`
6. any drift observations
7. any blockers to promotion to `REGRESSION PROTECTED`

## Completion Standard

This loop is complete when:

- the WS5-B baselines are frozen
- the regression checks exist
- the first regression run is executed or a precise execution blocker is documented
- the report is written

If a check cannot yet be automated, document the smallest credible fallback rather than broadening scope.

