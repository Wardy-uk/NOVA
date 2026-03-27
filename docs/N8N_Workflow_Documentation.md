# n8n Workflow Documentation

*Business-facing descriptions of all active automation workflows*
*Last Updated: 25 March 2026*

---

## Daily Operations

### Daily KPI Report v3.1
**ID:** `pBrRdWYxtYFy4mGh` | **Status:** Active | **Nodes:** 74

**What it does:** Produces the complete daily support performance report. Every business day, it pulls ticket data from Jira, calculates all KPIs (SLA compliance, queue sizes, escalation rates, FCR, 1st Line resolution, CSAT, Bug acknowledgement time), compares against the previous day, generates an AI-written executive summary, and delivers everything via email.

**How it works:**
1. **Two triggers:** A snapshot run (periodic upsert of current metrics) and a daily run (full report + emails)
2. **Jira queries:** Fetches tickets opened today, solved today, and all open tickets across every tier
3. **SQL enrichment:** Loads KPI targets and baseline counts from the reporting database
4. **KPI calculation:** Builds unified KPI objects with RAG status (Red/Amber/Green) against targets
5. **Snapshot storage:** Upserts latest values to `KpiSnapshot` and `jira_kpi_daily` tables
6. **AI summary:** GPT-4.1 generates a natural language briefing comparing today vs yesterday
7. **Email delivery:** Sends KPI report, evidence report (no-reply tickets), and agent-level KPI breakdown
8. **Agent metrics:** Per-agent solved counts, QA scores, Golden Rules compliance, CSAT ratings
9. **EOD snapshot:** End-of-day ticket status counts by tier for trend analysis
10. **New metrics (Mar 2026):** FCR Rate %, 1st Line Resolution Rate %, Bug Escalation-to-Ack time, CSAT % — all calculated from resolved ticket comments and fields

**Emails sent:**
- Daily KPI Report (to Head of Support)
- Evidence Report — tickets with no reply
- Agent KPI Breakdown
- Error alerts (if workflow fails)

---

### Ticket QA — Full QA (Hourly)
**ID:** `kP4T3lzP4y5DyeJF` | **Status:** Active | **Nodes:** 14

**What it does:** Every hour during business hours, scores all newly resolved Jira tickets for quality using AI. Each ticket gets rated on accuracy, clarity, tone, and closure.

**How it works:**
1. **Schedule:** Runs hourly Mon-Fri 8am-6pm
2. **Jira search:** Finds tickets resolved in the last 70 minutes (with overlap to avoid gaps)
3. **Dedup check:** Skips tickets already scored (checks `jira_qa_results` table)
4. **Fetch full issue:** Gets ticket details and comments for non-duplicate tickets
5. **Chat filter:** Excludes "Chat" request type tickets
6. **AI scoring:** GPT-4.1 evaluates the agent's handling across 4 dimensions (accuracy 35%, clarity 25%, tone 20%, closure 20%)
7. **INSERT:** Stores scores, grade (GREEN/AMBER/RED), coaching points, and suggested improvements

**Target table:** `dbo.jira_qa_results`
**CreatedAt:** Uses the Jira resolution date (when the ticket was actually closed)

---

### Golden Rules QA (Hourly)
**ID:** `YSce8BZpdotBX7ed` | **Status:** Active | **Nodes:** 11

**What it does:** Every hour during business hours, evaluates all new public agent comments against three communication quality standards: Ownership, What's Happening, and Timeframes.

**How it works:**
1. **Schedule:** Runs hourly Mon-Fri 8am-6pm
2. **Jira search:** Finds tickets updated in the last 70 minutes
3. **Comment extraction:** Identifies new public comments from real agents (excludes bots, Nurtur AI, customer comments, private notes)
4. **Dedup + team check:** Skips already-scored comments and non-team-member comments
5. **AI scoring:** GPT-4.1 scores each comment 1-3 on each of three rules
6. **INSERT:** Stores per-comment scores, pass/fail per rule, suggested rewrite

**Target table:** `dbo.Jira_QA_GoldenRules`
**CreatedAt:** Uses the actual comment timestamp

---

### Daily 2pm Intervention Radar
**ID:** `Z74YOQEDeodKSdH9` | **Status:** Active | **Nodes:** 13

**What it does:** Sends a midday alert highlighting tickets that need immediate attention — approaching SLA breach, stale tickets, or customers waiting too long.

