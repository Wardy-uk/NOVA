# KPI Comprehensive Audit: NOVA vs n8n v4 vs Jira

**Date:** 2026-05-20 07:30 UTC  
**Status:** BUSINESS CRITICAL  
**Author:** Cowork audit (Nick Ward)

---

## Executive Summary

NOVA emits **88 KPIs** to `jira_kpi_daily`. Of those, **14 are ghosts** (Customer Care + Unclassified tiers that should be suppressed). That leaves **74 legitimate KPIs**.

The n8n v4 workflow (`KriwNYXfWcGBW7D7`, INACTIVE) was designed to produce **~105 team-level KPIs** + **~30 agent-level metrics per agent**. The active n8n v3.1 workflow wrote **~100 team-level KPIs** to `KpiSnapshot` (last run: 2026-05-15).

**Gap: ~35 team-level KPIs exist in the KpiSnapshot but are NOT calculated by NOVA's pipeline.**

Additionally, NOVA has **zero agent-level KPI capability** — n8n v4's entire agent pipeline (QA scores, golden rules, per-agent CSAT, escalation accuracy) has no NOVA equivalent.

---

## Part 1: Known Bugs (Not Yet Deployed)

These were documented in `KPI-HOTFIX-REMAINING.md` but have NOT been deployed as of this audit:

| # | Bug | Evidence | Fix |
|---|-----|----------|-----|
| 1 | Ghost KPIs: Customer Care + Unclassified still emitting | "Number of Tickets in Customer Care" = 70 today, "Number of Tickets in Unclassified" = 10 today | Line 496: change to `if (!ALL_TIERS.includes(tier)) continue;` |
| 2 | TPJ parens exception wrong | "CC (TPJ) over SLA (actionable)" — should be "CC TPJ over SLA (actionable)" | Line 168: remove TPJ exception |
| 3 | Fix 5 revert (Solved Today) | Tickets Solved Today = 0 for 2026-05-20 (may be early morning, was 21 on 19th) | Revert `resolved_at` back to `jira_updated` |
| 4 | Derived KPIs never worked | FCR Rate %, 1st Line Resolution Rate %, Bug Esc-to-Ack never written | Pre-existing — investigate `collectDerivedKpis()` |

**Ghost KPIs still emitting (14 total):**

| Ghost KPI | Today's Value |
|-----------|---------------|
| Number of Tickets in Customer Care | 70 |
| Number of Tickets in Unclassified | 10 |
| Oldest actionable ticket (days) in Customer Care | 26 |
| Oldest actionable ticket (days) in Unclassified | 201 |
| Number of Tickets With No Reply in Customer Care | 29 |
| Number of Tickets With No Reply in Unclassified | 10 |
| Customer Care FRT breached (actionable) | 0 |
| Customer Care FRT breached (not actionable) | 0 |
| Customer Care over SLA (actionable) | 1 |
| Customer Care over SLA (not actionable) | 0 |
| Unclassified FRT breached (actionable) | 0 |
| Unclassified FRT breached (not actionable) | 0 |
| Unclassified over SLA (actionable) | 0 |
| Unclassified over SLA (not actionable) | 0 |

---

## Part 2: Development Count Discrepancy

| Source | Count | Notes |
|--------|-------|-------|
| NOVA `jira_kpi_daily` (today) | 275 | All issue types, tier = Development |
| NOVA `KpiSnapshot` (May 15, n8n) | 213 | Written by n8n v3.1 |
| JSM Queue "All Development" | ~230 | Seen by Nick on May 19 |

**Root cause (probable):** NOVA counts ALL issue types (Support + [System] Service request + others) where tier = Development. The JSM queue likely filters to issue type `Support` only. n8n's JQL may also filter by issue type.

**Action needed:** Check n8n's "Get All Open" JQL to confirm issue type filtering. If n8n filters by `issuetype = Support`, NOVA must do the same. This is a ~45 ticket overcounting error.

---

## Part 3: Full KPI Map — NOVA Daily vs KpiSnapshot (n8n)

### 3a. KPIs in BOTH (NOVA daily + KpiSnapshot) — should match

