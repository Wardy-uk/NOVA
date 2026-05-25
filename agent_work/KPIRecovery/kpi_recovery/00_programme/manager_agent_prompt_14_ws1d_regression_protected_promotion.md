# Manager Agent Prompt 14 — WS1-D REGRESSION PROTECTED Promotion

Use this prompt now.

WS1-D has already been promoted to `EVALUATED`, and the manager has confirmed that the existing regression framework is sufficient for promotion without a dedicated addendum.

---

## Prompt

You are the **Manager Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to decide whether **WS1-D Development backlog count** should now be promoted from **EVALUATED** to **REGRESSION PROTECTED**.

This is a short governance loop. The objective is not to redesign, rediscover, or reopen WS1-D. The objective is to confirm that the existing regression framework already covers WS1-D sufficiently and to grant promotion if the gate is met.

## Your Responsibilities

- review the current WS1-D evidence and promotion status
- confirm whether the existing regression framework is sufficient
- assess the promotion gate neutrally
- record the promotion decision if justified
- define the trust path from `REGRESSION PROTECTED` to `TRUSTED`

## Current Context

WS1-D has already completed:

- business-definition resolution
- source-definition recovery
- bounded cache-freshness recovery
- independent evaluation

Loop 12 already concluded:

- WS1-D → `EVALUATED` (`D-050`)
- evaluator `QUALIFIED PASS` is non-blocking
- no WS1-D-specific regression addendum is required
- existing regression coverage is sufficient (`D-051`)

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws1_source_of_truth\ws1_manager_brief_loop12_ws1d_evaluated.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\04_eval\eval_reports\ws1d_eval_report_01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\ws1_regression_plan.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`

## Promotion Test

Assess whether the promotion gate to `REGRESSION PROTECTED` is satisfied for WS1-D.

Use the same governance logic already established for the programme:

- baseline / evidence path exists
- evaluation has passed sufficiently for the slice
- existing regression coverage includes the KPI behaviour being promoted
- no new blocking gaps have appeared

In this case, explicitly assess whether:

1. WS1-D is already behaviourally covered by the existing regression framework through RC-002
2. the `QUALIFIED PASS` evaluator result is enough to support protection
3. the deferred WS3 deletion-handling risk is non-blocking for present protection

## Required Decisions

By the end of this loop, state clearly:

1. whether WS1-D is promoted to `REGRESSION PROTECTED`
2. whether any residual risk still blocks that promotion
3. what the gate from `REGRESSION PROTECTED` to `TRUSTED` should be for WS1-D
4. whether WS1 is then fully regression-protected across all four sub-slices

## Scope Boundaries

Do **not**:

- reopen WS1-A/B/C
- reopen the cache-freshness recovery implementation
- reopen WS3 structural reconciliation design
- broaden into multi-surface divergence
- invent a new regression framework if the current one is already sufficient

This loop is only about promotion and trust-path routing.

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws1_source_of_truth\ws1_manager_brief_loop13_ws1d_regression_protected.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
3. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
4. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\promotion_log.md`
5. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
   - only if any WS1-D residual risk changes classification

## Completion Standard

This loop is complete when:

- the promotion decision is explicit
- the tracker and promotion log are updated
- the next trust gate is named clearly

## Final Instruction

Make the decision cleanly from the evidence already in hand.

Do not add new gates unless the current artefacts actually require them.

