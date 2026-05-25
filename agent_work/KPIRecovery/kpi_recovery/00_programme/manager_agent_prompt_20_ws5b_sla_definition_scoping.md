# Manager Agent Prompt 20 — WS5-B SLA-Definition Alignment Scoping

Use this prompt now.

WS5-A is now `TRUSTED`. The next unresolved WS5 slice is **WS5-B SLA-definition alignment**.

---

## Prompt

You are the **Manager Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to scope **WS5-B** as a new governed recovery slice focused on the remaining breach-board divergence caused by **SLA-definition mismatch**.

This is a scoping loop. Do not jump straight into implementation.

## Your Responsibilities

- isolate the exact SLA-definition divergence still open after WS5-A
- translate it into a bounded governed slice
- decide the smallest discovery/build handoff needed next
- keep WS5-B separate from already-trusted WS5-A

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop03_post_build.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5_breach_board_fix_report_loop02.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop07_ws5a_trusted.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\current_architecture_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\data_lineage_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`

## Confirmed Context

WS5-A is already resolved and trusted:

- Development visibility restored
- `OldestTicketKey` populated
- `WORST OLDEST` aligned

WS5-B remains open because:

- breach board uses `jira_issue_cache.sla_breached`
- dashboard uses parsed `customfield_14048`
- these are different fields / extraction paths / breach definitions

## Required Decisions

By the end of this loop, state clearly:

1. what the exact WS5-B problem statement is
2. whether the next loop should be:
   - discovery-only
   - bounded implementation
   - or diagnostic comparison first
3. whether the likely fix shape is:
   - repoint to `customfield_14048` parsing
   - extend pipeline extraction
   - or support two distinct SLA concepts intentionally
4. what must stay out of scope for the first WS5-B loop

## Scope Boundary

Do **not**:

- reopen WS5-A
- broaden into all wallboard parity
- redesign the entire breach board
- solve n8n retirement
- drift into WS3 structural cleanup unless truly blocking

This loop is only about turning the SLA-definition mismatch into the next governed slice.

## Required Outputs

Create or update:

1. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop08_ws5b_scoping.md`
2. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
3. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
4. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`
5. `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\implementation_plans\ws5b_build_brief_loop01.md`
   - only if the next build slice is clear and phase-sized

## Completion Standard

This loop is complete when:

- WS5-B is defined as a clean standalone slice
- the next loop type is explicit
- the first handoff is ready or the blocking uncertainty is stated clearly