| KPI Name | NOVA Daily (May 20) | Snapshot (May 15) | Status |
|----------|---------------------|-------------------|--------|
| Number of Tickets in CC (Incidents) | 30 | 34 | OK (different dates) |
| Number of Tickets in CC (Service Requests) | 40 | 40 | OK |
| Number of Tickets in CC (TPJ) | 22 | 20 | OK |
| Number of Tickets in Development | 275 | 213 | SUSPECT — see Part 2 |
| Number of Tickets in Production | 28 | 24 | OK |
| Number of Tickets in Tier 2 | 65 | 43 | OK (different dates) |
| Number of Tickets in Tier 3 | 17 | 37 | OK (different dates) |
| No Reply in CC (Incidents) | 6 | 0 | OK (different dates) |
| No Reply in CC (Service Requests) | 4 | 0 | OK |
| No Reply in CC (TPJ) | 3 | 0 | OK |
| No Reply in Development | 157 | 132 | OK |
| No Reply in Production | 0 | 0 | OK |
| No Reply in Tier 2 | 5 | 0 | OK |
| No Reply in Tier 3 | 3 | 0 | OK |
| Oldest in CC (TPJ) | 21 days | 35 days | OK |
| Oldest in CC Incidents | 62 days | 16 days | OK |
| Oldest in CC Service Requests | 54 days | 50 days | OK |
| Oldest in Development | 197 days | 193 days | OK |
| Oldest in Production | 35 days | 31 days | OK |
| Oldest in Tier 2 | 75 days | 36 days | OK |
| Oldest in Tier 3 | 64 days | 57 days | OK |
| CC (TPJ) over SLA (actionable) | 2 | 0 | OK |
| CC Incidents over SLA (actionable) | 3 | 0 | OK |
| CC Service Requests over SLA (actionable) | 0 | 0 | OK |
| Development over SLA (actionable) | 14 | 15 | OK |
| Production over SLA (actionable) | 0 | 0 | OK |
| Tier 2 over SLA (actionable) | 7 | 1 | OK |
| Tier 3 over SLA (actionable) | 1 | 1 | OK |
| CC (TPJ) over SLA (not actionable) | 0 | 0 | OK |
| CC Incidents over SLA (not actionable) | 3 | 0 | OK |
| CC Service Requests over SLA (not actionable) | 0 | 0 | OK |
| Development over SLA (not actionable) | 22 | 7 | OK |
| Production over SLA (not actionable) | 0 | 0 | OK |
| Tier 2 over SLA (not actionable) | 0 | 0 | OK |
| Tier 3 over SLA (not actionable) | 1 | 1 | OK |
| CC (TPJ) FRT breached (actionable) | 0 | 11 | OK |
| CC (TPJ) FRT breached (not actionable) | 0 | 1 | OK |
| CC Incidents FRT breached (actionable) | 0 | 5 | OK |
| CC Incidents FRT breached (not actionable) | 0 | 1 | OK |
| CC Service Requests FRT breached (actionable) | 0 | 11 | OK |
| CC Service Requests FRT breached (not actionable) | 0 | 1 | OK |
| Development FRT breached (actionable) | 0 | 46 | OK |
| Development FRT breached (not actionable) | 0 | 16 | OK |
| Production FRT breached (actionable) | 0 | 4 | OK |
| Production FRT breached (not actionable) | 0 | 2 | OK |
| Tier 2 FRT breached (actionable) | 0 | 8 | OK |
| Tier 2 FRT breached (not actionable) | 0 | 0 | OK |
| Tier 3 FRT breached (actionable) | 0 | 6 | OK |
| Tier 3 FRT breached (not actionable) | 0 | 3 | OK |
| Escalation Accuracy % | 100 | 97 | OK |
| Tickets escalated to Development | 0 | 0 | OK |
| Tickets escalated to Tier 2 | 0 | 8 | OK |
| Tickets escalated to Tier 3 | 0 | 4 | OK |
| Tickets rejected by Development | 0 | 0 | OK |
| Tickets rejected by Tier 2 | 0 | 1 | OK |
| Tickets rejected by Tier 3 | 0 | 0 | OK |
| FRT Breaches (Resolved Today) | 0 | 47 | OK |
| Resolution Breaches (Resolved Today) | 0 | 11 | OK |
| FRT Compliance % (Open Queue) | 100 | 62 | SUSPECT — NOVA shows 100%, n8n showed 62% |
| FRT Compliance % (Resolved Today) | 100 | 60 | SUSPECT — same pattern |
| Resolution Compliance % (Open Queue) | 82 | 76 | OK (plausible drift) |
| Resolution Compliance % (Resolved Today) | 100 | 91 | OK (early morning, 0 resolved) |
| CSAT % | 0 | 100 | WRONG — NOVA shows 0, n8n showed 100 |
| New Tickets Today | 18 | 70 | OK (early morning) |
| Tickets Solved Today | 0 | 119 | OK if early morning; WRONG if Fix 5 revert not deployed |
| SLA Breached | 103 | — | NOVA-only KPI |
| WTD percentage KPI's Green | 49 | — | NOVA-only KPI |
| WTD percentage KPI's Red | 44 | — | NOVA-only KPI |

