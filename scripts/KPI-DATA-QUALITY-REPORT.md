# NOVA KPI Dashboard - Complete Data Quality Report
**Generated:** 2026-04-09 | **Database:** techservicesjsm.jira_kpi_daily

---

## Executive Summary

The jira_kpi_daily table has **2,336 missing KPI cells** across **156 of 160 dates**.
Only 3 dates (Mar 10-12) have the full 101-KPI baseline. The gaps break into 4 categories:

| Category | Missing Cells | % of Total | Can Reconstruct? |
|---|---|---|---|
| KPI not invented yet | 1,519 | 65% | No - tracking started later |
| Workflow failure (Apr) | 238 | 10% | Yes - Jira API historical queries |
| Weekend gaps | 325 | 14% | Partial - derived KPIs need resolved tickets |
| Unknown weekday gaps | 254 | 11% | Partial - depends on KPI type |
| **Total** | **2,336** | **100%** | |

---

## Part 1: KPI Lifecycle - When Each KPI Was Added

| Date Added | KPIs Introduced | Count |
|---|---|---|
| 2025-11-01 | CC (TPJ) FRT breached (actionable), CC (TPJ) FRT breached (not actionable), CC (TPJ) over SLA (actionable), ... (+58 more) | 61 |
| 2025-11-03 | 1st Line Resolution Rate %, FCR Rate % | 2 |
| 2025-11-11 | CSAT % | 1 |
| 2025-11-15 | Development FRT breached (not actionable) | 1 |
| 2025-11-28 | Number of Tickets With No Reply in Development | 1 |
| 2025-12-01 | FRT Breached (All), FRT Breached (Customer Care), FRT Breached (Development), ... (+21 more) | 24 |
| 2026-01-01 | FRT Compliance % (Customer Care), FRT Compliance % (Tier 2), Resolution Compliance % (Customer Care), ... (+1 more) | 4 |
| 2026-01-05 | FRT Compliance % (Development), Resolution Compliance % (Development) | 2 |
| 2026-01-06 | FRT Compliance % (Production), Resolution Compliance % (Production) | 2 |
| 2026-01-11 | FRT Compliance % (Tier 3), Resolution Compliance % (Tier 3) | 2 |
| 2026-02-05 | Development over SLA (not actionable) | 1 |
| 2026-04-07 | Number of Tickets in Customer Care (Incidents), Number of Tickets in Customer Care (Service Requests), Tickets opened today, ... (+1 more) | 4 |

**Key transitions:**
- **Nov 1**: 61 original KPIs (ticket counts, escalations, FRT breaches, SLA over)
- **Dec 1**: +24 SLA raw metrics (FRT/Resolution Breached & Met by tier)
- **Jan 1-11**: +10 compliance % metrics (rolled out per tier)
- **Feb 5**: +1 Development over SLA (not actionable)
- **Apr 7**: +4 duplicate KPIs from backfill naming mismatch (to be cleaned)

---

## Part 2: Complete Date-by-Date Gap Report

