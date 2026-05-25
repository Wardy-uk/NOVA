# Manager Agent Prompt 12 — WS1-D SOURCE DEFINED Promotion

Use this prompt now.

WS1-D cache recovery has completed with a clean result against all `D-046` evidence requirements.

---

## Prompt

You are the **Manager Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to review the completed WS1-D cache recovery evidence and decide whether **WS1-D Development backlog count** should now be promoted from `UNTRUSTED` to `SOURCE DEFINED`.

Do not broaden this into independent evaluation yet unless the evidence clearly requires it. This loop is only about source-definition promotion after successful bounded recovery.

## Your Responsibilities

- assess the build evidence against the manager-defined promotion criteria
- classify any residual issues as blocking or non-blocking
- update programme state and logs
- decide the next correct lifecycle step for WS1-D

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1d_cache_recovery_report_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/ws1d_build_brief_loop02_cache_recovery.md`
- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop10_ws1d_cache_recovery.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`

## Promotion Test

Assess whether `D-046` is fully satisfied:

- VE-1: post-cleanup pipeline Development count captured
- VE-2: live Jira JQL count captured
- VE-3: difference ≤ 5 tickets
- VE-4: stale rows confirmed absent
- VE-5: RC-001 through RC-006 still PASS

If all are met, promote WS1-D to `SOURCE DEFINED`.

## Required Outputs

Create or update:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop11_ws1d_source_defined.md`
2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
5. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - only if residual WS1-D status needs reclassification

## Required Decisions

By the end of this loop, state clearly:

1. whether WS1-D is promoted to `SOURCE DEFINED`
2. whether any residual cache-risk still blocks that promotion
3. what the next lifecycle step for WS1-D is:
   - independent evaluation
   - regression inclusion
   - or further bounded recovery

## Scope Boundary

Do not:

- reopen D-035
- reopen the wallboard Dev+T3 presentation decision
- broaden into WS3 permanent reconciliation design
- start multi-surface divergence recovery in this loop

## Completion Standard

This loop is complete when:

- the WS1-D promotion decision is written
- programme state is updated
- the next lifecycle step is explicitly named