### 3b. KPIs in NAMING CONFLICT

| NOVA Name | Correct n8n Name | Issue |
|-----------|-------------------|-------|
| CC (TPJ) over SLA (actionable) | CC TPJ over SLA (actionable) | Bug 2: parens not stripped |
| CC (TPJ) over SLA (not actionable) | CC TPJ over SLA (not actionable) | Bug 2 |
| CC (TPJ) FRT breached (actionable) | CC TPJ FRT breached (actionable) | Bug 2 |
| CC (TPJ) FRT breached (not actionable) | CC TPJ FRT breached (not actionable) | Bug 2 |
| Oldest actionable ticket (days) in CC (TPJ) | Oldest actionable ticket (days) in CC TPJ | Bug 2 |

### 3c. KPIs MISSING from NOVA (exist in KpiSnapshot, NOT calculated by NOVA pipeline)

These 35 KPIs are written by n8n to `KpiSnapshot` but NOVA's `collectJiraSnapshot()` does not calculate them:

**Per-tier SLA Compliance % (10 KPIs):**

| Missing KPI | Last n8n Value (May 15) |
|-------------|------------------------|
| FRT Compliance % (Customer Care) | 61% |
| FRT Compliance % (Development) | 46% |
| FRT Compliance % (Production) | 71% |
| FRT Compliance % (Tier 2) | 67% |
| FRT Compliance % (Tier 3) | 0% |
| Resolution Compliance % (Customer Care) | 93% |
| Resolution Compliance % (Development) | 92% |
| Resolution Compliance % (Production) | 100% |
| Resolution Compliance % (Tier 2) | 56% |
| Resolution Compliance % (Tier 3) | 100% |

**Per-tier FRT Met/Breached counts (12 KPIs):**

| Missing KPI | Last n8n Value |
|-------------|----------------|
| FRT Met (All) | 71 |
| FRT Met (Customer Care) | 54 |
| FRT Met (Development) | 6 |
| FRT Met (Production) | 5 |
| FRT Met (Tier 2) | 6 |
| FRT Met (Tier 3) | 0 |
| FRT Breached (All) | 47 |
| FRT Breached (Customer Care) | 34 |
| FRT Breached (Development) | 7 |
| FRT Breached (Production) | 2 |
| FRT Breached (Tier 2) | 3 |
| FRT Breached (Tier 3) | 1 |

**Per-tier Resolution Met/Breached counts (12 KPIs):**

| Missing KPI | Last n8n Value |
|-------------|----------------|
| Resolution Met (All) | 107 |
| Resolution Met (Customer Care) | 82 |
| Resolution Met (Development) | 12 |
| Resolution Met (Production) | 7 |
| Resolution Met (Tier 2) | 5 |
| Resolution Met (Tier 3) | 1 |
| Resolution Breached (All) | 11 |
| Resolution Breached (Customer Care) | 6 |
| Resolution Breached (Development) | 1 |
| Resolution Breached (Production) | 0 |
| Resolution Breached (Tier 2) | 4 |
| Resolution Breached (Tier 3) | 0 |

