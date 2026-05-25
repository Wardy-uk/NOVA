# WS5-A Runtime Verification Brief — Loop 03

**Date:** 2026-05-20
**Prerequisite:** WS5-A code deployed (commit with `refreshAllAgentMetrics()` fixes)
**Status:** READY — execute after deploy

---

## Your Role

You are the **Build Agent** for the NOVA KPI Engine Recovery programme.

Your role in this loop is to verify that the WS5-A population-path fixes are working correctly in production after deployment.

You are **not** implementing anything. You are observing and reporting.

---

## Required Inputs

- This brief
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5_breach_board_fix_report_loop02.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\03_workstreams\ws5_surface_divergence\ws5_manager_brief_loop03_post_build.md`

---

## Verification Checks

### RV-1: Development Agent Visibility

**What to check:** Do agents with Development-tier tickets now appear in the breach board data?

**Method:**
1. Call `/api/public/wallboard/breached` (or query `dbo.Agent` directly if API not accessible)
2. Look for agents who have Development-tier open tickets in `jira_issue_cache`
3. Confirm those agents now have non-zero `OpenTickets_Total` in the breach board response

**Pass criteria:** At least one Development-tier agent appears with `OpenTickets_Total > 0` who was previously absent.

### RV-2: OldestTicketKey Population

**What to check:** Is `OldestTicketKey` now populated for agents with open tickets?

**Method:**
1. Query `dbo.Agent WHERE OpenTickets_Total > 0`
2. Check `OldestTicketKey` column values
3. Cross-check a sample (2-3 agents) against `jira_issue_cache` to confirm the key corresponds to their oldest open ticket

**Pass criteria:** OldestTicketKey is non-NULL for agents with open tickets. Sample cross-check matches.

### RV-3: AccountId Match Observability

**What to check:** Are the new log lines emitting useful information?

**Method:**
1. Check server logs for `[kpi-pipeline] Agent metrics refresh:` line
2. Record: agents from cache, matched in dbo.Agent, unmatched
3. If unmatched > 0, record the first few unmatched AccountIds

**Pass criteria:** Log line is present. Match/unmatch counts are reasonable (matched > 0). If high unmatched rate, document it as a follow-up finding.

### RV-4: WORST OLDEST Improvement

**What to check:** Has the breach board "WORST OLDEST" metric changed now that Development agents are included?

**Method:**
1. Record current breach board WORST OLDEST value
2. Compare to pre-deploy baseline (76 days, from build report)
3. Compare to dashboard "Oldest Development" (was 197 days)

**Pass criteria:** WORST OLDEST has increased from 76d baseline. If Development agents have the oldest tickets, it should approach the dashboard's Development oldest value. Exact match not required (different SLA logic — WS5-B scope).

---

## What NOT to Check

- **TICKETS OVER SLA parity with dashboard** — this requires WS5-B (SLA-definition alignment). The breach board still uses `sla_breached` (from `customfield_10010`, completed cycles only). Divergence from dashboard's `customfield_14048`-based count is EXPECTED and NOT a failure of WS5-A.

---

## Required Output

Write:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\ws5a_runtime_verification_report_loop03.md`

Report must include:
1. RV-1 through RV-4 results (PASS/FAIL/PARTIAL with evidence)
2. Any unexpected findings (e.g., high AccountId mismatch rate)
3. Whether WS5-A can be promoted to SOURCE DEFINED based on results
4. Any findings that should inform WS5-B scoping

---

## Completion Standard

This loop is complete when:
- All four RV checks are executed and reported
- Any anomalies are documented with evidence
- A clear promotion recommendation is made
- Findings relevant to WS5-B are handed back
