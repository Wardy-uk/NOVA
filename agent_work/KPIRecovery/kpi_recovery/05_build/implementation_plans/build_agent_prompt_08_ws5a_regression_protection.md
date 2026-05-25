# Build Agent Prompt 08 — WS5-A Regression Protection

Use this prompt now.

WS5-A has been promoted to `EVALUATED`. The next lifecycle step is **regression protection**.

---

## Prompt

You are the **Build Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to establish **regression protection** for **WS5-A breach-board population recovery**.

This is a bounded regression loop. You are not being asked to redesign the wallboard or reopen WS5-B.

## Your Responsibilities

- freeze the relevant WS5-A baselines
- define and/or implement the minimum regression checks needed for WS5-A
- execute the first regression run if possible
- report exact evidence, drift, and blockers
- avoid broadening into SLA-definition alignment or unrelated wallboard work

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop05_ws5a_evaluated.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\04_eval\eval_reports\ws5a_eval_report_01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5a_runtime_verification_report_loop03.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\ws1_regression_plan.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`

## Current Governance Context

Loop 05 established:

- `D-066` — WS5-A promoted to `EVALUATED`
- `D-067` — logging residual remains non-blocking
- `D-068` — next lifecycle step is regression protection
- baselines to freeze: `BF-006` through `BF-008`
- regression checks to create/use: `RC-007` through `RC-009`

## Objective

Protect WS5-A against regression by establishing checks that catch the behaviours already recovered:

1. Development visibility on the breach board population path
2. `OldestTicketKey` population
3. `WORST OLDEST` behavioural convergence

## Required Tasks

### A. Freeze Baselines

Create the WS5-A baseline artefacts covering:

- `BF-006` — Development agent visibility baseline
- `BF-007` — `OldestTicketKey` population baseline
- `BF-008` — `WORST OLDEST` convergence baseline

Write them under:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\`

### B. Define Regression Checks

Implement or document checks for:

- `RC-007` — Development agents still populated meaningfully
- `RC-008` — `OldestTicketKey` still populated for active agents and null for zero-ticket agents
- `RC-009` — `WORST OLDEST` remains materially aligned with the dashboard/reference behaviour

If these can be added to an existing regression script cleanly, do that.
If not, create a WS5-A-specific regression script.

### C. Execute First Regression Run

If the checks are executable in this loop, run the first WS5-A regression check set and report:

- PASS / FAIL / AMBIGUOUS
- evidence for RC-007 through RC-009
- any drift from the evaluation/runtime baselines

## In Scope

- WS5-A baselines
- WS5-A regression checks
- first regression execution if feasible
- evidence capture

## Out Of Scope

- SLA-definition alignment
- `TICKETS OVER SLA` parity
- broader breach-board redesign
- all remaining WS5 gaps
- WS1 regression framework changes unless narrowly necessary for reuse

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_006_ws5a_dev_visibility.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_007_ws5a_oldest_ticket_key.md`
3. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_008_ws5a_worst_oldest.md`
4. either:
   - update an existing regression script, or
   - create `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_scripts\ws5a_regression_check.mjs`
5. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_reports\ws5a_regression_report_run01.md`

## Report Requirements

The regression report must include:

1. run date/time
2. script/method used
3. baseline references used
4. result for RC-007 through RC-009
5. overall PASS / FAIL / AMBIGUOUS
6. any drift observations
7. any blockers to promotion to `REGRESSION PROTECTED`

## Completion Standard

This loop is complete when:

- the WS5-A baselines are frozen
- the regression checks exist
- the first regression run is executed or a precise execution blocker is documented
- the report is written

If a check cannot yet be automated, document the smallest credible fallback rather than broadening scope.