**Other missing (1 KPI):**

| Missing KPI | Last n8n Value |
|-------------|----------------|
| Escalation Accuracy % (All Time) | 97% |

### 3d. NOVA-only KPIs (NOT from n8n — NOVA additions)

| NOVA KPI | Today's Value | Notes |
|----------|---------------|-------|
| Open Tickets | 557 | Total open across all tiers |
| Unassigned | 173 | Tickets with no assignee |
| Waiting on Requestor | 54 | Status-based count |
| SLA Breached | 103 | Total SLA breaches |
| WTD percentage KPI's Green | 49% | Week-to-date RAG calculation |
| WTD percentage KPI's Red | 44% | Week-to-date RAG calculation |
| AI Resolution Rate % | 0 | AI agent not active |
| AI Tickets Pending Approval | 0 | AI agent not active |
| AI Tickets Resolved (Today) | 0 | AI agent not active |

---

## Part 4: Suspect Data Points

### 4a. FRT Compliance % (Open Queue) = 100%

NOVA reports 100% FRT compliance on open queue for 3 consecutive days (May 18-20). The n8n snapshot from May 15 showed 62%. This seems wrong — 100% compliance with 557 open tickets is unlikely.

**Probable cause:** NOVA's FRT compliance calculation may be counting tickets differently. Need to check how `collectJiraSnapshot()` calculates FRT compliance vs how n8n does it. n8n uses resolved-today tickets; NOVA may be using the open queue (different population).

### 4b. CSAT % = 0%

NOVA daily shows CSAT = 0% for all 3 days. The KpiSnapshot (n8n, May 15) shows CSAT = 100%. NOVA is not calculating CSAT — it's emitting a default 0.

**Root cause:** CSAT requires integration with Jira satisfaction surveys. NOVA's pipeline likely has no CSAT calculation — it's a stub.

### 4c. Escalation/Rejection counts always 0

All escalation and rejection KPIs in NOVA daily show 0 for all 3 days. The snapshot (May 15) shows Tier 2 escalations = 8, Tier 3 = 4, Tier 2 rejections = 1. NOVA calculates these from `jira_issue_cache` tier change history — but the daily pipeline may be resetting these to 0 each snapshot cycle instead of accumulating.

**Needs investigation:** Check whether escalation/rejection counts are being properly calculated from tier change logs, or if the per-snapshot reset logic is zeroing them out.

### 4d. FRT Breached per tier = 0 (all tiers, all days)

All per-tier FRT breached KPIs show 0 in NOVA daily for May 18-20. The snapshot from May 15 shows significant breaches (CC TPJ = 11, CC SR = 11, Dev = 46). These should NOT be 0.

**Probable cause:** NOVA's FRT breach calculation operates on the current open queue. If FRT breach status is being checked against current SLA clock state rather than historical breach events, breached tickets that have since been replied to would disappear.

n8n calculates these from resolved-today tickets and checks whether FRT was met at time of first response. NOVA may be using a fundamentally different methodology.

---

## Part 5: Agent-Level KPI Gap

n8n v4's agent pipeline (nodes `agt-01` through `agt-09`) produces per-agent daily KPIs by merging:

1. Agent roster from `dbo.Agent` table
2. Per-agent open ticket counts (from Jira "Get All Open")
3. Per-agent solved-today counts (from Jira "Get Solved Today")
4. QA scores for today (from SQL)
5. Golden Rules compliance (from SQL)
6. Per-agent CSAT (from Jira satisfaction surveys)
7. Per-agent escalation accuracy (from HTTP endpoint)

Output: ~30 metrics per agent, written to `jira_agent_kpi_daily`.

**NOVA has NO equivalent.** The `collectJiraSnapshot()` function only produces team-level aggregates. There is no per-agent KPI pipeline in NOVA.

---

## Part 6: n8n v4 Features NOVA Doesn't Have

