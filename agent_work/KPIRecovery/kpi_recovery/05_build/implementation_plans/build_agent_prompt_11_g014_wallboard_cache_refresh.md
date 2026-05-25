# Build Agent Prompt 11 — G-014 Wallboard Cache Refresh Fix

Use this prompt now.

WS5 is fully trusted and closed. The next bounded slice is **G-014**:

- Key Accounts and Customer Success wallboards become 12+ hours stale because `wallboard-live-cache.ts` only refreshes during business hours.

This is an independent, low-risk workflow fix.

---

## Prompt

You are the **Build Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to implement the **bounded G-014 wallboard cache refresh fix**.

This is a small operational/workflow slice. You are not redesigning wallboards or changing KPI logic.

## Your Responsibilities

- fix the refresh-window restriction in `wallboard-live-cache.ts`
- preserve existing wallboard data semantics
- keep the change tightly scoped
- report exactly what changed, what was verified, and any runtime follow-up needed

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\current_architecture_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\01_discovery\data_lineage_map.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\decision_log.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`

## Objective

Remove the business-hours-only refresh restriction so the Key Accounts and Customer Success wallboards continue refreshing outside `09:00–17:30 Mon–Fri`.

## Scope

Implement only the smallest credible fix for:

- cache refresh timing in `wallboard-live-cache.ts`

Do not change:

- the data model
- KPI calculation logic
- wallboard presentation
- breach-board behaviour
- WS1 or WS5 trusted slices

## Expected Change Shape

Investigate and update the logic around:

- `shouldRefresh()`
- any business-hours gating around wallboard live cache updates

Preferred outcome:

- refresh continues on the same cadence outside business hours
- no behavioural change to what is cached, only **when** refresh is allowed

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\g014_wallboard_cache_refresh_report_loop01.md`

Your report must include:

1. file(s) changed
2. exact logic changed
3. whether the business-hours restriction was removed or widened
4. what verification you performed
5. any deploy/runtime verification needed next
6. overall verdict on whether G-014 is ready for runtime verification

## Completion Standard

This loop is complete when:

- the bounded refresh fix is implemented
- the report is written
- the next runtime verification need is explicit

If you hit a blocker, stop at that boundary and report exact evidence.