| Date | Day | KPIs | Missing | Not Invented | Wf Failure | Weekend | Unknown |
|---|---|---|---|---|---|---|---|
| 2025-11-01 | Sat WE | 61 | 40 | 40 | - | - | - |
| 2025-11-02 | Sun WE | 61 | 40 | 40 | - | - | - |
| 2025-11-03 | Mon | 63 | 38 | 38 | - | - | - |
| 2025-11-04 | Tue | 63 | 38 | 38 | - | - | - |
| 2025-11-05 | Wed | 63 | 38 | 38 | - | - | - |
| 2025-11-06 | Thu | 63 | 38 | 38 | - | - | - |
| 2025-11-07 | Fri | 63 | 38 | 38 | - | - | - |
| 2025-11-08 | Sat WE | 61 | 40 | 38 | - | 2 | - |
| 2025-11-09 | Sun WE | 61 | 40 | 38 | - | 2 | - |
| 2025-11-10 | Mon | 63 | 38 | 38 | - | - | - |
| 2025-11-11 | Tue | 64 | 37 | 37 | - | - | - |
| 2025-11-12 | Wed | 64 | 37 | 37 | - | - | - |
| 2025-11-13 | Thu | 64 | 37 | 37 | - | - | - |
| 2025-11-14 | Fri | 64 | 37 | 37 | - | - | - |
| 2025-11-15 | Sat WE | 62 | 39 | 36 | - | 3 | - |
| 2025-11-16 | Sun WE | 63 | 38 | 36 | - | 2 | - |
| 2025-11-17 | Mon | 65 | 36 | 36 | - | - | - |
| 2025-11-18 | Tue | 65 | 36 | 36 | - | - | - |
| 2025-11-19 | Wed | 65 | 36 | 36 | - | - | - |
| 2025-11-20 | Thu | 65 | 36 | 36 | - | - | - |
| 2025-11-21 | Fri | 64 | 37 | 36 | - | - | 1 |
| 2025-11-22 | Sat WE | 62 | 39 | 36 | - | 3 | - |
| 2025-11-23 | Sun WE | 62 | 39 | 36 | - | 3 | - |
| 2025-11-24 | Mon | 64 | 37 | 36 | - | - | 1 |
| 2025-11-25 | Tue | 65 | 36 | 36 | - | - | - |
| 2025-11-26 | Wed | 65 | 36 | 36 | - | - | - |
| 2025-11-27 | Thu | 65 | 36 | 36 | - | - | - |
| 2025-11-28 | Fri | 66 | 35 | 35 | - | - | - |
| 2025-11-29 | Sat WE | 65 | 36 | 35 | - | 1 | - |
| 2025-11-30 | Sun WE | 66 | 35 | 35 | - | - | - |
| 2025-12-01 | Mon | 90 | 11 | 11 | - | - | - |
| 2025-12-02 | Tue | 90 | 11 | 11 | - | - | - |
| 2025-12-03 | Wed | 90 | 11 | 11 | - | - | - |
| 2025-12-04 | Thu | 90 | 11 | 11 | - | - | - |
| 2025-12-05 | Fri | 90 | 11 | 11 | - | - | - |
| 2025-12-06 | Sat WE | 90 | 11 | 11 | - | - | - |
| 2025-12-07 | Sun WE | 89 | 12 | 11 | - | 1 | - |
| 2025-12-08 | Mon | 89 | 12 | 11 | - | - | 1 |
| 2025-12-09 | Tue | 90 | 11 | 11 | - | - | - |
| 2025-12-10 | Wed | 90 | 11 | 11 | - | - | - |
| 2025-12-11 | Thu | 90 | 11 | 11 | - | - | - |
| 2025-12-12 | Fri | 89 | 12 | 11 | - | - | 1 |
| 2025-12-13 | Sat WE | 89 | 12 | 11 | - | 1 | - |
| 2025-12-14 | Sun WE | 89 | 12 | 11 | - | 1 | - |
| 2025-12-15 | Mon | 90 | 11 | 11 | - | - | - |
| 2025-12-16 | Tue | 90 | 11 | 11 | - | - | - |
| 2025-12-17 | Wed | 90 | 11 | 11 | - | - | - |
| 2025-12-18 | Thu | 90 | 11 | 11 | - | - | - |
| 2025-12-19 | Fri | 89 | 12 | 11 | - | - | 1 |
| 2025-12-20 | Sat WE | 82 | 19 | 11 | - | 8 | - |
| 2025-12-21 | Sun WE | 87 | 14 | 11 | - | 3 | - |
| 2025-12-22 | Mon | 89 | 12 | 11 | - | - | 1 |
| 2025-12-23 | Tue | 89 | 12 | 11 | - | - | 1 |
| 2025-12-24 | Wed | 89 | 12 | 11 | - | - | 1 |
| 2025-12-25 | Thu | 82 | 19 | 11 | - | - | 8 |
| 2025-12-26 | Fri | 82 | 19 | 11 | - | - | 8 |
| 2025-12-27 | Sat WE | 82 | 19 | 11 | - | 8 | - |
| 2025-12-28 | Sun WE | 88 | 13 | 11 | - | 2 | - |
| 2025-12-29 | Mon | 90 | 11 | 11 | - | - | - |
| 2025-12-30 | Tue | 90 | 11 | 11 | - | - | - |
| 2025-12-31 | Wed | 90 | 11 | 11 | - | - | - |
| 2026-01-01 | Thu | 91 | 10 | 7 | - | - | 3 |
| 2026-01-02 | Fri | 93 | 8 | 7 | - | - | 1 |
| 2026-01-03 | Sat WE | 84 | 17 | 7 | - | 10 | - |
| 2026-01-04 | Sun WE | 91 | 10 | 7 | - | 3 | - |
| 2026-01-05 | Mon | 96 | 5 | 5 | - | - | - |
| 2026-01-06 | Tue | 98 | 3 | 3 | - | - | - |
| 2026-01-07 | Wed | 98 | 3 | 3 | - | - | - |
| 2026-01-08 | Thu | 98 | 3 | 3 | - | - | - |
| 2026-01-09 | Fri | 94 | 7 | 3 | - | - | 4 |
| 2026-01-10 | Sat WE | 93 | 8 | 3 | - | 5 | - |
| 2026-01-11 | Sun WE | 96 | 5 | 1 | - | 4 | - |
| 2026-01-12 | Mon | 98 | 3 | 1 | - | - | 2 |
| 2026-01-13 | Tue | 98 | 3 | 1 | - | - | 2 |
| 2026-01-14 | Wed | 98 | 3 | 1 | - | - | 2 |
| 2026-01-15 | Thu | 98 | 3 | 1 | - | - | 2 |
| 2026-01-16 | Fri | 98 | 3 | 1 | - | - | 2 |
| 2026-01-17 | Sat WE | 93 | 8 | 1 | - | 7 | - |
| 2026-01-18 | Sun WE | 89 | 12 | 1 | - | 11 | - |
| 2026-01-19 | Mon | 98 | 3 | 1 | - | - | 2 |
| 2026-01-20 | Tue | 97 | 4 | 1 | - | - | 3 |
| 2026-01-21 | Wed | 96 | 5 | 1 | - | - | 4 |
| 2026-01-22 | Thu | 98 | 3 | 1 | - | - | 2 |
| 2026-01-23 | Fri | 98 | 3 | 1 | - | - | 2 |
| 2026-01-24 | Sat WE | 96 | 5 | 1 | - | 4 | - |
| 2026-01-25 | Sun WE | 99 | 2 | 1 | - | 1 | - |
| 2026-01-26 | Mon | 100 | 1 | 1 | - | - | - |
| 2026-01-27 | Tue | 98 | 3 | 1 | - | - | 2 |
| 2026-01-28 | Wed | 98 | 3 | 1 | - | - | 2 |
| 2026-01-29 | Thu | 98 | 3 | 1 | - | - | 2 |
| 2026-01-30 | Fri | 98 | 3 | 1 | - | - | 2 |
| 2026-01-31 | Sat WE | 93 | 8 | 1 | - | 7 | - |
| 2026-02-01 | Sun WE | 98 | 3 | 1 | - | 2 | - |
| 2026-02-02 | Mon | 98 | 3 | 1 | - | - | 2 |
| 2026-02-03 | Tue | 98 | 3 | 1 | - | - | 2 |
| 2026-02-04 | Wed | 98 | 3 | 1 | - | - | 2 |
| 2026-02-05 | Thu | 99 | 2 | - | - | - | 2 |
| 2026-02-06 | Fri | 99 | 2 | - | - | - | 2 |
| 2026-02-07 | Sat WE | 92 | 9 | - | - | 9 | - |
| 2026-02-08 | Sun WE | 99 | 2 | - | - | 2 | - |
| 2026-02-09 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-02-10 | Tue | 99 | 2 | - | - | - | 2 |
| 2026-02-11 | Wed | 99 | 2 | - | - | - | 2 |
| 2026-02-12 | Thu | 99 | 2 | - | - | - | 2 |
| 2026-02-13 | Fri | 98 | 3 | - | - | - | 3 |
| 2026-02-14 | Sat WE | 91 | 10 | - | - | 10 | - |
| 2026-02-15 | Sun WE | 97 | 4 | - | - | 4 | - |
| 2026-02-16 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-02-17 | Tue | 99 | 2 | - | - | - | 2 |
| 2026-02-18 | Wed | 99 | 2 | - | - | - | 2 |
| 2026-02-19 | Thu | 99 | 2 | - | - | - | 2 |
| 2026-02-20 | Fri | 99 | 2 | - | - | - | 2 |
| 2026-02-21 | Sat WE | 90 | 11 | - | - | 11 | - |
| 2026-02-22 | Sun WE | 97 | 4 | - | - | 4 | - |
| 2026-02-23 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-02-24 | Tue | 99 | 2 | - | - | - | 2 |
| 2026-02-25 | Wed | 99 | 2 | - | - | - | 2 |
| 2026-02-26 | Thu | 99 | 2 | - | - | - | 2 |
| 2026-02-27 | Fri | 99 | 2 | - | - | - | 2 |
| 2026-02-28 | Sat WE | 94 | 7 | - | - | 7 | - |
| 2026-03-01 | Sun WE | 96 | 5 | - | - | 5 | - |
| 2026-03-02 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-03-03 | Tue | 99 | 2 | - | - | - | 2 |
| 2026-03-04 | Wed | 99 | 2 | - | - | - | 2 |
| 2026-03-05 | Thu | 99 | 2 | - | - | - | 2 |
| 2026-03-06 | Fri | 99 | 2 | - | - | - | 2 |
| 2026-03-07 | Sat WE | 85 | 16 | - | - | 16 | - |
| 2026-03-08 | Sun WE | 96 | 5 | - | - | 5 | - |
| 2026-03-09 | Mon | 100 | 1 | - | - | - | 1 |
| 2026-03-10 | Tue | 101 | 0 | - | - | - | FULL |
| 2026-03-11 | Wed | 101 | 0 | - | - | - | FULL |
| 2026-03-12 | Thu | 101 | 0 | - | - | - | FULL |
| 2026-03-13 | Fri | 98 | 3 | - | - | - | 3 |
| 2026-03-14 | Sat WE | 85 | 16 | - | - | 16 | - |
| 2026-03-15 | Sun WE | 97 | 4 | - | - | 4 | - |
| 2026-03-16 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-03-17 | Tue | 98 | 3 | - | - | - | 3 |
| 2026-03-18 | Wed | 98 | 3 | - | - | - | 3 |
| 2026-03-19 | Thu | 98 | 3 | - | - | - | 3 |
| 2026-03-20 | Fri | 98 | 3 | - | - | - | 3 |
| 2026-03-21 | Sat WE | 78 | 23 | - | - | 23 | - |
| 2026-03-22 | Sun WE | 62 | 39 | - | - | 39 | - |
| 2026-03-23 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-03-24 | Tue | 99 | 2 | - | - | - | 2 |
| 2026-03-25 | Wed | 99 | 2 | - | - | - | 2 |
| 2026-03-26 | Thu | 99 | 2 | - | - | - | 2 |
| 2026-03-27 | Fri | 99 | 2 | - | - | - | 2 |
| 2026-03-28 | Sat WE | 61 | 40 | - | - | 40 | - |
| 2026-03-29 | Sun WE | 65 | 36 | - | - | 36 | - |
| 2026-03-30 | Mon | 99 | 2 | - | - | - | 2 |
| 2026-03-31 | Tue | 99 | 2 | - | - | - | 2 |
| 2026-04-01 | Wed | 99 | 2 | - | - | - | 2 |
| 2026-04-02 | Thu | 96 | 5 | - | - | - | 5 |
| 2026-04-03 | Fri | 56 | 45 | - | 45 | - | - |
| 2026-04-04 | Sat WE | 58 | 43 | - | 43 | - | - |
| 2026-04-05 | Sun WE | 56 | 45 | - | 45 | - | - |
| 2026-04-06 | Mon | 61 | 40 | - | 40 | - | - |
| 2026-04-07 | Tue | 100 | 5 | - | 5 | - | - |
| 2026-04-08 | Wed | 45 | 60 | - | 60 | - | - |
| 2026-04-09 | Thu | **0** | **101** | - | - | - | **NO DATA** |