| Feature | n8n v4 Node | NOVA Status |
|---------|-------------|-------------|
| Agent-level KPIs | `agt-01` through `agt-09` | NOT IMPLEMENTED |
| KPI comparison (old vs new) | Compare Old vs New | NOT IMPLEMENTED |
| AI-generated KPI digest | AI KPI Summary -> SQL - Insert Digest | NOVA has separate digest |
| KPI email report | Build KPI Email -> Send KPI Email | NOT IMPLEMENTED |
| Agent KPI email | Build Agent KPI Email -> Send | NOT IMPLEMENTED |
| No-reply evidence email | Build Evidence Email -> Send | NOT IMPLEMENTED |
| EOD ticket status snapshot | Aggregate EOD Counts | NOVA has `captureEodSnapshot()` |
| Derived KPIs (FCR, 1LR, Bug Ack) | Calculate All Derived KPIs (enabled) | `collectDerivedKpis()` exists but NEVER works |
| Catch-up trigger | Trigger - Catch-up | NOT IMPLEMENTED |
| AI approval stats | Fetch AI Approval Stats | NOVA calculates internally |

---

## Part 7: Prioritised Fix List

### P0 — Deploy Immediately (data is wrong RIGHT NOW)

1. **Bug 1: Ghost tier emission** — line 496 fix. Removes 14 phantom KPIs. 1 line change.
2. **Bug 2: TPJ parens** — line 168 fix. Renames 5 KPIs to match n8n. 1 line change.
3. **Bug 3: Fix 5 revert** — if not already deployed. Verify Tickets Solved Today > 0 after morning resolutions.
4. **Data cleanup SQL** — run the DELETE statements from `KPI-HOTFIX-REMAINING.md` after deploying 1-3.

### P1 — Investigate This Week (numbers may be wrong)

5. **Development count 275 vs 230** — determine if NOVA should filter by issue type. Check n8n's JQL for the "Get All Open" node. If n8n filters to `issuetype = Support`, NOVA must match.
6. **FRT Compliance 100% suspect** — verify calculation methodology against n8n. NOVA may be computing compliance on a different ticket population.
7. **CSAT always 0** — determine if NOVA has a CSAT data source or if this is a stub.
8. **Escalation/rejection counts always 0** — verify the tier-change-based calculation is working.
9. **FRT Breached per tier always 0** — verify methodology matches n8n (resolved-today vs open-queue).

### P2 — Build This Sprint (missing KPIs)

10. **Add 10 per-tier SLA Compliance % KPIs** — FRT Compliance % and Resolution Compliance % broken out by tier (CC, Dev, Prod, T2, T3). Data is available in the pipeline, just not being emitted.
11. **Add 24 per-tier FRT/Resolution Met/Breached count KPIs** — these are resolved-today metrics. Need the same methodology n8n uses.
12. **Add Escalation Accuracy % (All Time)** — simple variant of existing Escalation Accuracy %.

### P3 — Build Next Sprint (feature gaps)

13. **Agent-level KPI pipeline** — per-agent open/solved/QA/golden-rules/CSAT/escalation metrics. Requires significant new code.
14. **Derived KPIs investigation** — get `collectDerivedKpis()` working or determine it's not needed if n8n v4 derived KPIs are also broken.
15. **KPI comparison/digest emails** — lower priority if NOVA UI covers the use case.

---

## Part 8: UI Screen Audit (2026-05-20 08:50 UTC)

### 8a. KPI Dashboard (`nova.nurtur.tech/#kpi-dashboard`)

Sections audited: VOLUME, AI, LEGACY, HYGIENE, SLA_ACTIONABLE, SLA_BACKLOG, ESCALATIONS, REJECTIONS, AGE, TIER SLA, QUALITY, ESCALATION, SLA, TIER VOLUME, TIER NO REPLY.

**Issues confirmed in UI:**

