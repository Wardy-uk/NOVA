# Manager Agent Prompt 15 — WS5 Breach Board Source Fix

Use this prompt now.

WS5 breach-board discovery is complete. The next loop should convert the discovery result into a bounded remediation slice.

---

## Prompt

You are the **Manager Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to take the completed breach-board discovery findings and decide the smallest credible remediation slice for:

- `G-009` — Dashboard `SLA Breached` vs Breach Board `0`
- `G-011` — Dashboard `Oldest Development` vs Breach Board `WORST OLDEST`

This is now beyond discovery. Your job is to translate the findings into a tightly bounded build brief without broadening into full wallboard redesign or per-agent KPI expansion.

## Your Responsibilities

- classify what is now known vs still uncertain
- decide the first bounded implementation slice
- preserve source-of-truth discipline
- keep the fix small enough for independent evaluation
- avoid dragging in unrelated WS5 gaps

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5_breach_board_discovery_report_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\current_architecture_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\data_lineage_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`

## Confirmed Findings To Use

- The breach board cannot be simply repointed to `jira_kpi_daily` because it depends on **per-agent visibility**
- `dbo.Agent` is the divergence source for both `G-009` and `G-011`
- `refreshAllAgentMetrics()` already exists and is the key population path
- Development is excluded from the tier filter, explaining the `197d` vs `76d` oldest-ticket gap
- `OldestTicketKey` is not written by the pipeline
- The breach-board SLA definition may differ from the dashboard SLA definition
- The likely next shape is **source fix + minor transformation**

## Required Decisions

By the end of this loop, state clearly:

1. What the **first implementation slice** should be:
   - debug/fix `refreshAllAgentMetrics()` population
   - add Development to the tier filter
   - align SLA breach definition
   - add `OldestTicketKey`
   - or split these across two loops

2. Whether the first build should be:
   - one bounded fix loop
   - or two phased loops

3. What must be held out of scope for the first fix

4. What evidence will be required to evaluate the fix behaviourally

## Scope Boundary

Do **not** broaden this into:

- full per-agent KPI programme work
- redesign of `dbo.Agent`
- all wallboards
- WS2 calculation validation
- WS3 permanent data-model redesign

This loop is only about turning the breach-board discovery into the smallest governed remediation slice.

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop02_breach_board_fix.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
3. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
4. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
5. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\implementation_plans\ws5_build_brief_loop02_breach_board_fix.md`
   - only if the build slice is clear and phase-sized

## Completion Standard

This loop is complete when:

- the first remediation slice is explicitly chosen
- the build brief is ready or the blocking uncertainty is stated
- evaluation evidence expectations are written clearly