---

## Part 3: Reconstruction Feasibility by KPI Type

### Ticket Counts (by tier/queue)
- **Can reconstruct:** YES | **Accuracy:** HIGH
- **Source:** Jira API: `project = NT AND created <= "DATE" AND (resolutiondate > "DATE" OR resolutiondate is EMPTY)`
- **Notes:** Current tier assignment used. May differ from historical if ticket was reassigned between tiers.
- **KPIs (7):** Number of Tickets in CC (Incidents), Number of Tickets in CC (Service Requests), Number of Tickets in CC (TPJ), Number of Tickets in Development, Number of Tickets in Production...

### No-Reply Counts
- **Can reconstruct:** YES | **Accuracy:** MEDIUM
- **Source:** Jira API: Same query as ticket counts, check last comment author type
- **Notes:** Replies added AFTER the target date make the historical count lower than reality. Under-reports no-reply.
- **KPIs (7):** Number of Tickets With No Reply in CC (Incidents), Number of Tickets With No Reply in CC (Service Requests), Number of Tickets With No Reply in CC (TPJ), Number of Tickets With No Reply in Development, Number of Tickets With No Reply in Production...

### Oldest Actionable Ticket (days)
- **Can reconstruct:** YES | **Accuracy:** HIGH
- **Source:** Jira API: Calculate (target_date - created_date) for open tickets per tier
- **Notes:** Accurate from immutable creation dates.
- **KPIs (7):** Oldest actionable ticket (days) in CC (TPJ), Oldest actionable ticket (days) in CC Incidents, Oldest actionable ticket (days) in CC Service Requests, Oldest actionable ticket (days) in Development, Oldest actionable ticket (days) in Production...

