# Backfill Rebuild — TODO Tracker

**Last updated:** 2026-03-21 (end of Day 6)

## Current State Summary
All archives confirmed intact. All destination tables empty. 4 clean backfill workflows built, untested.

### Archives (DO NOT TOUCH)
| Archive Table | Rows | Status |
|---|---|---|
| `jira_qa_results_v4_archive` | 20,161 | ✅ Safe |
| `Jira_QA_GoldenRules_v4_archive` | 7,367 | ✅ Safe |
| `jira_kpi_daily_archive` | 3,835 | ✅ Safe |
| `jira_agent_kpi_daily_archive` | 214 | ✅ Safe |

### Destination Tables (all empty, ready for backfill)
| Table | Rows | Status |
|---|---|---|
| `jira_qa_resultsUAT` | 0 | ✅ Empty (cleared 2026-03-22) |
| `Jira_QA_GoldenRulesUAT` | 0 | ✅ Empty (cleared 2026-03-22) |
| `jira_kpi_daily` | 0 | ✅ Empty (cleared 2026-03-22) |
| `jira_agent_kpi_daily` | 0 | ✅ Empty (cleared 2026-03-22) |

### Live Workflows (DO NOT MODIFY)
| Workflow | ID | Status |
|---|---|---|
| Ticket_QA_V5 (hourly) | `jR8hKoPF4QOAEM1h` | ✅ Active, running |
| Daily KPI Report v3.1 | `pBrRdWYxtYFy4mGh` | ✅ Active, running |

---

## Step 1: Delete Deprecated Workflows
- [x] Delete ZetaCV3HyDEpAjGD — QA_V5_Backfill_Orchestrator ✅
- [x] Delete wqvGOXS24IC7A932 — QA_V5_Backfill_FullQA ✅
- [x] Delete Ch7ob7TOa6gnp4zm — KPI_Backfill ✅
- [x] Delete 7NZ3rYGaTEYrWr4t — QA_V5_Phase0_Prerequisites ✅
- [x] Delete BWsvLL4dG2KKna5g — KPI_Archive_Runner ✅

## Step 2: Audit Live Workflows
- [x] Read Ticket_QA_V5 (jR8hKoPF4QOAEM1h) ✅
- [x] Read Daily KPI Report v3.1 (pBrRdWYxtYFy4mGh) ✅

## Step 3: Build Backfill Workflows
- [x] **Backfill 1:** QA_FullQA_Backfill (`eNxDaODJbTP3edSe`) — 14 nodes, dates 2026-03-16 to 2026-03-20 ✅ Built
- [ ] **Backfill 1:** VALIDATE — run, check jira_qa_resultsUAT row count, expect ~500 rows (5 days x ~100/day)
- [ ] **Backfill 2:** QA_GoldenRules_Backfill (`rCDqTOOkQfbRnPf1`) — VALIDATE (after Backfill 1 passes)
- [ ] **Backfill 3:** KPI_Team_Backfill (`hjEBkE233cZvt74S`) — VALIDATE (after Backfill 2 passes)
     Expected: ~62 KPIs/day across 6 days = ~372 rows in jira_kpi_daily
     Sources: Get Opened/Solved (Jira) + SQL Baseline + Parse All Open (historical JQL) + Archive Volume KPIs + EOD Snapshot
     Note: Volume KPIs (7) from jira_kpi_daily_archive where available, EOD snapshot data from JiraEodTicketStatusSnapshot (9 Feb+ only)
- [ ] **Backfill 4:** KPI_Agent_Backfill (`zIPOQdK1b3kRRAVG`) — VALIDATE (after Backfill 3 passes)
     Expected: ~14 agents x 6 days = ~84 rows in jira_agent_kpi_daily
     Note: Open ticket counts from jira_agent_kpi_daily_archive where available (20 Feb+), falls back to current Agent table

## Step 4: Run at Scale (after all 4 validated)
- [ ] QA_FullQA_Backfill — full date range 2025-11-01 to 2026-03-17
- [ ] QA_GoldenRules_Backfill — full date range 2025-11-01 to 2026-03-17
- [ ] KPI_Team_Backfill — full date range 2025-11-01 to yesterday
- [ ] KPI_Agent_Backfill — full date range 2025-11-01 to yesterday

## Step 4b: AI Digest Backfill (low priority)
- [ ] **AI Digest backfill** — build a separate workflow to backfill `jira_kpi_digest` table with AI-generated summaries for historical dates. Low priority — do after all KPI and QA backfills are complete and validated.

