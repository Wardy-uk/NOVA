# Backfill Rebuild Plan

**Created:** 2026-03-21
**Status:** In Progress

## Overview
Delete all deprecated/temp workflows and rebuild 4 clean backfill workflows from scratch, each copying exactly from the live source-of-truth workflows.

## Source of Truth Workflows
- **Ticket_QA_V5** (`jR8hKoPF4QOAEM1h`) — merged live QA workflow, hourly
- **Daily KPI Report v3.1** (`pBrRdWYxtYFy4mGh`) — daily KPI + snapshot

## Step 1 — Delete Deprecated Workflows
| Workflow ID | Name | Status |
|---|---|---|
| ZetaCV3HyDEpAjGD | QA_V5_Backfill_Orchestrator | DELETED |
| wqvGOXS24IC7A932 | QA_V5_Backfill_FullQA | DELETED |
| Ch7ob7TOa6gnp4zm | KPI_Backfill | DELETED |
| 7NZ3rYGaTEYrWr4t | QA_V5_Phase0_Prerequisites | DELETED |
| BWsvLL4dG2KKna5g | KPI_Archive_Runner | DELETED |

## Step 2 — Audit Live Workflows
- [x] Read and report node list for Ticket_QA_V5 (35 nodes, FQA + GR branches)
- [x] Read and report node list for Daily KPI Report v3.1 (64 nodes, team + agent KPI)

## Step 3 — Build 4 Backfill Workflows (sequential, validated)

### Backfill 1: QA_FullQA_Backfill — `eNxDaODJbTP3edSe` CREATED INACTIVE
- Source: FullQA branch of Ticket_QA_V5
- 14 nodes: Manual Trigger → Date Range → Search Resolved → Fetch → Classify → Quick Solve IF → Dedup → Is QA'd IF → Prep AI → AI Scorer (gpt-4.1) → Map Output → INSERT
- Date range: startDate/endDate (currently 2026-03-16 to 2026-03-20)
- Destination: `jira_qa_resultsUAT`
- Credential: Jira Support DB

### Backfill 2: QA_GoldenRules_Backfill — `rCDqTOOkQfbRnPf1` CREATED INACTIVE
- Source: Golden Rules branch of Ticket_QA_V5
- 11 nodes: Manual Trigger → Date Range → Search Updated → Fetch → Extract Comments (no 70-min filter) → Dedup → Merge → Is Dup IF → AI Scorer (gpt-4.1) → Map Output → INSERT
- Date range: startDate/endDate (currently 2026-03-16 to 2026-03-20)
- Destination: `Jira_QA_GoldenRulesUAT`
- Credential: Jira Support DB

### Backfill 3: KPI_Team_Backfill — `hjEBkE233cZvt74S` CREATED INACTIVE
- Source: Team KPI calculation from Daily KPI Report v3.1
- 14 nodes: Manual Trigger → Set Target Date → Compute Next Date → [Get Opened + Get Solved + SQL Baseline + SQL Targets] → Parse → Merge → Build Unified KPI → Enrich → SQL Insert Daily
- Single targetDate (currently 2026-03-20), auto-computes nextDate
- All GETDATE()/startOfDay() replaced with targetDate param
- Destination: `jira_kpi_daily`
- Skips: point-in-time nodes (open tickets, no-reply, EOD, emails, AI summary)
- Credential: Jira Support DB

### Backfill 4: KPI_Agent_Backfill — `zIPOQdK1b3kRRAVG` CREATED INACTIVE
- Source: Agent KPI section from Daily KPI Report v3.1
- 14 nodes: Manual Trigger → Set Target Date → Compute Next Date → [Get Solved + SQL Agents + SQL QA + SQL Golden + Jira CSAT] → Parse CSAT → Merge chain → Build Agent KPI → SQL Upsert
- Single targetDate (currently 2026-03-20)
- QA/Golden Rules/CSAT/SLA: date-parameterised, will backfill correctly
- Open ticket counts: reads CURRENT Agent table (point-in-time, not historical)
- Destination: `jira_agent_kpi_daily`
- Credential: Jira Support DB

## Validation Protocol (each backfill)
1. Run for a single day that the live workflow already processed
2. Compare row count vs expected from live workflow history
3. Sample scores/values for sanity
4. Check execution log for errors
5. Report to Nick before building next backfill

## Key Credentials
- **Jira:** `KsrgMe7SiKeNTFM0` (Jira SW Cloud account - Main)
- **SQL:** `8mpvJ0pYv1jKUYH8` (Jira Support DB) — for all SELECT/INSERT/UPDATE
- **SQL (DB admin only):** `wDUneX0p6mWKA240` (Microsoft SQL account 2)
- **OpenAI:** `nWSJYjd69X7nqW7y` (OpenAi account)