### New Tickets / Solved Today
- **Can reconstruct:** YES | **Accuracy:** EXACT
- **Source:** Jira API: created >= DATE AND created < NEXT_DATE / resolutiondate >= DATE AND resolutiondate < NEXT_DATE
- **Notes:** Jira created and resolutiondate fields are immutable. Exact reconstruction.
- **KPIs (2):** New Tickets Today, Tickets Solved Today

### Escalation/Rejection Counts + Accuracy %
- **Can reconstruct:** YES | **Accuracy:** EXACT
- **Source:** SQL: JiraTickets table has Tier2EscalationAt, Tier3EscalationAt, DevEscalationAt timestamps
- **Notes:** Timestamps in JiraTickets give precise per-day counts. Accuracy % is a 30-day rolling calc.
- **KPIs (7):** Escalation Accuracy %, Tickets escalated to Development, Tickets escalated to Tier 2, Tickets escalated to Tier 3, Tickets rejected by Development...

### Over SLA (actionable/not actionable)
- **Can reconstruct:** NO | **Accuracy:** LOW - NOT RECOMMENDED
- **Source:** Jira API: SLA field (customfield_10020) on open tickets
- **Notes:** SLA status is LIVE/CURRENT, not historical. A ticket breached today was likely within SLA on the target date. Inserting current SLA state as historical data would be inaccurate.
- **KPIs (14):** CC (TPJ) over SLA (actionable), CC (TPJ) over SLA (not actionable), CC Incidents over SLA (actionable), CC Incidents over SLA (not actionable), CC Service Requests over SLA (actionable)...