## Step 5: Promote to Live (after full backfill validated)
- [ ] Rename jira_qa_resultsUAT → jira_qa_results (after Phase 4 promotion)
- [ ] Rename Jira_QA_GoldenRulesUAT → Jira_QA_GoldenRules
- [ ] Update Ticket_QA_V5 to write to live tables
- [ ] Update NOVA QA grade thresholds (V5 scale: Green ≥7.5, Amber ≥5.5, Red <5.5)
- [ ] Nick confirms before any table renames

---

## Current Status — 2026-03-23 17:30 (Day 8 end)

### What's confirmed in the tables (use from=2025-11-01 queries, not days=365):
| Table | Rows | Coverage | Status |
|---|---|---|---|
| `jira_qa_resultsUAT` | 7,471 | Nov-Mar | ✅ Complete |
| `jira_kpi_daily` | 8,934 | 141 days, Nov 1 → Mar 21 | ✅ Complete |
| `jira_agent_kpi_daily` | 1,988 | 142 days, Nov 1 → Mar 22 | ✅ Complete |
| `Jira_QA_GoldenRulesUAT` | 2,389+ | Nov partial | ⏳ Still running overnight |

### Golden Rules status:
- November run failed at 2330/3370 with OpenAI 500 error
- Two runs appear stuck — kill tomorrow morning
- Fix applied: retryOnFail on AI Scorer and INSERT nodes
- JQL confirmed: resolutiondate (not updated) ✅
- dedup confirmed working ✅
- Run month by month: Nov, Dec, Jan, Feb, Mar 1-15

### NOVA API note:
- ALWAYS use `from=2025-11-01&to=YYYY-MM-DD` params when querying
- `days=365` parameter is capped by the API and will show incomplete data

### Tomorrow morning tasks:
1. Kill any stuck Golden Rules executions in n8n
2. Ask CC to run `BACKFILL_DATA_AUDIT.md` queries — get daily count breakdown for ALL metrics
3. Review what we have vs what we had in archives
4. Decide whether Golden Rules is good enough to proceed or needs more runs
5. If Golden Rules needs more months — run Dec, Jan, Feb, Mar 1-15 sequentially

---

## Current Status — 2026-03-22 21:30 (end of Day 7)

### What's in the tables right now:
| Table | Rows | Notes |
|---|---|---|
| `jira_qa_resultsUAT` | 1,748+ | November FullQA complete, December running |
| `Jira_QA_GoldenRulesUAT` | 368 | Validation test data only — GR not yet backfilled |
| `jira_kpi_daily` | 380 | Validation test data only — KPI not yet backfilled |
| `jira_agent_kpi_daily` | 70 | Validation test data only |

### Orchestrator running overnight:
- Workflow: `lXDqZfs4NMC3IU57`
- Status: Active, processing Dec 2025 QA FullQA
- Completion email to: nickw@nurtur.tech
- All fixes in place: INSERT-inside-loop, alwaysOutputData, output[0] wiring, IF branch correct

### Known issue to investigate tomorrow:
- November Golden Rules ran but stayed at 368 rows — either dedup skipped everything or it wrote 0. Check `Backfill_Orchestrator_Log` for Golden Rules status
- KPI Team/Agent haven't run yet for any month

---

## Tomorrow Morning — Check This First
1. Check email — did completion email arrive?
2. Run `_temp_investigate_backfill` in n8n — get row counts for all 4 tables
3. Check `Backfill_Orchestrator_Log` — which months/workflows succeeded vs failed
4. If orchestrator completed: assess what's missing and run any failed streams manually
5. If orchestrator still running: leave it, check back later
Orchestrator scheduled to fire at 16:15. All 4 child workflows validated and active.
Previous test run confirmed: QA FullQA processed 1,529 November tickets in 9 minutes — working correctly.
Full run estimated: 2-3 hours total across 5 months × 4 workflows.
Monitor via email to nickw@nurtur.tech — completion email sent when done.
Also check dbo.Backfill_Orchestrator_Log for per-workflow status.

---
1. Open `QA_FullQA_Backfill` (`eNxDaODJbTP3edSe`) in n8n
2. Click Test Workflow — runs 2026-03-16 to 2026-03-20
3. Check `jira_qa_resultsUAT` — expect ~500 rows, avg score ~7.0, sensible agent names
4. If passes → validate Backfill 2, 3, 4 in sequence
5. If fails → report exact node and error to CC before touching anything