**Why:** Gives the team a chance to course-correct before end of day.

---

### Daily Ticket Analysis
**ID:** `YMibzYmkuZan7h9g` | **Status:** Active | **Nodes:** 8

**What it does:** Analyses daily ticket patterns and writes results to the database for trend analysis. Does not send emails.

---

### Daily Agent Selection
**ID:** `rJBiif9W35ypktKA` | **Status:** Active | **Nodes:** 4

**What it does:** Selects which support agents are on duty each day, used by the round-robin ticket assignment system.

---

## Weekly Reports

### Weekly KPI Digest
**ID:** `Mhh1IBtn67LkRkFP` | **Status:** Active | **Nodes:** 10

**What it does:** Compiles a weekly summary of all KPI trends and sends it via email. Provides week-over-week comparison.

---

### Weekly Ticket Analysis
**ID:** `lrOQdCGlIVi4Wlxh` | **Status:** Active | **Nodes:** 7

**What it does:** Analyses ticket patterns across the full week — volume trends, category breakdowns, peak times — and emails the summary.

---

### Weekly Ticket Replies Digest
**ID:** `XonfzPHQOeIRMJCE` | **Status:** Active | **Nodes:** 26

**What it does:** Reviews all ticket replies from the past week and sends digest emails highlighting notable responses, quality issues, and coaching opportunities.

---

### QA V5 Daily Digest
**ID:** `k0yAXrFDKlnGyYFX` | **Status:** Active | **Nodes:** 4

**What it does:** Sends a daily email summarising QA scores — how many tickets were scored, team average, any RED-graded tickets requiring attention.

---

### QA V5 Weekly Digest
**ID:** `fdSOfVHcQuLRqGwm` | **Status:** Active | **Nodes:** 4

**What it does:** Weekly roll-up of QA performance trends — score distribution, agent rankings, improvement areas.

---

## Ticket Automation

### Jira Issue Created
**ID:** `Msr2WiHsXSrre9UU` | **Status:** Active | **Nodes:** 37

**What it does:** Triggered when a new Jira ticket is created. Classifies the ticket, applies routing rules, and initiates the AI auto-response pipeline.

---

### AI Support — Jira Ticket Created
**ID:** `9ugMYSsZ3QoWEO3I` | **Status:** Active | **Nodes:** 31

**What it does:** When a new support ticket arrives, the AI analyses it, generates an internal summary note, and posts a public auto-response to the customer acknowledging receipt with relevant context.

---

### Jira Comment Added
**ID:** `8ivkO7cNkNoi5yWa` | **Status:** Active | **Nodes:** 35

**What it does:** Triggered when a comment is added to a Jira ticket. Analyses the comment, updates AI context, and may trigger follow-up actions.

---

### Ticket Classification
**ID:** `nfpNy7nL3TB4VeDV` | **Status:** Active | **Nodes:** 21

**What it does:** Automatically classifies incoming tickets by category, priority indicators, and complexity to assist with routing and triage.

---

### Round Robin v6
**ID:** `823UzPiVAoBBG974` | **Status:** Active | **Nodes:** 55

**What it does:** Automatically assigns new tickets to available agents using a weighted round-robin algorithm. Considers agent availability, current workload, skills, and shift patterns.

---

### Check Agent Availability
**ID:** `u02CRtQN124EJVVYHaEnt` | **Status:** Active | **Nodes:** 16

**What it does:** Checks which agents are currently available (not on leave, not at capacity) to receive new ticket assignments. Feeds into the round-robin system.

---

### Auto Replies — Hourly Trigger
**ID:** `pgLEfwMWcz1lPs5f` | **Status:** Active | **Nodes:** 6

**What it does:** Hourly check for tickets that need automated follow-up responses — e.g., status updates, resolution confirmations, or "we haven't forgotten you" messages.

---

### Auto Replies — Stage 1
**ID:** `hmdQa4lq8oZDfZSjxzL4C` | **Status:** Active | **Nodes:** 9

**What it does:** First stage of the automated reply pipeline — initial acknowledgement and AI-generated response to customer queries.

---

### Auto Replies — Stage 2
**ID:** `OJdK72S2Ui5om53FW4xXN` | **Status:** Active | **Nodes:** 30

**What it does:** Second stage — more detailed responses, follow-up actions, and escalation decisions based on ticket analysis.