### FRT Breached/Met (per tier, raw counts)
- **Can reconstruct:** NO | **Accuracy:** CANNOT
- **Source:** Separate SLA pipeline (not the Daily KPI Report v4 workflow)
- **Notes:** These come from a different n8n workflow. Would need to replay that workflow logic against historical ticket data. Not feasible.
- **KPIs (12):** FRT Breached (All), FRT Breached (Customer Care), FRT Breached (Development), FRT Breached (Production), FRT Breached (Tier 2)...

### Resolution Breached/Met (per tier, raw counts)
- **Can reconstruct:** NO | **Accuracy:** CANNOT
- **Source:** Separate SLA pipeline
- **Notes:** Same as FRT - separate pipeline, historical state not reconstructable.
- **KPIs (12):** Resolution Breached (All), Resolution Breached (Customer Care), Resolution Breached (Development), Resolution Breached (Production), Resolution Breached (Tier 2)...

### FRT/Resolution Compliance %
- **Can reconstruct:** NO | **Accuracy:** CANNOT
- **Source:** Derived from FRT/Resolution Breached & Met counts
- **Notes:** Cannot calculate compliance % without the raw Breached/Met counts which are themselves not reconstructable.
- **KPIs (14):** FRT Compliance % (Customer Care), FRT Compliance % (Development), FRT Compliance % (Open Queue), FRT Compliance % (Production), FRT Compliance % (Resolved Today)...

### FRT/Resolution Breaches (Resolved Today)
- **Can reconstruct:** NO | **Accuracy:** CANNOT
- **Source:** Separate SLA pipeline
- **Notes:** Counts breaches for tickets resolved on that specific day. Requires SLA pipeline replay.
- **KPIs (2):** FRT Breaches (Resolved Today), Resolution Breaches (Resolved Today)

### FRT Breached per queue (actionable/not actionable)
- **Can reconstruct:** NO | **Accuracy:** CANNOT
- **Source:** Separate SLA pipeline
- **Notes:** Same limitation as other SLA pipeline metrics.
- **KPIs (14):** CC (TPJ) FRT breached (actionable), CC (TPJ) FRT breached (not actionable), CC Incidents FRT breached (actionable), CC Incidents FRT breached (not actionable), CC Service Requests FRT breached (actionable)...

### Derived KPIs (FCR%, CSAT%, 1st Line%)
- **Can reconstruct:** YES | **Accuracy:** MEDIUM-HIGH
- **Source:** Jira API: Fetch resolved tickets with full comment history + CSAT field (customfield_12802)
- **Notes:** FCR: checks if customer followed up after first agent reply. CSAT: from rating field. 1st Line: resolved at CC tier. Comment history is preserved, but deleted comments would affect accuracy.
- **KPIs (3):** 1st Line Resolution Rate %, CSAT %, FCR Rate %

