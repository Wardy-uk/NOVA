# Build Agent Prompt 03 — WS1 Deploy And Runtime Verification

Use this prompt for the next Build Agent / operator loop in the NOVA KPI Engine Recovery & Trust Restoration programme.

---

## Prompt

You are the Build Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is not to write new recovery logic. The code work is already complete.

Your job is to:

1. deploy the completed WS1 code changes
2. restart the runtime so Jira full sync runs with the updated field list
3. wait for one fresh KPI snapshot cycle
4. verify the expected runtime outcomes
5. produce the factual runtime verification report that unlocks evaluator execution

## Current State

Manager Loop 04 has concluded that:

- **WS1-A** ghost suppression is code-complete
- **WS1-B** Resolution SLA is code-complete and source-verified
- **WS1-C** FRT recovery is code-complete but still needs runtime proof
- **WS1-D** Development backlog remains blocked by business definition

The next step is operational, not analytical.

## Artefacts You Must Read First

- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop04.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop03_frt.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/ws1_ab_evaluator_brief_v1.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`

## Changes Being Shipped Together

Ship these as one deployment:

1. `kpi-pipeline.ts`
   - `ccBucket()` null/unmapped default -> `CC (Incidents)`
   - emission guard -> `if (!ALL_TIERS.includes(tier)) continue;`

2. `jira-sync-service.ts`
   - add `customfield_14046` to `ALL_FIELDS`

## Objectives

After deploy + restart + one snapshot cycle, confirm:

### WS1-A

- ghost KPIs no longer appear in `jira_kpi_daily`
- no KPI rows remain for `Customer Care` or `Unclassified`
- CC tickets are visible only under governed CC sub-tiers

### WS1-B

- Resolution SLA metrics remain stable
- Resolution Compliance % stays materially consistent with pre-deploy verified behaviour

### WS1-C

- FRT field is now present in cached `fields_json`
- FRT Compliance % is no longer stuck at `100%`
- per-tier FRT breach counts are no longer all `0`

## Required Runtime Steps

1. Deploy the code changes to the real NOVA environment.
2. Restart the NOVA server or otherwise trigger a full Jira sync.
3. Confirm full sync completion.
4. Wait for one fresh `collectJiraSnapshot()` run.
5. Query runtime outputs after the fresh cycle.

If the environment requires multiple manual steps, document them exactly.

## Required Verification Checks

### Check Group A — Ghost KPI Removal

- Query `jira_kpi_daily` for current-date KPI rows
- confirm no KPI names contain:
  - `Customer Care`
  - `Unclassified`
- confirm CC sub-tier totals are present

### Check Group B — CC Visibility

- confirm `CC (Incidents)` volume rises materially from pre-fix values
- confirm total CC sub-tier volume is approximately equal to total open CC-tier tickets
- allow small drift for sync timing, but log actual variance

### Check Group C — Resolution SLA Stability

- confirm Resolution Compliance % remains plausible and near prior validated output
- confirm no obvious regression in Resolution SLA breach counts

### Check Group D — FRT Runtime Recovery

- confirm `customfield_14046` is present in cached NT tickets
- confirm FRT Compliance % (Open Queue) is now below `100%`
- confirm at least one per-tier FRT breach metric is non-zero
- confirm FRT values are consistent with the expected project pattern:
  - NT present
  - NTPJ absent or mostly absent

## Required Output

Create:

`agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_runtime_verification_post_deploy.md`

Include these sections:

1. Deployment performed
2. Restart / full-sync evidence
3. Snapshot-cycle evidence
4. Ghost KPI verification
5. Resolution SLA stability check
6. FRT runtime verification
7. Unexpected findings
8. Recommendation for manager next step

## Success Standard

This loop is complete when all of the following are evidenced:

- ghost KPIs are gone from current output
- Resolution SLA remains stable
- FRT data is present in cache
- FRT output is no longer trivial

## Routing Rule After Completion

If successful:

- WS1-A + WS1-B should proceed to evaluator execution
- Manager may decide whether to issue a WS1-C evaluator addendum

If unsuccessful:

- do not speculate
- document which condition failed
- return control to the Manager Agent with exact evidence