---

### Auto Reply — Form Submission
**ID:** `IlgfRo3AXsZPZIHcFLPIC` | **Status:** Active | **Nodes:** 4

**What it does:** Handles auto-responses for tickets created via web form submissions.

---

### Auto Replies — Assignee Decision Webhook
**ID:** `XWJYlUGxvDjbDjOWH0t-W` | **Status:** Active | **Nodes:** 11

**What it does:** Webhook endpoint that receives agent assignment decisions (accept/reject/reassign) and updates the ticket accordingly.

---

### Jira Manual Ticket Reply Webhook
**ID:** `kiVrk6BCqgf3Y1WB` | **Status:** Active | **Nodes:** 10

**What it does:** Processes manual ticket replies submitted through the NOVA interface, posting them back to Jira.

---

## Specialised Processors

### Jira Abuse Report Processor
**ID:** `YSg6n6qs3JKCFO5N` | **Status:** Active | **Nodes:** 7

**What it does:** Detects and processes abuse report tickets — applies specific handling rules, escalation paths, and compliance procedures.

---

### QA — Process Jira Ticket Attachments
**ID:** `r8vW9fhJmTXyT1Js` | **Status:** Active | **Nodes:** 16

**What it does:** Processes attachments on Jira tickets (screenshots, logs, documents) to extract relevant information for QA scoring and ticket analysis.

---

### QA — AI Support Jira Ticket Created
**ID:** `PypQsfsPBPi6HwAd` | **Status:** Active | **Nodes:** 24

**What it does:** Quality assurance workflow specifically for AI-generated support responses — validates that auto-responses meet quality standards before or after posting.

---

### Product Cancellation — Trigger
**ID:** `g-8bd5DQq9NsNNRibD2hH` | **Status:** Active | **Nodes:** 11

**What it does:** Triggered when a product cancellation is processed. Captures the event, notifies relevant teams, and logs the data for cancellation tracking metrics.

---

### Call Reviews
**ID:** `oaEFAZPlQ2Goanc3` | **Status:** Active | **Nodes:** 21

**What it does:** Processes support call review data and posts summaries to Microsoft Teams for team visibility and coaching.

---

### Back Date Auto2020
**ID:** `soHFXArsi1G_bT6aJecXm` | **Status:** Active | **Nodes:** 53

**What it does:** Legacy automation for backdating operations related to the Auto2020 system.

---

### Jira Resolved Ticket QA
**ID:** `t1_H2ThQqALnt316LUGt6` | **Status:** Active | **Nodes:** 10

**What it does:** Webhook-triggered QA analysis for resolved tickets — provides on-demand quality assessment.

---

## NTPJ (Internal AI Project)

### NTPJ AI Request — Ticket Created
**ID:** `epHMXA96tyas4tlb` | **Status:** Active | **Nodes:** 29

**What it does:** Handles AI-assisted requests in the NTPJ project — analyses new tickets using AI and Confluence knowledge search.

---

### NTPJ AI Request — Comment Added
**ID:** `IkVxaHOiycZUD7mb` | **Status:** Active | **Nodes:** 23

**What it does:** Processes new comments on NTPJ tickets, using AI to generate informed responses based on Confluence documentation.

---

## External Integrations

### Customer AI Assistant
**ID:** `Hb91CgIEe00yzEJV` | **Status:** Active | **Nodes:** 15

**What it does:** Customer-facing AI assistant that handles common queries, provides self-service answers, and escalates to human agents when needed.

---

### Teams Listener
**ID:** `wwL3hTALqaE3OxUR` | **Status:** Active | **Nodes:** 4

**What it does:** Listens for messages in Microsoft Teams channels and processes commands or notifications.

---

### NEURO — Jira Queue Ingest
**ID:** `59Seb6rw2noE7lYy` | **Status:** Active | **Nodes:** 4

**What it does:** Ingests Jira queue data into the NEURO analytics system for advanced queue health analysis.

---

## Performance Reviews

### SUB — Performance Review Snapshot
**ID:** `8jHDT26KA6nf4QGD` | **Status:** Active | **Nodes:** 27

**What it does:** Generates comprehensive performance review snapshots for each team member — pulling metrics from QA scores, Golden Rules, ticket volumes, CSAT, and attendance data.

---

### SUB — Performance Review Approval Form
**ID:** `YawJjSDp0RdbedBI` | **Status:** Active | **Nodes:** 4