---

## Part 4: Reconstruction Summary

| | KPIs | Approx Missing Cells |
|---|---|---|
| **CAN reconstruct with real data** | 33 | ~800 |
| **CANNOT reconstruct (SLA pipeline)** | 68 | ~1,536 |
| **Total baseline** | 101 | ~2,336 |

### Reconstructable KPIs (Jira API + JiraTickets SQL):
- 1st Line Resolution Rate %
- CSAT %
- Escalation Accuracy %
- FCR Rate %
- New Tickets Today
- Number of Tickets With No Reply in CC (Incidents)
- Number of Tickets With No Reply in CC (Service Requests)
- Number of Tickets With No Reply in CC (TPJ)
- Number of Tickets With No Reply in Development
- Number of Tickets With No Reply in Production
- Number of Tickets With No Reply in Tier 2
- Number of Tickets With No Reply in Tier 3
- Number of Tickets in CC (Incidents)
- Number of Tickets in CC (Service Requests)
- Number of Tickets in CC (TPJ)
- Number of Tickets in Development
- Number of Tickets in Production
- Number of Tickets in Tier 2
- Number of Tickets in Tier 3
- Oldest actionable ticket (days) in CC (TPJ)
- Oldest actionable ticket (days) in CC Incidents
- Oldest actionable ticket (days) in CC Service Requests
- Oldest actionable ticket (days) in Development
- Oldest actionable ticket (days) in Production
- Oldest actionable ticket (days) in Tier 2
- Oldest actionable ticket (days) in Tier 3
- Tickets Solved Today
- Tickets escalated to Development
- Tickets escalated to Tier 2
- Tickets escalated to Tier 3
- Tickets rejected by Development
- Tickets rejected by Tier 2
- Tickets rejected by Tier 3

### NOT Reconstructable (SLA pipeline data, historical state lost):
- CC (TPJ) FRT breached (actionable)
- CC (TPJ) FRT breached (not actionable)
- CC (TPJ) over SLA (actionable)
- CC (TPJ) over SLA (not actionable)
- CC Incidents FRT breached (actionable)
- CC Incidents FRT breached (not actionable)
- CC Incidents over SLA (actionable)
- CC Incidents over SLA (not actionable)
- CC Service Requests FRT breached (actionable)
- CC Service Requests FRT breached (not actionable)
- CC Service Requests over SLA (actionable)
- CC Service Requests over SLA (not actionable)
- Development FRT breached (actionable)
- Development FRT breached (not actionable)
- Development over SLA (actionable)
- Development over SLA (not actionable)
- FRT Breached (All)
- FRT Breached (Customer Care)
- FRT Breached (Development)
- FRT Breached (Production)
- FRT Breached (Tier 2)
- FRT Breached (Tier 3)
- FRT Breaches (Resolved Today)
- FRT Compliance % (Customer Care)
- FRT Compliance % (Development)
- FRT Compliance % (Open Queue)
- FRT Compliance % (Production)
- FRT Compliance % (Resolved Today)
- FRT Compliance % (Tier 2)
- FRT Compliance % (Tier 3)
- FRT Met (All)
- FRT Met (Customer Care)
- FRT Met (Development)
- FRT Met (Production)
- FRT Met (Tier 2)
- FRT Met (Tier 3)
- Production FRT breached (actionable)
- Production FRT breached (not actionable)
- Production over SLA (actionable)
- Production over SLA (not actionable)
- Resolution Breached (All)
- Resolution Breached (Customer Care)
- Resolution Breached (Development)
- Resolution Breached (Production)
- Resolution Breached (Tier 2)
- Resolution Breached (Tier 3)
- Resolution Breaches (Resolved Today)
- Resolution Compliance % (Customer Care)
- Resolution Compliance % (Development)
- Resolution Compliance % (Open Queue)
- Resolution Compliance % (Production)
- Resolution Compliance % (Resolved Today)
- Resolution Compliance % (Tier 2)
- Resolution Compliance % (Tier 3)
- Resolution Met (All)
- Resolution Met (Customer Care)
- Resolution Met (Development)
- Resolution Met (Production)
- Resolution Met (Tier 2)
- Resolution Met (Tier 3)
- Tier 2 FRT breached (actionable)
- Tier 2 FRT breached (not actionable)
- Tier 2 over SLA (actionable)
- Tier 2 over SLA (not actionable)
- Tier 3 FRT breached (actionable)
- Tier 3 FRT breached (not actionable)
- Tier 3 over SLA (actionable)
- Tier 3 over SLA (not actionable)