| Issue | Location | Detail |
|-------|----------|--------|
| Ghost KPIs visible | LEGACY section | "Number of Tickets in Customer Care" = 72 shown prominently |
| Ghost KPIs visible | TIER VOLUME | "Number of Tickets in Unclassified" = 10 |
| Ghost KPIs visible | TIER NO REPLY | "No Reply in Customer Care" = 29, "No Reply in Unclassified" = 10 |
| Ghost KPIs visible | TIER SLA | Customer Care FRT/SLA, Unclassified FRT/SLA all showing |
| Bug 2 naming | SLA_ACTIONABLE | "CC (TPJ) over SLA" — parens not stripped |
| Bug 2 naming | TIER SLA | "CC (TPJ) FRT breached" — parens not stripped |
| Development = 275 | VOLUME | Target 125, shown as Red |
| CSAT = 0% | QUALITY | Target 80, shown as Red — no data source |
| FRT Compliance 100% | SLA | Both Open Queue and Resolved Today show 100% — suspect |
| All escalations = 0 | ESCALATIONS | T2, T3, Dev all 0 — suspect |
| All FRT breached = 0 | TIER SLA | Every tier shows 0 FRT breached — contradicts n8n data |
| Solved Today = 0 | VOLUME | May be early morning or Fix 5 revert issue |
| 88 metrics counted | Header | Should be ~74 after ghost removal |

### 8b. Trends (`nova.nurtur.tech/#trends`)

The Checkpoint Evidence Panel shows 90-day performance framework with Day 0/1/15/30, WTD, MTD columns.

**Issues found:**

| Metric | WTD | MTD | Issue |
|--------|-----|-----|-------|
| FRT Compliance % | — | 69.3 | WTD blank, but KPI dashboard shows 100%. MTD (69.3) more realistic |
| CSAT % | 0.0 | 0.0 | Was 100.0 last month — broken since NOVA took over |
| FCR Rate % | — | — | No current data — derived KPIs never worked |
| 1st Line Resolution Rate % | — | — | No current data — derived KPIs never worked |
| Bug Ack Time (hours) | — | — | Never had data |
| Total Queue Size | 477 | 477 | KPI dashboard shows Open Tickets = 557 (80 ticket gap) |
| KAM Satisfaction | — | — | No data source connected |
| CSM Satisfaction | — | — | No data source connected |

**Key concern:** Trends page pulls from `KpiSnapshot` (n8n-written), KPI dashboard pulls from `jira_kpi_daily` (NOVA-written). This creates data source divergence — FRT Compliance shows 100% on dashboard but 69.3% MTD on Trends.

### 8c. Wallboards

**SLA Breach Board (`nova.nurtur.tech/#wb-breached`):**
- TICKETS OVER SLA = 0, but KPI dashboard shows SLA Breached = 103
- WORST OLDEST = 76 days, but KPI shows Development oldest = 197 days
- All agents show OVER SLA = 0 and SOLVED TODAY = 0
- **Root cause:** Wallboard queries live cache differently from KPI pipeline — likely using different SLA/actionable definitions

**KPI Breach Board (`nova.nurtur.tech/#wb-team-kpis`):**
- TOTAL KPIS = 88 (includes 14 ghosts)
- KPIS RED = 36 (inflated by ~6 ghost KPIs showing as RED)
- Ghost KPIs visible: Customer Care (72), Unclassified (10), CC over SLA (1) all as RED breaches
- Development = 275 confirmed

**Customer Care (`nova.nurtur.tech/#wb-cc`):**
- Data consistent with KPI dashboard — CC Incidents 30, CC SR 40, TPJ 22
- SLA numbers match: CC Incidents Over SLA = 3, TPJ Over SLA = 2
- No issues beyond the known ones

**Technical Support (`nova.nurtur.tech/#wb-tech-support`):**
- **Development — Active Tickets = 292** — yet ANOTHER different number (KPI says 275, JSM says 230)
- Production 28, Tier 2 65 — match KPI dashboard
- Development Over SLA = 15 (KPI says 14 — minor timing difference)
- Development No Reply = 160 (KPI says 157 — timing)

**Key Accounts (`nova.nurtur.tech/#wb-key-accounts`):**
- **"Data is 746m old — cache may be stale"** — 12+ hours stale
- Numbers are filtered to Key Account customers only

**Customer Success (`nova.nurtur.tech/#wb-customer-success`):**
- **"Data is 747m old — cache may be stale"** — 12+ hours stale
- Numbers filtered to CS cohort (excludes Key Accounts)

