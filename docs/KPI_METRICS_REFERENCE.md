# Daily KPI Report v3.1 -- Complete Metrics Reference

Generated from the full n8n workflow source (77 nodes). Every KPI metric that is computed, its exact formula, data source, filters, storage destination, and measurement type are documented below.

---

## Table of Contents

1. [Workflow Architecture](#workflow-architecture)
2. [Run Modes & Schedules](#run-modes--schedules)
3. [Jira Data Sources (JQL Queries)](#jira-data-sources-jql-queries)
4. [SQL Data Sources](#sql-data-sources)
5. [Core KPIs -- Parse Opened Today](#core-kpis----parse-opened-today)
6. [Core KPIs -- Parse Solved Today](#core-kpis----parse-solved-today)
7. [Core KPIs -- Parse All Open](#core-kpis----parse-all-open)
8. [SQL Baseline KPIs -- SQL - Baseline Counts](#sql-baseline-kpis----sql---baseline-counts)
9. [Derived KPIs -- Calculate All Derived KPIs](#derived-kpis----calculate-all-derived-kpis)
10. [Agent KPIs -- Parse Agent Open Stats](#agent-kpis----parse-agent-open-stats)
11. [Agent KPIs -- Parse Agent Solved Today](#agent-kpis----parse-agent-solved-today)
12. [Agent KPIs -- Build Agent KPI Objects](#agent-kpis----build-agent-kpi-objects)
13. [Agent KPIs -- Parse CSAT Per Agent](#agent-kpis----parse-csat-per-agent)
14. [EOD Ticket Status Snapshot](#eod-ticket-status-snapshot)
15. [Legacy Derived KPI Nodes (Disabled)](#legacy-derived-kpi-nodes-disabled)
16. [Storage Tables](#storage-tables)
17. [KPI Name Normalisation](#kpi-name-normalisation)
18. [RAG Calculation Logic](#rag-calculation-logic)
19. [Complete KPI Index](#complete-kpi-index)

---

## Workflow Architecture

The workflow has three trigger paths that all converge into a shared pipeline:

```
Trigger - Snapshot  (*/3 8-18 * * 1-5)  --> Config - Snapshot (runMode=snapshot)
Trigger - Daily     (0 30 17 * * 1-5)   --> Config - Daily    (runMode=daily)
Trigger - Manual    (manual)             --> Config - Manual   (runMode=daily)
```

**Snapshot mode** (`runMode=snapshot`): Upserts into `KpiSnapshot` only. Runs every 3 minutes during business hours.

**Daily mode** (`runMode=daily`): Writes to `jira_kpi_daily` history, generates comparison report, AI summary, and sends email. Runs once at 17:30 on weekdays.

Both modes compute the same KPIs. The `If - RunMode Gate` node routes:
- **True branch** (snapshot): `Prepare Snapshot Rows` --> `SQL - Upsert KPI Snapshot`
- **False branch** (daily): `SQL - Insert Daily History` + comparison + email pipeline

---

## Run Modes & Schedules

| Trigger | Cron | runMode | Description |
|---------|------|---------|-------------|
| Trigger - Snapshot | `*/3 8-18 * * 1-5` | `snapshot` | Every 3 min, 08:00-18:59, Mon-Fri |
| Trigger - Daily | `0 30 17 * * 1-5` | `daily` | 17:30 daily, Mon-Fri |
| Trigger - Manual | manual | `daily` | On-demand |

---

## Jira Data Sources (JQL Queries)

### Get Opened Today
- **JQL**: `project = NT AND created >= startOfDay()`
- **Returns**: All issues created today in project NT
- **Used by**: Parse Opened Today

### Get Solved Today
- **JQL**: `project = NT and status CHANGED TO (Resolved, Closed) AFTER startOfDay()`
- **Returns**: All issues whose status transitioned to Resolved or Closed today in project NT
- **Used by**: Parse Solved Today, Parse Agent Solved Today, Build Agent KPI Objects (SLA per agent)

### Get All Open
- **JQL**: `project = NT AND statusCategory != Done ORDER BY updated DESC`
- **Returns**: All open issues (not Done) in project NT
- **Used by**: Parse All Open, Parse Agent Open Stats, Extract No-Reply Evidence

### Get All Issues - EOD
- **JQL**: `statusCategory != Done ORDER BY updated DESC`
- **Returns**: All open issues across ALL projects (not just NT)
- **Used by**: Aggregate EOD Counts (end-of-day snapshot)

### Get Solved for FCR
- **JQL**: `project = NT AND resolutiondate >= startOfDay() ORDER BY resolutiondate ASC`
- **Returns**: All issues resolved today in project NT (includes full comment history for FCR analysis)
- **Used by**: Calculate All Derived KPIs

### Jira - Get CSAT Today
- **JQL**: `project = NT AND resolutiondate >= startOfDay()`
- **Returns**: All issues resolved today for CSAT extraction
- **Used by**: Parse CSAT Per Agent

---

## SQL Data Sources

### SQL - Load KPI Targets
```sql
SELECT KpiName AS KPI, KpiGroup AS KPIGroup,
       TargetValue AS KPITarget, Direction AS KPIDirection
FROM dbo.KpiTargets
```
- **Source table**: `dbo.KpiTargets`
- **Purpose**: Loads target values and direction (Higher/Lower/Equal) for RAG calculations

### SQL - Load Agents
```sql
SELECT AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team,
       IsActive, IsAvailable, AccountId,
       OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
       SolvedTickets_Today, SolvedTickets_ThisWeek
FROM dbo.Agent WHERE IsActive = 1
```
- **Source table**: `dbo.Agent`
- **Purpose**: Active agent roster for agent-level KPIs

### SQL - Load QA Scores Today
```sql
SELECT assigneeName, COUNT(*) AS qaTicketsScored,
       AVG(CAST(overallScore AS FLOAT)) AS avgOverallScore,
       AVG(CAST(accuracyScore AS FLOAT)) AS avgAccuracyScore,
       AVG(CAST(clarityScore AS FLOAT)) AS avgClarityScore,
       AVG(CAST(toneScore AS FLOAT)) AS avgToneScore,
       SUM(CASE WHEN grade = 'RED' THEN 1 ELSE 0 END) AS redCount,
       SUM(CASE WHEN grade = 'AMBER' THEN 1 ELSE 0 END) AS amberCount,
       SUM(CASE WHEN grade = 'GREEN' THEN 1 ELSE 0 END) AS greenCount,
       SUM(CAST(isConcerning AS INT)) AS concerningCount
FROM dbo.jira_qa_results
WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
GROUP BY assigneeName
```
- **Source table**: `dbo.jira_qa_results`

### SQL - Load Golden Rules Today
```sql
SELECT Assignee, COUNT(*) AS goldenRulesScored,
       AVG(CAST(OverallScore AS FLOAT)) AS avgGoldenRulesScore,
       AVG(CAST(Rule1Score AS FLOAT)) AS avgOwnershipScore,
       AVG(CAST(Rule2Score AS FLOAT)) AS avgNextActionScore,
       AVG(CAST(Rule3Score AS FLOAT)) AS avgTimeframeScore
FROM dbo.Jira_QA_GoldenRules
WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
GROUP BY Assignee
```
- **Source table**: `dbo.Jira_QA_GoldenRules`

---

## Core KPIs -- Parse Opened Today

**Node**: `Parse Opened Today`
**Input**: `Get Opened Today` (all issues created today in project NT)

| KPI Name | Formula | Type |
|----------|---------|------|
| `New Tickets Today` | `$input.all().length` (count of all items returned) | Point-in-time, daily count |

**Filters/Exclusions**: None. Counts every issue returned by the JQL regardless of type, tier, or status.

**Written to**: `dbo.KpiSnapshot` (snapshot mode) or `dbo.jira_kpi_daily` (daily mode)

---

## Core KPIs -- Parse Solved Today

**Node**: `Parse Solved Today`
**Input**: `Get Solved Today` (issues with status changed to Resolved/Closed today)

### Jira Custom Fields Used
| Field ID | Name | Purpose |
|----------|------|---------|
| `customfield_14046` | FRT SLA | First Response Time SLA data |
| `customfield_14048` | Resolution SLA | Resolution time SLA data |
| `customfield_12802` | CSAT / Satisfaction Rating | Customer satisfaction survey (1-5 stars) |

### SLA Breach Detection Logic
The `isSlaBreached(slaField)` function checks:
1. `completedCycles[].breached === true` or `completedCycles[].remainingTime.millis < 0`
2. `ongoingCycle.breached === true` or `ongoingCycle.remainingTime.millis < 0`

Returns `true` if breached, `false` if not breached, `null` if no SLA data present.

### KPIs Produced

| KPI Name | Formula | Type |
|----------|---------|------|
| `Tickets Solved Today` | `issues.length` (total count of resolved/closed issues) | Daily count |
| `FRT Compliance % (Resolved Today)` | `ROUND((frtMet / (frtMet + frtBreached)) * 100)` -- only issues with FRT SLA data | Daily % |
| `Resolution Compliance % (Resolved Today)` | `ROUND((resMet / (resMet + resBreached)) * 100)` -- only issues with Resolution SLA data | Daily % |
| `FRT Breaches (Resolved Today)` | Count of issues where FRT SLA was breached | Daily count |
| `Resolution Breaches (Resolved Today)` | Count of issues where Resolution SLA was breached | Daily count |
| `CSAT %` | `ROUND((csatTotal / csatCount / 5) * 100)` -- average rating as % of 5-star max. Only emitted if `csatCount > 0`. | Daily %, conditional |

**Filters/Exclusions**: None on the solved set. Issues without SLA data are counted as "noData" and excluded from compliance percentages. CSAT only includes issues with a valid `customfield_12802.rating` between 1-5.

**Written to**: `dbo.KpiSnapshot` or `dbo.jira_kpi_daily`

---

## Core KPIs -- Parse All Open

**Node**: `Parse All Open`
**Input**: `Get All Open` (all non-Done issues in project NT)

### Jira Custom Fields Used
| Field ID | Name | Purpose |
|----------|------|---------|
| `customfield_12981` | Current Tier | Determines routing bucket (Customer Care, Production, Tier 2, Tier 3, Development) |
| `customfield_13482` | Request Type (primary) | Classifies ticket type |
| `customfield_12800` | Request Type (fallback container) | `requestType.name` used if primary field empty |
| `customfield_14081` | Agent Last Updated | Timestamp of last agent update |
| `customfield_14185` | Agent Next Update | Timestamp when next update is due |
| `customfield_14048` | Resolution SLA | Resolution SLA data for breach detection |
| `customfield_14046` | FRT SLA | First Response Time SLA data |

### Tier Classification
| Tier Value (case-insensitive) | Mapped To |
|-------------------------------|-----------|
| `customer care` | `Customer Care` |
| `production` | `Production` |
| `tier 2` | `Tier 2` |
| `tier 3` | `Tier 3` |
| `development` | `Development` |

### Customer Care Sub-Buckets
| Request Type(s) | Bucket |
|-----------------|--------|
| Incident, Chat, AI Request, Emailed Request, GDPR | `CC (Incidents)` |
| Service Request | `CC (Service Requests)` |
| TPJ Request | `CC (TPJ)` |

### Global Exclusion
**All KPIs in this node exclude tickets where request type (case-insensitive) = `onboarding`.**

### No-Reply Detection Logic
A ticket is flagged as "no reply" when ALL of the following are true:
1. Status is NOT `waiting on requestor`
2. Ticket was created more than 4 hours ago
3. `agentNextUpdate` is either null or in the past
4. `agentLastUpdated` exists and is NOT null
5. `agentLastUpdated` is before the start of today (i.e., not updated today)
6. `agentLastUpdated` is within the last 52 weeks

### Actionable Status Logic
A ticket is "actionable" if its status is NOT in: `done`, `closed`, `resolved`, `waiting on requestor`, `waiting on partner`.

### SLA Bucket Logic
For SLA breach KPIs, tickets are split into:
- **`actionable`**: Status is in `open`, `reopened`, `work in progress`
- **`not actionable`**: Status is not in the excluded set AND not in the actionable set (e.g., `awaiting triage`, `on hold`, etc.)

### Due Date Filter (SLA KPIs only)
SLA KPIs only count tickets where `duedate` is either null or `<= end of today`. Future-dated tickets are excluded.

### KPIs Produced -- Volume (Ticket Counts)

| KPI Name | Formula | Filters |
|----------|---------|---------|
| `Number of Tickets in CC (Incidents)` | Count of open CC Incidents | Excludes onboarding |
| `Number of Tickets in CC (Service Requests)` | Count of open CC Service Requests | Excludes onboarding |
| `Number of Tickets in CC (TPJ)` | Count of open CC TPJ | Excludes onboarding |
| `Number of Tickets in Production` | Count of open Production-tier tickets | Excludes onboarding |
| `Number of Tickets in Tier 2` | Count of open Tier 2 tickets | Excludes onboarding |
| `Number of Tickets in Tier 3` | Count of open Tier 3 tickets | Excludes onboarding |
| `Number of Tickets in Development` | Count of open Development-tier tickets | Excludes onboarding |

### KPIs Produced -- No Reply

| KPI Name | Formula | Filters |
|----------|---------|---------|
| `Number of Tickets With No Reply in CC (Incidents)` | Count matching no-reply logic in CC Incidents | Excludes onboarding; no-reply rules |
| `Number of Tickets With No Reply in CC (Service Requests)` | Count matching no-reply logic in CC Service Requests | Excludes onboarding; no-reply rules |
| `Number of Tickets With No Reply in CC (TPJ)` | Count matching no-reply logic in CC TPJ | Excludes onboarding; no-reply rules |
| `Number of Tickets With No Reply in Production` | Count matching no-reply logic in Production | Excludes onboarding; no-reply rules |
| `Number of Tickets With No Reply in Tier 2` | Count matching no-reply logic in Tier 2 | Excludes onboarding; no-reply rules |
| `Number of Tickets With No Reply in Tier 3` | Count matching no-reply logic in Tier 3 | Excludes onboarding; no-reply rules |
| `Number of Tickets With No Reply in Development` | Ensured to exist (defaults 0 if no matches) | Excludes onboarding; no-reply rules |

### KPIs Produced -- Oldest Actionable Ticket (Days)

Formula: `Math.floor((now - oldestCreatedDate) / (1000 * 60 * 60 * 24))` for the oldest actionable ticket in each tier.

| KPI Name | Scope |
|----------|-------|
| `Oldest actionable ticket (days) in CC Incidents` | CC Incidents, actionable status only |
| `Oldest actionable ticket (days) in CC Service Requests` | CC Service Requests, actionable status only |
| `Oldest actionable ticket (days) in CC TPJ` | CC TPJ, actionable status only |
| `Oldest actionable ticket (days) in Production` | Production tier, actionable status only |
| `Oldest actionable ticket (days) in Tier 2` | Tier 2, actionable status only |
| `Oldest actionable ticket (days) in Tier 3` | Tier 3, actionable status only |
| `Oldest actionable ticket (days) in Development` | Development tier, actionable status only |

All default to 0 if no matching tickets exist. Excludes onboarding.

### KPIs Produced -- Resolution SLA Breached (Open Queue)

| KPI Name | Scope |
|----------|-------|
| `CC Incidents over SLA (actionable)` | CC Incidents, actionable status, due today or past, Resolution SLA breached |
| `CC Service Requests over SLA (actionable)` | CC Service Requests, actionable status |
| `CC TPJ over SLA (actionable)` | CC TPJ, actionable status |
| `Production over SLA (actionable)` | Production, actionable status |
| `Tier 2 over SLA (actionable)` | Tier 2, actionable status |
| `Tier 3 over SLA (actionable)` | Tier 3, actionable status |
| `Development over SLA (actionable)` | Development, actionable status |
| `CC Incidents over SLA (not actionable)` | CC Incidents, non-actionable status |
| `CC Service Requests over SLA (not actionable)` | CC Service Requests, non-actionable status |
| `CC TPJ over SLA (not actionable)` | CC TPJ, non-actionable status |
| `Production over SLA (not actionable)` | Production, non-actionable status |
| `Tier 2 over SLA (not actionable)` | Tier 2, non-actionable status |
| `Tier 3 over SLA (not actionable)` | Tier 3, non-actionable status |

All default to 0 if no matches. Excludes onboarding. Due date filter applies.

### KPIs Produced -- FRT SLA Breached (Open Queue)

| KPI Name | Scope |
|----------|-------|
| `CC Incidents FRT breached (actionable)` | CC Incidents, actionable status, FRT SLA breached |
| `CC Service Requests FRT breached (actionable)` | CC Service Requests, actionable status |
| `CC TPJ FRT breached (actionable)` | CC TPJ, actionable status |
| `Production FRT breached (actionable)` | Production, actionable status |
| `Tier 2 FRT breached (actionable)` | Tier 2, actionable status |
| `Tier 3 FRT breached (actionable)` | Tier 3, actionable status |
| `Development FRT breached (actionable)` | Development, actionable status |
| `CC Incidents FRT breached (not actionable)` | CC Incidents, non-actionable status |
| `CC Service Requests FRT breached (not actionable)` | CC Service Requests, non-actionable status |
| `CC TPJ FRT breached (not actionable)` | CC TPJ, non-actionable status |
| `Production FRT breached (not actionable)` | Production, non-actionable status |
| `Tier 2 FRT breached (not actionable)` | Tier 2, non-actionable status |
| `Tier 3 FRT breached (not actionable)` | Tier 3, non-actionable status |

All default to 0. Excludes onboarding. No due date filter on FRT KPIs.

### KPIs Produced -- Overall SLA Compliance (Open Queue)

| KPI Name | Formula |
|----------|---------|
| `FRT Compliance % (Open Queue)` | `ROUND(((frtTotal - frtBreached) / frtTotal) * 100)` across all open issues with FRT SLA data |
| `Resolution Compliance % (Open Queue)` | `ROUND(((resTotal - resBreached) / resTotal) * 100)` across all open issues with Resolution SLA data |

These are computed across the entire open queue (all tiers, all statuses), excluding onboarding. Issues without SLA data are excluded from totals.

**Written to**: `dbo.KpiSnapshot` or `dbo.jira_kpi_daily`

---

## SQL Baseline KPIs -- SQL - Baseline Counts

**Node**: `SQL - Baseline Counts`
**Source table**: `dbo.JiraTickets` (synced separately from the n8n workflow)

These KPIs are computed via a single SQL query with UNION ALL. Each includes inline RAG calculation.

### Escalation KPIs

| KPI Name | Formula | Target | Direction |
|----------|---------|--------|-----------|
| `Tickets escalated to Tier 2` | `COUNT(*) FROM JiraTickets WHERE CAST(Tier2EscalationAt AS date) = CAST(GETDATE() AS date)` | 10 | Lower |
| `Tickets escalated to Tier 3` | `COUNT(*) FROM JiraTickets WHERE CAST(Tier3EscalationAt AS date) = CAST(GETDATE() AS date)` | 2 | Lower |
| `Tickets escalated to Development` | `COUNT(*) FROM JiraTickets WHERE CAST(DevEscalationAt AS date) = CAST(GETDATE() AS date)` | 1 | Lower |

### Rejection KPIs

| KPI Name | Formula | Target | Direction |
|----------|---------|--------|-----------|
| `Tickets rejected by Tier 2` | `COUNT(*) FROM JiraTickets WHERE CAST(Tier2RejectionAt AS date) = CAST(GETDATE() AS date)` | 2 | Lower |
| `Tickets rejected by Tier 3` | `COUNT(*) FROM JiraTickets WHERE CAST(Tier3RejectionAt AS date) = CAST(GETDATE() AS date)` | 1 | Lower |
| `Tickets rejected by Development` | `COUNT(*) FROM JiraTickets WHERE CAST(DevRejectionAt AS date) = CAST(GETDATE() AS date)` | 0 | Equal |

### Escalation Accuracy

| KPI Name | Formula | Target | Direction |
|----------|---------|--------|-----------|
| `Escalation Accuracy %` | `CASE WHEN esc.total > 0 THEN ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) ELSE 100 END` where `esc.total` = count of tickets with any escalation timestamp, `rej.total` = count of tickets with any rejection timestamp | 90 | Higher |

Note: Escalation Accuracy uses all-time counts (no date filter on the subqueries), not just today's. This counts distinct tickets that have ever been escalated vs. ever been rejected.

### RAG Logic (inline in SQL)
- **Lower**: Green if `count <= target`; Amber if `count <= target * 1.10`; Red otherwise
- **Higher**: Green if `count >= target`; Amber if `count >= target * 0.90`; Red otherwise
- **Equal**: Green if `count == target`; Amber if `|count - target| <= target * 0.10`; Red otherwise

**Written to**: `dbo.KpiSnapshot` or `dbo.jira_kpi_daily`

---

## Derived KPIs -- Calculate All Derived KPIs

**Node**: `Calculate All Derived KPIs`
**Input**: `Get Solved for FCR` (issues resolved today with full field data including comments)
**Status**: ACTIVE (replaces the legacy disabled individual calculation nodes)

This single node computes 4 derived KPIs from the same input data in a single pass.

### FCR Rate %

| Field | Value |
|-------|-------|
| **KPI Name** | `FCR Rate %` |
| **KPI Group** | `Customer Satisfaction` |
| **Formula** | `ROUND((fcrCount / totalWithAgentReply) * 100, 1)` |
| **Definition** | A ticket is FCR if: (1) an agent made a public comment, (2) no customer comment exists after that first agent comment. Tickets with no agent reply are excluded from both numerator and denominator. |
| **Agent comment detection** | `accountType === 'atlassian'`, `jsdPublic !== false`, display name does NOT contain `nurtur` |
| **Customer follow-up detection** | `accountType === 'customer'` and `comment.created > firstAgentCommentTime` |
| **Target** | 0 (no target set in workflow) |
| **Direction** | `higher is better` |
| **RAG** | Green >= 60%, Amber >= 40%, Red < 40% |
| **Type** | Daily %, grouped by resolution date |
| **Written to** | `dbo.jira_kpi_daily` |

### 1st Line Resolution Rate %

| Field | Value |
|-------|-------|
| **KPI Name** | `1st Line Resolution Rate %` |
| **KPI Group** | `Tiered Support` |
| **Formula** | `ROUND((ccResolved / totalResolved) * 100, 1)` |
| **Definition** | Percentage of all resolved tickets whose request type falls within the Customer Care bucket set |
| **CC Request Types** (case-insensitive) | `incident`, `chat`, `ai request`, `emailed request`, `gdpr`, `service request`, `tpj request` |
| **Request type source** | `customfield_13482` (primary), fallback to `customfield_12800.requestType.name` |
| **Target** | 0 (no target set) |
| **Direction** | `higher is better` |
| **RAG** | Green >= 60%, Amber >= 40%, Red < 40% |
| **Type** | Daily %, grouped by resolution date |
| **Written to** | `dbo.jira_kpi_daily` |

### Bug Escalation-to-Ack (hours)

| Field | Value |
|-------|-------|
| **KPI Name** | `Bug Escalation-to-Ack (hours)` |
| **KPI Group** | `Engineering Collaboration` |
| **Formula** | `ROUND(AVG((firstAgentCommentTime - issueCreatedTime) / 3600000), 1)` |
| **Definition** | Average hours from ticket creation to first public agent comment, for tickets classified as bug/development/defect |
| **Bug detection** | Issue type name (lowercase) is in `{bug, development, defect}` OR status name contains `development` |
| **Agent comment detection** | Same rules as FCR (atlassian account type, public, not nurtur) |
| **Exclusions** | Tickets with no agent comment are excluded. Negative hour values are excluded. |
| **Target** | 0 (no target set) |
| **Direction** | `lower is better` |
| **RAG** | Green <= 4h, Amber <= 8h, Red > 8h |
| **Type** | Daily average hours, grouped by resolution date |
| **Written to** | `dbo.jira_kpi_daily` |

### CSAT % (Derived)

| Field | Value |
|-------|-------|
| **KPI Name** | `CSAT %` |
| **KPI Group** | `Customer Satisfaction` |
| **Formula** | `ROUND((sumOfRatings / (countOfRatings * 5)) * 100, 1)` |
| **Definition** | Average CSAT rating as percentage of 5-star maximum, from resolved tickets |
| **CSAT field** | `customfield_12802.rating` (numeric 1-5) |
| **Exclusions** | Tickets without CSAT data or non-numeric ratings are excluded |
| **Target** | 0 (no target set) |
| **Direction** | `higher is better` |
| **RAG** | Green >= 80%, Amber >= 60%, Red < 60% |
| **Type** | Daily %, grouped by resolution date |
| **Written to** | `dbo.jira_kpi_daily` |

**Note**: The CSAT % from this node overlaps with the CSAT % computed in `Parse Solved Today`. Both write to `jira_kpi_daily` but the derived version writes with `createdAt = resolutionDate` while Parse Solved Today uses the current timestamp. The derived version also runs through a delete-then-insert pattern keyed on `kpi + createdAt date`.

---

## Agent KPIs -- Parse Agent Open Stats

**Node**: `Parse Agent Open Stats`
**Input**: `Get All Open` (all non-Done issues in project NT)
**Written to**: `dbo.Agent` table (via `SQL - Update Agent Open`)

Per-agent metrics computed from the open ticket queue:

| Metric | Column in dbo.Agent | Formula | Filters |
|--------|---------------------|---------|---------|
| Total Open | `OpenTickets_Total` | Count of open tickets assigned to agent | Tier must be CC, Production, Tier 2, or Tier 3. No Development. |
| Over SLA | `OpenTickets_Over2Hours` | Count of assigned tickets where Resolution SLA is breached AND status is not excluded AND due date is not in the future | Same tier filter |
| No Update Today | `OpenTickets_NoUpdateToday` | Count where: status != `waiting on requestor`, `agentLastUpdated` exists and is before today, `agentNextUpdate` is null or past, `agentLastUpdated` within 52 weeks | Same tier filter |
| Oldest Ticket Days | `OldestTicketDays` | `Math.floor((now - oldestCreatedDate) / ONE_DAY_MS)` | Same tier filter |
| Oldest Ticket Key | `OldestTicketKey` | Jira key of the oldest ticket | Same tier filter |

**Excluded statuses for SLA**: `done`, `closed`, `resolved`, `waiting on requestor`, `waiting on partner`

**Agent identification**: `fields.assignee.accountId`

---

## Agent KPIs -- Parse Agent Solved Today

**Node**: `Parse Agent Solved Today`
**Input**: `Get Solved Today` (issues resolved/closed today)
**Written to**: `dbo.Agent` table (via `SQL - Update Agent Solved`)

| Metric | Column in dbo.Agent | Formula |
|--------|---------------------|---------|
| Solved Today | `SolvedTickets_Today` | Count of tickets resolved today assigned to agent |
| Solved This Week | `SolvedTickets_ThisWeek` | On Monday: just today's count (weekly reset). Other days: existing `SolvedTickets_ThisWeek` from Agent table + today's count |

**Tier filter**: Same as Parse Agent Open Stats (CC, Production, Tier 2, Tier 3 only).

---

## Agent KPIs -- Parse CSAT Per Agent

**Node**: `Parse CSAT Per Agent`
**Input**: `Jira - Get CSAT Today` (issues resolved today)

Extracts CSAT ratings from `customfield_12802.rating` (1-5 scale) and groups by assignee.

| Metric | Formula |
|--------|---------|
| Per-agent CSAT average | `total / count` (raw 1-5 scale) |
| Per-agent CSAT % | `ROUND((total / (count * 5)) * 100, 2)` |
| Team CSAT % | Same formula across all agents |
| Total Responses | Count of tickets with valid CSAT ratings |
| Team Average Rating | `sumAllRatings / totalResponses` |

**Written to**: Passed downstream to `Build Agent KPI Objects`, not directly to SQL.

---

## Agent KPIs -- Build Agent KPI Objects

**Node**: `Build Agent KPI Objects`
**Input**: Merged data from SQL - Load Agents, SQL - Load QA Scores Today, SQL - Load Golden Rules Today, Parse CSAT Per Agent, Get Solved Today
**Written to**: `dbo.jira_agent_kpi_daily` (via `SQL - Upsert Agent Daily`)

This node merges all agent data sources into a single unified KPI object per agent.

### Per-Agent Metrics Written to jira_agent_kpi_daily

| Column | Source | Formula |
|--------|--------|---------|
| `OpenTickets_Total` | Agent table | Direct from `dbo.Agent` |
| `OpenTickets_Over2Hours` | Agent table | Direct from `dbo.Agent` |
| `OpenTickets_NoUpdateToday` | Agent table | Direct from `dbo.Agent` |
| `OldestTicketDays` | Agent table | Direct from `dbo.Agent` |
| `SolvedTickets_Today` | Agent table | `Number(a.SolvedTickets_Today) \|\| 0` |
| `SolvedTickets_ThisWeek` | Agent table | Direct from `dbo.Agent` |
| `AvailableHours` | Agent table | `7.5` if `IsAvailable`, else `0` |
| `TicketsPerHour` | Computed | `ROUND(solvedToday / 7.5, 2)` -- null if not available |
| `SLAResolvedCount` | Get Solved Today | Count of resolved tickets with SLA data for this agent |
| `SLABreachedCount` | Get Solved Today | Count where SLA was breached (same isSLABreached logic) |
| `SLACompliancePct` | Computed | `ROUND(((resolved - breached) / resolved) * 100, 2)` -- null if no resolved SLA tickets |
| `CSATCount` | Parse CSAT Per Agent | Count of CSAT responses for agent |
| `CSATAverage` | Parse CSAT Per Agent | Average CSAT rating (1-5) |
| `QATicketsScored` | jira_qa_results | Count of QA evaluations today |
| `QAOverallAvg` | jira_qa_results | `ROUND(avgOverallScore, 1)` |
| `QAAccuracyAvg` | jira_qa_results | `ROUND(avgAccuracyScore, 1)` |
| `QAClarityAvg` | jira_qa_results | `ROUND(avgClarityScore, 1)` |
| `QAToneAvg` | jira_qa_results | `ROUND(avgToneScore, 1)` |
| `QARedCount` | jira_qa_results | Count of RED grades today |
| `QAAmberCount` | jira_qa_results | Count of AMBER grades today |
| `QAGreenCount` | jira_qa_results | Count of GREEN grades today |
| `QAConcerningCount` | jira_qa_results | Count of concerning flags today |
| `GoldenRulesScored` | Jira_QA_GoldenRules | Count of golden rules evaluations today |
| `GoldenRulesAvg` | Jira_QA_GoldenRules | `ROUND(avgGoldenRulesScore, 1)` |
| `OwnershipAvg` | Jira_QA_GoldenRules | `ROUND(avgOwnershipScore, 1)` (Rule 1) |
| `NextActionAvg` | Jira_QA_GoldenRules | `ROUND(avgNextActionScore, 1)` (Rule 2) |
| `TimeframeAvg` | Jira_QA_GoldenRules | `ROUND(avgTimeframeScore, 1)` (Rule 3) |

### Agent RAG Thresholds

| Metric | RAG Field | Green | Amber | Red | Direction |
|--------|-----------|-------|-------|-----|-----------|
| Tickets/Hour | `ragProductivity` | >= 1.5 | >= 1.0 | < 1.0 | Higher is better |
| CSAT Average | `ragCSAT` | >= 4.0 | >= 3.0 | < 3.0 | Higher is better |
| QA Overall Avg | `ragQA` | >= 4.0 | >= 3.0 | < 3.0 | Higher is better |
| Golden Rules Avg | `ragGoldenRules` | >= 3.0 | >= 2.0 | < 2.0 | Higher is better |
| Over 2h (SLA breach count) | `ragOver2h` | <= 0 | <= 2 | > 2 | Lower is better |
| Stale (no update) | `ragStale` | <= 0 | <= 1 | > 1 | Lower is better |
| SLA Compliance % | `ragSLA` | >= 95% | >= 90% | < 90% | Higher is better |
| Oldest Ticket Days | `ragOldestTicket` | <= 3 | <= 7 | > 7 | Lower is better |

**QA/Golden Rules matching**: Matched by full name (`AgentName + ' ' + AgentSurname` from Agent table vs. `assigneeName` from QA results / `Assignee` from Golden Rules).

**SLA matching**: Matched by `AccountId` (Jira account ID) from solved issues.

---

## EOD Ticket Status Snapshot

**Node**: `Aggregate EOD Counts` + `SQL - Insert EOD Snapshot`
**Input**: `Get All Issues - EOD` (ALL open issues across all projects, not just NT)
**Written to**: `dbo.JiraEodTicketStatusSnapshot`

This is a structural snapshot, not a named KPI. It captures ticket counts grouped by:

| Column | Source |
|--------|--------|
| `SnapshotDate` | `CAST(GETDATE() AS date)` |
| `ProjectKey` | `fields.project.key` |
| `ProjectName` | `fields.project.name` |
| `CurrentTier` | For NT project: `customfield_12981.value`; for other projects: `project.name` |
| `RequestTypeId` | `customfield_12800.requestType.id` or `customfield_10010.requestType.id` |
| `RequestTypeName` | `customfield_12800.requestType.name` or `customfield_10010.requestType.name` |
| `StatusName` | `fields.status.name` |
| `StatusCategory` | `fields.status.statusCategory.name` |
| `TicketCount` | Aggregated count per unique group |

**Cleanup**: `SQL - Delete Today EOD` runs first to delete any existing rows for today before re-inserting. This is a daily-only operation.

---

## Legacy Derived KPI Nodes (Disabled)

The following individual calculation nodes exist but are **disabled** (`"disabled": true`). They have been replaced by the unified `Calculate All Derived KPIs` node:

| Node Name | KPI | Status |
|-----------|-----|--------|
| `Calculate FCR Per Ticket` | FCR analysis per ticket | Disabled |
| `Aggregate FCR %` | `FCR Rate %` | Disabled |
| `SQL - Insert FCR Daily` | Write FCR to jira_kpi_daily | Disabled |
| `Calculate 1st Line Rate` | `1st Line Resolution Rate %` | Disabled |
| `SQL - Insert 1st Line Rate` | Write 1st Line to jira_kpi_daily | Disabled |
| `Calculate Bug Ack Time` | `Bug Escalation-to-Ack (hours)` | Disabled |
| `SQL - Insert Bug Ack Time` | Write Bug Ack to jira_kpi_daily | Disabled |
| `Calculate CSAT %` | `CSAT %` | Disabled |
| `SQL - Insert CSAT Daily` | Write CSAT to jira_kpi_daily | Disabled |

These contain identical logic to the active combined node but were split into individual calculation chains. The combined node is the active version.

---

## Storage Tables

### dbo.KpiSnapshot (Snapshot mode)
- **Purpose**: Latest point-in-time values, overwritten every 3 minutes during business hours
- **Write pattern**: UPSERT (UPDATE then INSERT IF @@ROWCOUNT=0) keyed on `KPI` name
- **Columns**: `KPI`, `KPIGroup`, `Count`, `KPITarget`, `KPIDirection`, `RAG`, `CreatedAt`
- **Written by**: `SQL - Upsert KPI Snapshot`

### dbo.jira_kpi_daily (Daily history)
- **Purpose**: Historical daily KPI values, one row per KPI per day
- **Write pattern**: DELETE today's row for this KPI, then INSERT
- **Columns**: `kpi`, `kpiGroup`, `count`, `target`, `direction`, `rag`, `CreatedAt`
- **Written by**: `SQL - Insert Daily History` (core KPIs), `SQL - Insert Derived KPIs` (FCR, 1st Line, Bug Ack, CSAT)

### dbo.jira_agent_kpi_daily (Agent daily history)
- **Purpose**: Per-agent daily KPI values
- **Write pattern**: MERGE (upsert) keyed on `ReportDate + AgentId`
- **Columns**: See full list in Build Agent KPI Objects section
- **Written by**: `SQL - Upsert Agent Daily`

### dbo.Agent (Live agent stats)
- **Purpose**: Current agent ticket stats (overwritten each run)
- **Write pattern**: UPDATE keyed on `AccountId`
- **Columns updated**: `OpenTickets_Total`, `OpenTickets_Over2Hours`, `OpenTickets_NoUpdateToday`, `OldestTicketDays`, `OldestTicketKey`, `SolvedTickets_Today`, `SolvedTickets_ThisWeek`, `TicketsSnapshotAt`
- **Written by**: `SQL - Update Agent Open`, `SQL - Update Agent Solved`

### dbo.JiraEodTicketStatusSnapshot (EOD snapshot)
- **Purpose**: End-of-day ticket distribution across all projects
- **Write pattern**: DELETE today, then INSERT per group
- **Written by**: `SQL - Insert EOD Snapshot`

### dbo.jira_kpi_digest (AI summary)
- **Purpose**: GPT-4o generated KPI summary text
- **Write pattern**: DELETE today's row for this period, then INSERT
- **Columns**: `period`, `summary`, `html`, `CreatedAt`
- **Written by**: `SQL - Insert Digest`

### dbo.KpiTargets (Reference data, read-only by this workflow)
- **Purpose**: Target values and directions for RAG calculation
- **Columns read**: `KpiName`, `KpiGroup`, `TargetValue`, `Direction`

---

## KPI Name Normalisation

Two normalisation passes are applied to KPI names before storage and comparison:

### Pass 1: Build Unified KPI Objects (canonicalKpiName)
| Raw Name | Normalised To |
|----------|---------------|
| `Number of Tickets in CC (Incidents)` | `Number of Tickets in Customer Care (Incidents)` |
| `Number of Tickets in CC (Service Requests)` | `Number of Tickets in Customer Care (Service Requests)` |

### Pass 2: Enrich From Targets (canonicalKpiName)
| Transformation | Example |
|----------------|---------|
| `Customer Care (` --> `CC (` | `Number of Tickets in Customer Care (Incidents)` --> `Number of Tickets in CC (Incidents)` |
| `in Customer Care (` --> `in CC (` | Similar |
| `With No Reply in Customer Care (` --> `With No Reply in CC (` | Similar |
| `CC TPJ` --> `CC (TPJ)` | Adds parentheses |
| `Customer Care (TPJ)` --> `CC (TPJ)` | Abbreviates |
| `Tier 2 (non-Production)` --> `Tier 2` | Strips qualifier |

### Pass 3: Normalise KPI Names (for comparison email)
| Raw Name | Normalised To |
|----------|---------------|
| `Number of Tickets in CC (Incidents)` | `Number of Tickets in Customer Care (Incidents)` |
| `Number of Tickets in CC (Service Requests)` | `Number of Tickets in Customer Care (Service Requests)` |
| `Number of Tickets in CC (TPJ)` | `Number of Tickets in Customer Care (TPJ)` |
| `Number of Tickets in Tier 2` | `Number of Tickets in Tier 2 (non-Production)` |
| `Number of Tickets With No Reply in CC (Incidents)` | `Number of Tickets With No Reply in CC Incidents` |
| `Number of Tickets With No Reply in CC (Service Requests)` | `Number of Tickets With No Reply in CC Service Requests` |
| `Number of Tickets With No Reply in CC (TPJ)` | `Number of Tickets With No Reply in CC TPJ` |
| `Number of Tickets With No Reply in Tier 2` | `Number of Tickets With No Reply in Tier 2 (non-Production)` |
| `CC (TPJ) over SLA (actionable)` | `CC TPJ over SLA (actionable)` |
| `CC (TPJ) over SLA (not actionable)` | `CC TPJ over SLA (not actionable)` |
| `Tickets escalated to Tier 2` | `Tickets escalated to Tier 2 (non-Production)` |
| `Tickets rejected by Tier 2` | `Tickets rejected by Tier 2 (non-Production)` |
| `Oldest actionable ticket (days) in CC (Incidents)` | `Oldest actionable ticket (days) in CC Incidents` |
| `Oldest actionable ticket (days) in CC (TPJ)` | `Oldest actionable ticket (days) in CC TPJ` |

**Note**: There is tension between the normalisation passes. Pass 1 expands `CC` to `Customer Care`, Pass 2 contracts `Customer Care` back to `CC`. The net effect depends on which KPIs have entries in `dbo.KpiTargets`.

---

## RAG Calculation Logic

### Core KPIs (Enrich From Targets)

Targets come from `dbo.KpiTargets` first, then fallback pattern matching:

| Pattern | Target | Direction | Group |
|---------|--------|-----------|-------|
| `/frt compliance %/i` | 95 | Higher | SLA_Compliance |
| `/resolution compliance %/i` | 95 | Higher | SLA_Compliance |
| `/frt breaches/i` | 0 | Lower | SLA_Breaches |
| `/resolution breaches/i` | 0 | Lower | SLA_Breaches |
| `/escalation accuracy/i` | 90 | Higher | Escalations |
| `/fcr rate/i` | 85 | Higher | Quality |
| `/csat/i` | 90 | Higher | Quality |

### RAG Formula
- **Lower**: Green `<= target`, Amber `<= target * 1.10`, Red `> target * 1.10`
- **Higher**: Green `>= target`, Amber `>= target * 0.90`, Red `< target * 0.90`
- **Equal**: Green `== target`, Amber `|diff| <= target * 0.10`, Red otherwise

### Group Inference (when not from DB)
| KPI name pattern | Inferred Group |
|------------------|----------------|
| Contains `over sla` + `(actionable)` | `SLA_Actionable` |
| Contains `over sla` + `(not actionable)` | `SLA_Backlog` |
| Starts with `tickets escalated` or `tickets rejected` | `Escalations` |
| Starts with `oldest actionable ticket` | `Age` |

---

## Complete KPI Index

### Core KPIs (written to KpiSnapshot and/or jira_kpi_daily)

| # | KPI Name | Source Node | Type |
|---|----------|-------------|------|
| 1 | New Tickets Today | Parse Opened Today | Daily count |
| 2 | Tickets Solved Today | Parse Solved Today | Daily count |
| 3 | FRT Compliance % (Resolved Today) | Parse Solved Today | Daily % |
| 4 | Resolution Compliance % (Resolved Today) | Parse Solved Today | Daily % |
| 5 | FRT Breaches (Resolved Today) | Parse Solved Today | Daily count |
| 6 | Resolution Breaches (Resolved Today) | Parse Solved Today | Daily count |
| 7 | CSAT % | Parse Solved Today | Daily % (conditional) |
| 8 | Number of Tickets in CC (Incidents) | Parse All Open | Point-in-time |
| 9 | Number of Tickets in CC (Service Requests) | Parse All Open | Point-in-time |
| 10 | Number of Tickets in CC (TPJ) | Parse All Open | Point-in-time |
| 11 | Number of Tickets in Production | Parse All Open | Point-in-time |
| 12 | Number of Tickets in Tier 2 | Parse All Open | Point-in-time |
| 13 | Number of Tickets in Tier 3 | Parse All Open | Point-in-time |
| 14 | Number of Tickets in Development | Parse All Open | Point-in-time |
| 15 | Number of Tickets With No Reply in CC (Incidents) | Parse All Open | Point-in-time |
| 16 | Number of Tickets With No Reply in CC (Service Requests) | Parse All Open | Point-in-time |
| 17 | Number of Tickets With No Reply in CC (TPJ) | Parse All Open | Point-in-time |
| 18 | Number of Tickets With No Reply in Production | Parse All Open | Point-in-time |
| 19 | Number of Tickets With No Reply in Tier 2 | Parse All Open | Point-in-time |
| 20 | Number of Tickets With No Reply in Tier 3 | Parse All Open | Point-in-time |
| 21 | Number of Tickets With No Reply in Development | Parse All Open | Point-in-time (ensured) |
| 22 | Oldest actionable ticket (days) in CC Incidents | Parse All Open | Point-in-time |
| 23 | Oldest actionable ticket (days) in CC Service Requests | Parse All Open | Point-in-time |
| 24 | Oldest actionable ticket (days) in CC TPJ | Parse All Open | Point-in-time |
| 25 | Oldest actionable ticket (days) in Production | Parse All Open | Point-in-time |
| 26 | Oldest actionable ticket (days) in Tier 2 | Parse All Open | Point-in-time |
| 27 | Oldest actionable ticket (days) in Tier 3 | Parse All Open | Point-in-time |
| 28 | Oldest actionable ticket (days) in Development | Parse All Open | Point-in-time |
| 29 | CC Incidents over SLA (actionable) | Parse All Open | Point-in-time |
| 30 | CC Service Requests over SLA (actionable) | Parse All Open | Point-in-time |
| 31 | CC TPJ over SLA (actionable) | Parse All Open | Point-in-time |
| 32 | Production over SLA (actionable) | Parse All Open | Point-in-time |
| 33 | Tier 2 over SLA (actionable) | Parse All Open | Point-in-time |
| 34 | Tier 3 over SLA (actionable) | Parse All Open | Point-in-time |
| 35 | Development over SLA (actionable) | Parse All Open | Point-in-time |
| 36 | CC Incidents over SLA (not actionable) | Parse All Open | Point-in-time |
| 37 | CC Service Requests over SLA (not actionable) | Parse All Open | Point-in-time |
| 38 | CC TPJ over SLA (not actionable) | Parse All Open | Point-in-time |
| 39 | Production over SLA (not actionable) | Parse All Open | Point-in-time |
| 40 | Tier 2 over SLA (not actionable) | Parse All Open | Point-in-time |
| 41 | Tier 3 over SLA (not actionable) | Parse All Open | Point-in-time |
| 42 | CC Incidents FRT breached (actionable) | Parse All Open | Point-in-time |
| 43 | CC Service Requests FRT breached (actionable) | Parse All Open | Point-in-time |
| 44 | CC TPJ FRT breached (actionable) | Parse All Open | Point-in-time |
| 45 | Production FRT breached (actionable) | Parse All Open | Point-in-time |
| 46 | Tier 2 FRT breached (actionable) | Parse All Open | Point-in-time |
| 47 | Tier 3 FRT breached (actionable) | Parse All Open | Point-in-time |
| 48 | Development FRT breached (actionable) | Parse All Open | Point-in-time |
| 49 | CC Incidents FRT breached (not actionable) | Parse All Open | Point-in-time |
| 50 | CC Service Requests FRT breached (not actionable) | Parse All Open | Point-in-time |
| 51 | CC TPJ FRT breached (not actionable) | Parse All Open | Point-in-time |
| 52 | Production FRT breached (not actionable) | Parse All Open | Point-in-time |
| 53 | Tier 2 FRT breached (not actionable) | Parse All Open | Point-in-time |
| 54 | Tier 3 FRT breached (not actionable) | Parse All Open | Point-in-time |
| 55 | FRT Compliance % (Open Queue) | Parse All Open | Point-in-time |
| 56 | Resolution Compliance % (Open Queue) | Parse All Open | Point-in-time |
| 57 | Tickets escalated to Tier 2 | SQL - Baseline Counts | Daily count |
| 58 | Tickets escalated to Tier 3 | SQL - Baseline Counts | Daily count |
| 59 | Tickets escalated to Development | SQL - Baseline Counts | Daily count |
| 60 | Tickets rejected by Tier 2 | SQL - Baseline Counts | Daily count |
| 61 | Tickets rejected by Tier 3 | SQL - Baseline Counts | Daily count |
| 62 | Tickets rejected by Development | SQL - Baseline Counts | Daily count |
| 63 | Escalation Accuracy % | SQL - Baseline Counts | All-time % |

### Derived KPIs (written to jira_kpi_daily only, daily mode)

| # | KPI Name | Source Node | Type |
|---|----------|-------------|------|
| 64 | FCR Rate % | Calculate All Derived KPIs | Daily % |
| 65 | 1st Line Resolution Rate % | Calculate All Derived KPIs | Daily % |
| 66 | Bug Escalation-to-Ack (hours) | Calculate All Derived KPIs | Daily avg hours |
| 67 | CSAT % (derived) | Calculate All Derived KPIs | Daily % |

### Agent KPIs (written to jira_agent_kpi_daily, per agent per day)

| # | Metric | Source |
|---|--------|--------|
| 68 | OpenTickets_Total | Parse Agent Open Stats |
| 69 | OpenTickets_Over2Hours | Parse Agent Open Stats |
| 70 | OpenTickets_NoUpdateToday | Parse Agent Open Stats |
| 71 | OldestTicketDays | Parse Agent Open Stats |
| 72 | SolvedTickets_Today | Parse Agent Solved Today |
| 73 | SolvedTickets_ThisWeek | Parse Agent Solved Today |
| 74 | AvailableHours | Build Agent KPI Objects (7.5 if available) |
| 75 | TicketsPerHour | Build Agent KPI Objects (solved / 7.5) |
| 76 | SLAResolvedCount | Build Agent KPI Objects (from solved issues) |
| 77 | SLABreachedCount | Build Agent KPI Objects (from solved issues) |
| 78 | SLACompliancePct | Build Agent KPI Objects |
| 79 | CSATCount | Parse CSAT Per Agent |
| 80 | CSATAverage | Parse CSAT Per Agent |
| 81 | QATicketsScored | SQL - Load QA Scores Today |
| 82 | QAOverallAvg | SQL - Load QA Scores Today |
| 83 | QAAccuracyAvg | SQL - Load QA Scores Today |
| 84 | QAClarityAvg | SQL - Load QA Scores Today |
| 85 | QAToneAvg | SQL - Load QA Scores Today |
| 86 | QARedCount | SQL - Load QA Scores Today |
| 87 | QAAmberCount | SQL - Load QA Scores Today |
| 88 | QAGreenCount | SQL - Load QA Scores Today |
| 89 | QAConcerningCount | SQL - Load QA Scores Today |
| 90 | GoldenRulesScored | SQL - Load Golden Rules Today |
| 91 | GoldenRulesAvg | SQL - Load Golden Rules Today |
| 92 | OwnershipAvg | SQL - Load Golden Rules Today (Rule 1) |
| 93 | NextActionAvg | SQL - Load Golden Rules Today (Rule 2) |
| 94 | TimeframeAvg | SQL - Load Golden Rules Today (Rule 3) |

### EOD Structural Snapshot (written to JiraEodTicketStatusSnapshot)

| # | Dimension | Description |
|---|-----------|-------------|
| 95 | TicketCount per (ProjectKey, CurrentTier, StatusName, RequestType) | Grouped ticket counts across all projects |

---

**Total unique named KPIs**: 67 (core + derived)
**Total agent-level metrics**: 27 per agent per day
**Total structural snapshot dimensions**: 1 (ticket count by group)