---

## Part 5: Proposed Fix Options

### Option A: Backfill ONLY what can be reconstructed with real data
- Query Jira API for each gap date, calculate real values for ~30 reconstructable KPIs
- Dates: Primarily Apr 3, 6, 8 (workflow failures) + scattered unknown-cause gaps
- Non-reconstructable KPIs: Left as-is (blank on dashboard)
- **Pros:** No fake data, everything shown is accurate
- **Cons:** Dashboard still shows gaps for SLA/compliance KPIs

### Option B: Real data + fill non-reconstructable with 0
- Same as Option A, plus insert 0 for KPIs that cannot be reconstructed
- **Pros:** Dashboard shows complete grid
- **Cons:** 0 values are misleading (0% compliance != "not measured")

### Option C: Real data + mark non-reconstructable as N/A
- Insert a special marker value (e.g., -1) for non-reconstructable KPIs
- Update frontend to render -1 as "N/A" or grey cell
- **Pros:** Complete grid + honest about what is estimated
- **Cons:** Requires a small frontend change to KpiDailyHistoryView.tsx

### Option D: Real data + adjust dashboard start date
- Backfill reconstructable KPIs
- Change dashboard default to start from Dec 1 2025 (when SLA pipeline started)
- **Pros:** Eliminates worst gaps (Nov = 40 missing/day). From Dec, only minor gaps remain.
- **Cons:** Loses Nov 2025 data visibility

---

## Part 6: n8n Workflow Execution Plan

### Architecture
- SplitInBatches loop: process one date at a time
- Per date: 3 Jira API calls + 1 SQL query (parallel)
- Parse into ~30 KPI rows
- Upsert to jira_kpi_daily (DELETE + INSERT)