### 8d. Development Count Summary — 4 Different Numbers

| Source | Dev Count | Probable Filter |
|--------|----------|-----------------|
| JSM Queue "All Development" | ~230 | `issuetype = Support`, tier = Development |
| n8n KpiSnapshot (May 15) | 213 | n8n JQL (unknown issue type filter) |
| NOVA KPI Dashboard (`jira_kpi_daily`) | 275 | `status_category != Done`, tier = Development, all issue types |
| Tech Support Wallboard (live cache) | 292 | direct cache query, may include more statuses |

---

## Appendix A: Complete KPI Inventory (88 NOVA Daily KPIs)

### Legitimate (74)

**Volume (9):**  
Number of Tickets in CC (Incidents), CC (Service Requests), CC (TPJ), Development, Production, Tier 2, Tier 3, New Tickets Today, Tickets Solved Today

**No Reply (7):**  
Number of Tickets With No Reply in CC (Incidents), CC (Service Requests), CC (TPJ), Development, Production, Tier 2, Tier 3

**SLA Actionable (7):**  
CC Incidents/CC Service Requests/CC (TPJ)/Development/Production/Tier 2/Tier 3 over SLA (actionable)

**SLA Not Actionable (7):**  
Same 7 tiers over SLA (not actionable)

**FRT Breached Actionable (7):**  
CC Incidents/CC Service Requests/CC (TPJ)/Development/Production/Tier 2/Tier 3 FRT breached (actionable)

**FRT Breached Not Actionable (7):**  
Same 7 tiers FRT breached (not actionable)

**Oldest Actionable (7):**  
Oldest actionable ticket (days) in CC (TPJ)/CC Incidents/CC Service Requests/Development/Production/Tier 2/Tier 3

**SLA Summary (5):**  
SLA Breached, FRT Breaches (Resolved Today), Resolution Breaches (Resolved Today), FRT Compliance % (Open Queue), FRT Compliance % (Resolved Today)

**Resolution Compliance (2):**  
Resolution Compliance % (Open Queue), Resolution Compliance % (Resolved Today)

**Escalations (4):**  
Escalation Accuracy %, Tickets escalated to Development/Tier 2/Tier 3

**Rejections (3):**  
Tickets rejected by Development/Tier 2/Tier 3

**Other (3):**  
Open Tickets, Unassigned, Waiting on Requestor

**CSAT (1):**  
CSAT %

**AI (3):**  
AI Resolution Rate %, AI Tickets Pending Approval, AI Tickets Resolved (Today)

**WTD (2):**  
WTD percentage KPI's Green, WTD percentage KPI's Red

### Ghost (14) — to be removed by Bug 1 fix

Customer Care: Volume, Oldest, No Reply, FRT breached (act/not-act), SLA (act/not-act) = 7  
Unclassified: Volume, Oldest, No Reply, FRT breached (act/not-act), SLA (act/not-act) = 7

---

## Appendix B: n8n v4 Workflow Structure

**Triggers:** Snapshot (schedule), Daily (schedule), Manual, EOD Core (schedule), Catch-up (schedule)

**Jira Queries:** Get Opened Today, Get Solved Today, Get All Open, Get All Issues - EOD, Get Solved for FCR, Fetch FCR Issue Details, Jira - Get CSAT Today

**SQL Tables Written:** `KpiSnapshot` (upsert), `jira_kpi_daily` (insert), `jira_kpi_digest` (insert), `JiraEodTicketStatusSnapshot` (insert), `jira_agent_kpi_daily` (upsert), `Agent` (update open/solved counts)

**Disabled Nodes:** Calculate FCR Per Ticket, Aggregate FCR %, SQL - Insert FCR Daily, Calculate 1st Line Rate, SQL - Insert 1st Line Rate, Calculate Bug Ack Time, SQL - Insert Bug Ack Time, Calculate CSAT %, SQL - Insert CSAT Daily

**Enabled Derived:** Calculate All Derived KPIs -> SQL - Insert Derived KPIs (consolidated replacement for disabled individual nodes)

**Workflow Status:** INACTIVE (not running)
