# Manager Agent Prompt 09 — WS1-D Development Backlog Alignment

Use this prompt once HDR-1 is resolved and WS1-A/B/C are already `REGRESSION PROTECTED`.

HDR-1 is now resolved by decision `D-035`:

> Development backlog includes **every ticket where `current_tier = Development`**.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to start **WS1-D** as the next governed recovery slice for the **Development backlog count**.

This is no longer a business-definition problem. The business definition is fixed by `D-035`.

Your job is to:

- translate that governed definition into a bounded recovery slice
- classify which current surfaces are wrong vs merely different in freshness
- decide the smallest safe first implementation/discovery brief
- avoid collapsing all surface divergence into one giant phase

Do not reopen WS1-A/B/C unless fresh evidence shows regression.

---

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/hdr_1_nick_decision_request.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_inventory.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
- latest available WS1 regression report

---

## Known Evidence To Use

The current Development backlog divergence is:

- JSM Queue: `~230`
- n8n `KpiSnapshot`: `213`
- NOVA KPI Dashboard: `275`
- Tech Support Wallboard: `292`

The governed rule is now:

- count **every ticket where `current_tier = Development`**

Likely remaining ambiguity is now about:

- status filtering across surfaces
- freshness / snapshot timing
- wallboard query logic vs KPI pipeline logic
- whether n8n / JSM are using narrower operational filters that are no longer authoritative for this KPI

---

## Required Outputs

Create or update:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop08_ws1d.md`
   - first manager brief specifically for WS1-D

2. `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_inventory.md`
   - update the Development backlog KPI card with the governed definition from `D-035`

3. `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
   - extend the Development lineage with the now-authoritative rule and note which surfaces likely diverge on status/query logic

4. `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
   - extend with the relevant Development-count surfaces and their suspected query paths

5. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - reclassify the Development backlog gap now that business-definition ambiguity is closed

6. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - show WS1-D as active governed focus if you start it

7. `agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/ws1d_build_brief_loop01.md`
   - only if the first bounded build/discovery brief is clear and phase-sized

---

## Required Manager Decisions

By the end of this loop, state clearly:

1. Which current surface is closest to the governed Development backlog definition.
2. Whether the first WS1-D loop should be:
   - query-logic discovery
   - bounded implementation
   - runtime parity verification
3. Whether JSM / n8n should now be treated as:
   - non-authoritative comparators
   - transitional parity targets
   - or active blockers
4. Whether the Tech Support wallboard `292` count is likely:
   - a broader status set
   - stale/freshness variance
   - or a separate calculation defect

---

## Scope Boundary

Do not try to solve:

- all surface divergence
- all wallboard logic
- all Trends parity
- n8n retirement / migration

This loop is only about turning the Development backlog definition into a governed recovery slice.

If other divergence gaps are touched, log them neutrally and keep the build brief narrow.

---

## Suggested First-Slice Shape

Prefer the smallest first slice that can answer:

> Why does the KPI Dashboard show `275` while the Tech Support wallboard shows `292`, if both should represent Development backlog under the same governed rule?

This is likely the highest-value first WS1-D alignment question because:

- both surfaces are in NOVA
- both are live/current product trust surfaces
- the business definition is now fixed
- the gap may isolate a concrete status/query defect quickly

JSM and n8n should still be documented, but may no longer be the first implementation target if they are not authoritative surfaces.

---

## Completion Standard

This loop is complete when:

- WS1-D is formally activated as the next governed slice
- the Development backlog KPI has an explicit authoritative definition recorded
- the four-way divergence is reclassified under the new rule
- a first bounded build/discovery brief is ready, or the reason it is not ready is stated explicitly

