# Manager Agent Prompt 22 — WS5-B EVALUATED Promotion

Use this prompt now.

WS5-B independent evaluation has completed with a **QUALIFIED PASS**.

---

## Prompt

You are the **Manager Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to review the completed **WS5-B independent evaluation** and decide whether **WS5-B SLA-definition alignment** should now be promoted from **SOURCE DEFINED** to **EVALUATED**.

This loop is only about WS5-B promotion and next-step routing. Do not broaden into all breach-board parity or reopen WS5-A.

## Your Responsibilities

- assess the evaluator verdict against programme trust rules
- classify any qualification as blocking or non-blocking
- update programme state, decision log, and promotion log
- decide the next lifecycle step for WS5-B

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\04_eval\eval_reports\ws5b_eval_report_01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop09_ws5b_source_defined.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`

## Evaluation Context

Evaluator verdict:

- **QUALIFIED PASS**

Key findings:

- non-zero breach behaviour restored
- SLA-definition path now aligned with dashboard (`customfield_14048` via `isSlaBreached()`)
- remaining `17` vs `188` difference credibly explained by approved operational filters
- no WS5-A regression
- no WS1 regression attributable to WS5-B

Qualification:

- the breach board intentionally presents a narrower “actionable now” subset rather than total SLA exposure
- this is an operational awareness item, not a behavioural defect in the scoped slice

## Required Decisions

By the end of this loop, state clearly:

1. whether WS5-B is promoted to `EVALUATED`
2. whether the qualification is non-blocking
3. what the next lifecycle step for WS5-B is:
   - regression protection
   - or additional bounded hardening
4. whether WS5 is now fully through source-definition and evaluation across both sub-slices

## Promotion Standard

Promote WS5-B to `EVALUATED` if:

- evaluator verdict is `PASS` or `QUALIFIED PASS`
- the scoped SLA-definition alignment is behaviourally correct
- the qualification does not invalidate current behaviour
- no blocking issue remains inside WS5-B scope

Do **not** require full parity with total dashboard SLA exposure if the approved operational filters intentionally narrow the breach-board meaning.

## Scope Boundary

Do **not**:

- reopen WS5-A
- reopen the approved operational filters
- broaden into overall breach-board redesign
- reopen WS1 trusted slices

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop10_ws5b_evaluated.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
3. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
4. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`
5. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
   - only if residual status changes

## Completion Standard

This loop is complete when:

- the promotion decision is explicit
- the qualification is classified clearly
- the next lifecycle step is explicit

