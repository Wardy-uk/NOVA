# Build Agent Prompt 12 — G-014 Runtime Verification

Use this prompt after deploy.

G-014 build work is complete. This loop is for **runtime verification only**.

---

## Prompt

You are the **Build Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

## Your Role

Your role in this loop is to perform **runtime verification** for the G-014 wallboard cache refresh fix after deployment.

You are not implementing further code in this loop.

## Your Responsibilities

- verify that the Key Accounts and Customer Success wallboards now refresh outside the old business-hours window
- use live/runtime evidence only
- report exact results and any blocker clearly

## Required Inputs

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\g014_wallboard_cache_refresh_report_loop01.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\implementation_plans\build_agent_prompt_11_g014_wallboard_cache_refresh.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\00_programme\programme_tracker.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\07_decisions\gap_classification_log.md`

## Runtime Checks

Execute and report:

- `RV-G014-1` — Key Accounts wallboard data age decreases after deploy / refresh window
- `RV-G014-2` — Customer Success wallboard data age decreases after deploy / refresh window
- `RV-G014-3` — refresh continues outside the old 09:00–17:30 Mon–Fri restriction
- `RV-G014-4` — no obvious regression to the wallboard data payload shape

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\g014_runtime_verification_report_loop02.md`

Your report must include:

1. verification date/time
2. deployed version / environment context if known
3. result for `RV-G014-1` through `RV-G014-4`
4. exact runtime evidence used
5. overall verdict: `PASS / QUALIFIED PASS / FAIL`
6. any blocker to closing G-014
7. recommendation for next step

## Completion Standard

This loop is complete when all four runtime checks are executed and the report is written.

If a check is inconclusive, state exactly why.