### Dates requiring Jira API backfill: 75
- 2025-11-21 (Fri): 0 wf-failure + 1 unknown
- 2025-11-24 (Mon): 0 wf-failure + 1 unknown
- 2025-12-08 (Mon): 0 wf-failure + 1 unknown
- 2025-12-12 (Fri): 0 wf-failure + 1 unknown
- 2025-12-19 (Fri): 0 wf-failure + 1 unknown
- 2025-12-22 (Mon): 0 wf-failure + 1 unknown
- 2025-12-23 (Tue): 0 wf-failure + 1 unknown
- 2025-12-24 (Wed): 0 wf-failure + 1 unknown
- 2025-12-25 (Thu): 0 wf-failure + 8 unknown
- 2025-12-26 (Fri): 0 wf-failure + 8 unknown
- 2026-01-01 (Thu): 0 wf-failure + 3 unknown
- 2026-01-02 (Fri): 0 wf-failure + 1 unknown
- 2026-01-09 (Fri): 0 wf-failure + 4 unknown
- 2026-01-12 (Mon): 0 wf-failure + 2 unknown
- 2026-01-13 (Tue): 0 wf-failure + 2 unknown
- 2026-01-14 (Wed): 0 wf-failure + 2 unknown
- 2026-01-15 (Thu): 0 wf-failure + 2 unknown
- 2026-01-16 (Fri): 0 wf-failure + 2 unknown
- 2026-01-19 (Mon): 0 wf-failure + 2 unknown
- 2026-01-20 (Tue): 0 wf-failure + 3 unknown
- 2026-01-21 (Wed): 0 wf-failure + 4 unknown
- 2026-01-22 (Thu): 0 wf-failure + 2 unknown
- 2026-01-23 (Fri): 0 wf-failure + 2 unknown
- 2026-01-27 (Tue): 0 wf-failure + 2 unknown
- 2026-01-28 (Wed): 0 wf-failure + 2 unknown
- 2026-01-29 (Thu): 0 wf-failure + 2 unknown
- 2026-01-30 (Fri): 0 wf-failure + 2 unknown
- 2026-02-02 (Mon): 0 wf-failure + 2 unknown
- 2026-02-03 (Tue): 0 wf-failure + 2 unknown
- 2026-02-04 (Wed): 0 wf-failure + 2 unknown
- 2026-02-05 (Thu): 0 wf-failure + 2 unknown
- 2026-02-06 (Fri): 0 wf-failure + 2 unknown
- 2026-02-09 (Mon): 0 wf-failure + 2 unknown
- 2026-02-10 (Tue): 0 wf-failure + 2 unknown
- 2026-02-11 (Wed): 0 wf-failure + 2 unknown
- 2026-02-12 (Thu): 0 wf-failure + 2 unknown
- 2026-02-13 (Fri): 0 wf-failure + 3 unknown
- 2026-02-16 (Mon): 0 wf-failure + 2 unknown
- 2026-02-17 (Tue): 0 wf-failure + 2 unknown
- 2026-02-18 (Wed): 0 wf-failure + 2 unknown
- 2026-02-19 (Thu): 0 wf-failure + 2 unknown
- 2026-02-20 (Fri): 0 wf-failure + 2 unknown
- 2026-02-23 (Mon): 0 wf-failure + 2 unknown
- 2026-02-24 (Tue): 0 wf-failure + 2 unknown
- 2026-02-25 (Wed): 0 wf-failure + 2 unknown
- 2026-02-26 (Thu): 0 wf-failure + 2 unknown
- 2026-02-27 (Fri): 0 wf-failure + 2 unknown
- 2026-03-02 (Mon): 0 wf-failure + 2 unknown
- 2026-03-03 (Tue): 0 wf-failure + 2 unknown
- 2026-03-04 (Wed): 0 wf-failure + 2 unknown
- 2026-03-05 (Thu): 0 wf-failure + 2 unknown
- 2026-03-06 (Fri): 0 wf-failure + 2 unknown
- 2026-03-09 (Mon): 0 wf-failure + 1 unknown
- 2026-03-13 (Fri): 0 wf-failure + 3 unknown
- 2026-03-16 (Mon): 0 wf-failure + 2 unknown
- 2026-03-17 (Tue): 0 wf-failure + 3 unknown
- 2026-03-18 (Wed): 0 wf-failure + 3 unknown
- 2026-03-19 (Thu): 0 wf-failure + 3 unknown
- 2026-03-20 (Fri): 0 wf-failure + 3 unknown
- 2026-03-23 (Mon): 0 wf-failure + 2 unknown
- 2026-03-24 (Tue): 0 wf-failure + 2 unknown
- 2026-03-25 (Wed): 0 wf-failure + 2 unknown
- 2026-03-26 (Thu): 0 wf-failure + 2 unknown
- 2026-03-27 (Fri): 0 wf-failure + 2 unknown
- 2026-03-30 (Mon): 0 wf-failure + 2 unknown
- 2026-03-31 (Tue): 0 wf-failure + 2 unknown
- 2026-04-01 (Wed): 0 wf-failure + 2 unknown
- 2026-04-02 (Thu): 0 wf-failure + 5 unknown
- 2026-04-03 (Fri): 45 wf-failure + 0 unknown
- 2026-04-04 (Sat): 43 wf-failure + 0 unknown
- 2026-04-05 (Sun): 45 wf-failure + 0 unknown
- 2026-04-06 (Mon): 40 wf-failure + 0 unknown
- 2026-04-07 (Tue): 5 wf-failure + 0 unknown
- 2026-04-08 (Wed): 60 wf-failure + 0 unknown
- 2026-04-09 (Thu): 0 wf-failure + 101 unknown

### Estimated runtime
- "All Open" query: ~90 seconds per date (~5,000 tickets)
- Other queries: ~5 seconds per date
- Total per date: ~100 seconds
- **75 dates x 100s = ~125 minutes**

### KPIs written per date: ~30
- 7 ticket counts (by tier/queue)
- 7 no-reply counts
- 7 oldest actionable ticket age
- 2 volume (New Tickets Today, Tickets Solved Today)
- 7 escalation/rejection counts + Escalation Accuracy %

### Risk assessment
- **Jira rate limits:** 1 date at a time, ~100 pages per "All Open" query. Safe.
- **Data accuracy:** See Part 3 per-KPI accuracy ratings
- **Idempotency:** DELETE-then-INSERT. Safe to re-run.
- **Rollback:** No destructive changes to existing data (only inserts for missing cells)

---

## Part 7: Decision Required

Nick, please choose:
1. **Which option** (A/B/C/D) for handling non-reconstructable KPIs?
2. **Which dates** to backfill? (Just Apr 3/6/8? All unknowns? All dates including weekends?)
3. **Should I also clean up** the 4 duplicate KPIs created by the earlier backfill naming mismatch?

Once you decide, I will build the exact workflow and present it for your approval before executing.