**What it does:** Handles the approval workflow for performance review submissions.

---

### NICK-AGENT — Trigger 1-2-1 Snapshot
**ID:** `DQBOgPXndIY6oAzZ` | **Status:** Active | **Nodes:** 2

**What it does:** Triggers generation of 1-2-1 meeting preparation snapshots with individual agent metrics.

---

### NICK-AGENT: AI Chief of Staff
**ID:** `8iaclVkYIZRRb0DF` | **Status:** Active | **Nodes:** 8

**What it does:** AI-powered assistant for the Head of Support — provides briefings, analyses trends, and suggests priorities.

---

## API Endpoints (QA Data)

### QA_API_Results
**ID:** `68cqGBxbQHpI7axS` | **Status:** Active | **Nodes:** 5

**What it does:** REST API endpoint serving QA result data to the NOVA dashboard and external consumers.

---

### QA_API_Summary
**ID:** `B9ISk6JoPPmdzNB9` | **Status:** Active | **Nodes:** 4

**What it does:** REST API endpoint serving aggregated QA summary statistics.

---

### QA_API_Agents
**ID:** `iR30uH4Jmfc9CLdd` | **Status:** Active | **Nodes:** 5

**What it does:** REST API endpoint serving per-agent QA breakdown data.

---

### KPI UAT vs Live Comparison
**ID:** `AaF0jl7ardw3tQC9` | **Status:** Active | **Nodes:** 7

**What it does:** Compares KPI data between UAT and Live environments to validate data pipeline accuracy.

---

## Backfill Workflows (Manual Trigger)

### QA Full QA Backfill
**ID:** `eNxDaODJbTP3edSe` | **Status:** Active | **Nodes:** 62

**What it does:** Backfills Full QA scores for historical tickets. Has 5 parallel monthly branches (Nov 25 – Mar 26). Each branch searches resolved tickets, fetches full details, runs AI scoring, and writes to `jira_qa_results`.

---

### QA Golden Rules Backfill
**ID:** `rCDqTOOkQfbRnPf1` | **Status:** Active | **Nodes:** 57

**What it does:** Backfills Golden Rules scores for historical comments. 5 parallel monthly branches. Extracts all public agent comments from resolved tickets and scores each against the three rules.

---

### FCR Backfill (+ 1st Line Rate, Bug Ack Time, CSAT)
**ID:** `DATXOMgjqjVrkWEz` | **Status:** Inactive (manual) | **Nodes:** 77

**What it does:** Backfills four metrics from historical resolved tickets:
1. **FCR Rate %** — First Contact Resolution
2. **1st Line Resolution Rate %** — Tickets resolved without escalation
3. **Bug Escalation-to-Ack (hours)** — Time to first response on bug tickets
4. **CSAT %** — Customer satisfaction from survey ratings

5 parallel monthly branches (Nov 25 – Mar 26), each calculating all 4 metrics.

---

### KPI Team Backfill
**ID:** `hjEBkE233cZvt74S` | **Status:** Inactive | **Nodes:** 21

**What it does:** Backfills team-level KPI data for historical periods.

---

### KPI Agent Backfill
**ID:** `zIPOQdK1b3kRRAVG` | **Status:** Active | **Nodes:** 15

**What it does:** Backfills per-agent KPI data (solved counts, performance metrics) for historical periods.

---

### Backfill Orchestrator
**ID:** `lXDqZfs4NMC3IU57` | **Status:** Active | **Nodes:** 20

**What it does:** Coordinates multiple backfill workflows, managing date ranges and execution order to avoid API rate limits.

---

## Inactive / Legacy (not sending emails, not processing data)

| Workflow | Status | Notes |
|----------|--------|-------|
| Daily KPI Report v2a | Inactive | Superseded by v3.1 |
| Ticket_QA_V4 | Inactive | Superseded by V5 |
| Ticket QA V4 (archived) | Archived | Legacy |
| Ticket QA V5 | Active | Older V5 variant |
| QA Score reporting | Inactive | Superseded by V5 digest |
| Jira - AI Sentiment | Inactive | Experimental |
| Round Robin old | Inactive | Superseded by v6 |
| Jira Auto Ticket Replies - Get Further Info | Inactive | Superseded by Auto Replies pipeline |
| Various _temp workflows | Inactive | Investigation/debugging tools |
