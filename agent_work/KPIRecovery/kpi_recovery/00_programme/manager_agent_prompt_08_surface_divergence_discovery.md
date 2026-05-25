# Manager Agent Prompt 08 — Surface Divergence Discovery

Use this prompt if HDR-1 is still unanswered and you want the fastest parallel progress path after WS1-A/B/C reaches `REGRESSION PROTECTED`.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to start the next governed discovery phase focused on **surface divergence** across:

- KPI Dashboard
- Trends
- Wallboards
- cache-backed operational views

Do not reopen WS1-A/B/C unless fresh evidence shows a regression.

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`
- latest WS1 regression report available

## Discovery Focus

Prioritise the open divergence gaps already captured:

- dashboard SLA Breached vs wallboard SLA Breach Board
- dashboard Development count vs wallboard / JSM / n8n counts
- dashboard FRT vs Trends FRT
- dashboard Open Tickets vs Trends Queue Size
- stale Key Accounts / Customer Success wallboards

## Required Outputs

Create or update:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws5_surface_divergence/`
   - create if needed and seed with the first manager brief

2. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws5_surface_divergence/ws5_manager_brief_loop01.md`
   - first discovery brief for multi-surface evidence divergence

3. `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
   - extend with data-source boundaries by surface

4. `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
   - add per-surface lineage where known

5. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - sharpen divergence gaps into discovery-ready units

6. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - show surface divergence as active governed focus if started

## Required Manager Decisions

By the end of this loop, state clearly:

- which divergence gap should be addressed first
- whether the first loop should target data-source alignment, query-logic alignment, or freshness/workflow alignment
- what the first bounded Build Agent discovery brief should inspect

## Scope Boundary

Do not solve all divergence at once.

Pick the smallest high-value first slice, likely one of:

- SLA Breach Board vs dashboard
- Development count cross-surface divergence
- Trends vs dashboard source mismatch

## Completion Standard

This loop is complete when the next governed discovery slice for surface divergence is defined and a first build/discovery handoff can be routed.
