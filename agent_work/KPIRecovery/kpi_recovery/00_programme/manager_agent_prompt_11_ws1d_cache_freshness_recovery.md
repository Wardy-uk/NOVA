# Manager Agent Prompt 11 — WS1-D Cache Freshness Recovery

Use this prompt now.

WS1-D verification is complete enough to classify the remaining issue:

- the pipeline logic already matches `D-035`
- the parity gap is caused by stale deleted Jira tickets still appearing in cache-backed counts

This is now a bounded recovery slice, not a definition or comparator problem.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to convert the WS1-D verification result into a **small cache-freshness recovery slice**.

Do not reopen:

- the Development backlog business definition
- wallboard Dev+T3 intentional presentation logic
- JSM or n8n comparator disputes

Those questions are already settled for this slice.

---

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1d_verification_report_loop01.md`
- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop08_ws1d.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`

---

## Confirmed Evidence

- Pipeline Development count: `278`
- Live Jira count: `231`
- Difference: `47`
- Spot-checked tickets `NT-543`, `NT-626`, and `NT-18099` are all deleted in Jira
- Therefore the remaining WS1-D problem is **stale cache representation of deleted Jira tickets**

---

## Required Outputs

Create or update:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop10_ws1d_cache_recovery.md`
2. `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
   - extend with cache deletion / refresh handling where known
3. `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
   - extend LIN-001 / WS1-D with the confirmed stale-entry failure mode
4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - classify the WS1-D remainder precisely as a data defect / cache freshness problem
5. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - keep WS1-D as active focus with the right bounded status
6. `agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/ws1d_build_brief_loop02_cache_recovery.md`
   - next bounded build brief for recovery

---

## Required Manager Decisions

By the end of this loop, state clearly:

1. Whether the first recovery step should be:
   - full re-sync only
   - targeted stale-entry cleanup
   - deletion-handling code/path inspection
2. What evidence is required after the recovery step to promote WS1-D forward
3. Whether this remains within WS1 or should be split as a small WS3/SQL-integrity crossover

---

## Scope Boundary

Do not broaden this into:

- all cache integrity
- all SQL persistence validation
- all multi-surface divergence

This loop is only about the smallest credible recovery step for stale deleted Development tickets remaining in cache.

---

## Completion Standard

This loop is complete when:

- the WS1-D remainder is translated into a bounded recovery slice
- the next build brief is ready
- the required post-recovery verification evidence is explicit

