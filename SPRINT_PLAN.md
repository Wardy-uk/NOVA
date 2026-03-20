# NOVA Sprint Plan — 2026-03-20

## Overview

Three parallel sprints delivering QA workflow consolidation, V5 backfill orchestration, and the Trends screen.

**Branch:** `nova-codex`
**Deploy:** `.\deploy\deploy.ps1 -Branch nova-codex` via RDP
**n8n:** All workflow work via n8n MCP server

---

## Sprint 1 — Merge V5 QA Workflows (n8n MCP)

**Goal:** Merge `Ticket_QA_V5_FullQA` (kP4T3lzP4y5DyeJF) and `Ticket_QA_V5_GoldenRules` (YSce8BZpdotBX7ed) into a single `Ticket_QA_V5` workflow.

**Why:** Both run hourly on the same schedule, search the same 70-min window of NT tickets, and duplicate Jira API calls. Merging halves API usage.

### Steps
1. Read both workflows via n8n MCP — understand full node structure
2. Design merged workflow structure:
   - Single Schedule Trigger (hourly)
   - Single 70-min window builder
   - Single Jira ticket search
   - Single full issue + comments fetch
   - **Branch A (parallel):** Full QA path → Quick Solve Classifier → AI Scorer → INSERT `jira_qa_resultsUAT`
   - **Branch B (parallel):** Golden Rules path → Extract Comments → Dedup → AI Scorer → INSERT `Jira_QA_GoldenRulesUAT`
3. Preserve backfill trigger nodes from both workflows
4. Create merged workflow `Ticket_QA_V5` via n8n MCP
5. **Keep writing to UAT tables** — no change until Nick confirms Phase 4
6. Present to Nick for review
7. Once confirmed working: deactivate and delete the two originals

### Guardrails
- Do NOT change target tables (stay on UAT)
- Do NOT touch `JiraSlaRaw`, `JiraTickets`, `JiraTicketsArchive`

---

## Sprint 2 — QA V5 Backfill Orchestrator (n8n MCP)

**Goal:** Build orchestrator workflow to backfill 19,600 tickets (Dec 2025 – Mar 2026) through V5 QA scoring.

**Dependency:** Sprint 1 (Snag 27) must complete first — backfill runs from the merged workflow.

### Phase 0 — SQL Prerequisites (run on live server)
1. Archive V4 data into `jira_qa_results_v4_archive` and `Jira_QA_GoldenRules_v4_archive` (with `dataVersion='v4'` and `archivedAt` columns)
2. Create `dbo.QA_Backfill_Progress` tracking table
3. Pre-populate progress table with all date windows (2025-12-20 to 2026-03-15)
4. TRUNCATE `jira_qa_resultsUAT` and `Jira_QA_GoldenRulesUAT` for clean start

### Phase 1 — Build QA_V5_Backfill_Orchestrator
- **Manual trigger only** — never scheduled
- Reads one pending date window at a time from `QA_Backfill_Progress`
- Processes FullQA and GoldenRules per window
- **Rate limits:**
  - Max 10 concurrent Jira fetches
  - Max 5 concurrent OpenAI calls
  - 2-second delay between batches
  - 30-second buffer between windows
  - Exponential backoff on Jira 429s (30s, 60s, 120s)
- **Error handling:**
  - Per-window error handling with 3 auto-retries before marking failed
  - Never abort entire backfill for one window failure
- **Safety:**
  - Dedup prevents re-processing
  - Max 50 tickets per date window
  - Resumable at any time (reads next 'pending' row)
  - Live hourly workflow continues running alongside
- Loops automatically through all pending windows
- Sends Teams notification on completion
- **Present to Nick before activating — Nick activates manually**

### Phase 2 — Run Backfill
Nick activates. Estimated 7-12 hours. Monitor via SQL queries on `QA_Backfill_Progress`.

### Phase 3 — Validate (STOP AND REPORT)
Run validation SQL from spec. Report results to Nick. **Wait for Nick's confirmation before Phase 4.**

### Phase 4 — Promote V5 UAT to Live (NICK CONFIRMS FIRST)
- Rename tables: UAT → live, old live → deprecated
- Update V5 workflow to write to live tables
- Backfill agent daily QA columns
- Update NOVA QA grade thresholds (V5 scale: Green ≥7.5, Amber ≥5.5, Red <5.5)

---

## Sprint 3 — Trends Screen (NOVA Codebase)

**Goal:** New Trends top-level screen with 5 sections. Day 15 checkpoint is 31 March (8 working days).

### Build Order (priority)

#### 1. Section 5 — Checkpoint Evidence Panel (HIGHEST PRIORITY)
- Pre-populated table: Day 1 baseline vs current vs target for all core metrics
- Checkpoint dates: D1=2026-03-16, D15=2026-03-31, D30=2026-04-15, D45=2026-04-30, D60=2026-05-15, D90=2026-06-14
- Auto-populates from closest daily snapshot to each checkpoint date
- Export as CSV
- **API:** `GET /api/trends/checkpoint?env=live`

#### 2. Section 1 — SLA Compliance Trend
- Two line charts: FRT Compliance % and Resolution Compliance % over time
- Target line: 95% dashed horizontal
- Day 1 baseline vertical marker at 2026-03-16
- Current values as headline numbers with RAG dots
- **Data:** `jira_kpi_daily` — FRT/Resolution Compliance KPIs
- **API:** `GET /api/trends/sla?env=live&days=90&granularity=weekly`

#### 3. Section 2 — Queue Health Trend
- Two line charts: open ticket count per tier + oldest actionable ticket age per tier
- **Data:** `jira_kpi_daily` — Volume and Age groups
- **API:** `GET /api/trends/queue?env=live&days=90&granularity=weekly`

#### 4. Section 4 — Escalation & Resolution Trend
- Escalation Accuracy % over time (line) + escalation counts per tier per week (bar)
- **Data:** `jira_kpi_daily` — Escalations group
- **API:** `GET /api/trends/escalation?env=live&days=90&granularity=weekly`

#### 5. Section 3 — QA & Golden Rules Trend (shell)
- Wire to V4 live data now (`jira_qa_results`). Upgrade to V5 after backfill migration.
- Agent selector dropdown for 1-1 use
- **API:** `GET /api/trends/qa?env=live&days=90&granularity=weekly&agent=all`

### Files to Create/Modify
- **New:** `src/server/routes/trends.ts` — all 5 API endpoints
- **New:** `src/client/components/TrendsView.tsx` — main view + section sub-components
- **Modify:** `App.tsx` — add "Trends" to top-level nav between KPIs and QA

### Design
- Dark NOVA aesthetic
- Chart.js for all charts
- Day 1 baseline vertical marker on all time-series charts
- Target dashed horizontal lines
- Global controls: date range (4/8/12 weeks/custom), granularity (daily/weekly), environment (live/UAT)

---

## Parallelism Plan

```
Sprint 1 (n8n merge)  ──────────►  Sprint 2 Phase 0-1 (orchestrator build)
                                    ║
Sprint 3 (Trends UI)  ─────────────╨──────────────────────────────────────►
```

- Sprints 1 & 3 run in parallel
- Sprint 2 starts after Sprint 1 completes (dependency: merged workflow)
- Sprint 3 Section 3 (QA trend) initially uses V4 data, upgrades after Sprint 2 Phase 4

---

## Key Decision Points (Nick must confirm)

1. **Sprint 2 Phase 4** — promote V5 UAT to live (table renames). STOP and report validation results first.
2. **Sprint 1** — deactivate/delete original workflows only after confirming merged one works.

---

*Plan created: 2026-03-20*
