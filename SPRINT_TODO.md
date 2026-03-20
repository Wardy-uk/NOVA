# NOVA Sprint TODO — 2026-03-20

## Sprint 1 — Merge V5 QA Workflows

- [x] Read `Ticket_QA_V5_FullQA` (kP4T3lzP4y5DyeJF) via n8n MCP
- [x] Read `Ticket_QA_V5_GoldenRules` (YSce8BZpdotBX7ed) via n8n MCP
- [x] Map shared nodes (trigger, window builder, Jira search, fetch)
- [x] Map unique nodes per branch (FullQA path vs GoldenRules path)
- [x] Design merged workflow node structure
- [x] Create merged `Ticket_QA_V5` workflow via n8n API — ID: `jR8hKoPF4QOAEM1h` (INACTIVE)
- [x] Verify merged workflow writes to UAT tables only (preserved from originals)
- [!] Present merged workflow to Nick for review — **SEE BELOW**
- [!] **WAIT** — Nick confirms merged workflow works correctly
- [ ] Deactivate original `Ticket_QA_V5_FullQA`
- [ ] Deactivate original `Ticket_QA_V5_GoldenRules`
- [ ] Delete both originals

---

## Sprint 2 — QA V5 Backfill Orchestrator

### Phase 0 — SQL Prerequisites
- [x] Generate SQL scripts: `sql/phase0-qa-v5-prerequisites.sql`
- [x] Build n8n workflow `QA_V5_Phase0_Prerequisites` — ID: `7NZ3rYGaTEYrWr4t` (INACTIVE)
  - 21 nodes: archive V4 → verify counts → create progress table → populate 172 windows → truncate UAT
  - 3 verification gates with Teams failure alerts
  - Skip-if-already-archived safety check
  - Teams success notification with summary stats
- [!] **Nick: review workflow in n8n dashboard, then run manually**

### Phase 1 — Build Orchestrator
- [x] Design orchestrator node flow
- [x] Build Manual Trigger + Read Next Pending Window
- [x] Build Is There Work? branch (IF node)
- [x] Build Mark As Running SQL update
- [x] Build FullQA branch (search → fetch → classify → score → insert)
- [x] Build GoldenRules branch (search → fetch → extract → score → insert)
- [x] Implement per-window error handling (3 retries → mark failed)
- [x] Build Mark As Complete + 30s wait + loop back
- [x] Build Teams completion notification
- [x] Create workflow via n8n API — ID: `ZetaCV3HyDEpAjGD` (INACTIVE)
  - 40 nodes: orchestration loop + FullQA branch + GoldenRules branch + completion/error handling
  - Reuses original node parameters, credentials, and AI prompts from V5 workflows
  - Writes exclusively to UAT tables (jira_qa_resultsUAT, Jira_QA_GoldenRulesUAT)
  - Dedup checks before AI scoring to avoid reprocessing
  - Quick-solve classifier excludes trivial tickets from FullQA
  - 30s wait between windows to respect rate limits
  - Teams notifications on completion and all-done
- [!] **Nick: review workflow `ZetaCV3HyDEpAjGD` in n8n dashboard**
- [!] **Nick: provide Teams webhook URL** (currently placeholder in Phase 0 + Orchestrator)
- [!] **WAIT** — Nick activates manually

### Phase 3 — Validate
- [ ] Run validation SQL after backfill completes
- [ ] Report row counts and gap analysis to Nick
- [!] **WAIT** — Nick confirms before Phase 4

### Phase 4 — Promote V5 to Live (NICK CONFIRMS)
- [ ] Generate SQL: rename tables (UAT → live, old → deprecated)
- [ ] Update V5 workflow to write to live tables
- [ ] Backfill agent daily QA columns
- [ ] Update NOVA QA grade thresholds (Green ≥7.5, Amber ≥5.5, Red <5.5)

---

## Sprint 3 — Trends Screen

### Backend — API Routes
- [x] Create `src/server/routes/trends.ts`
- [x] Build `GET /api/trends/checkpoint` endpoint
- [x] Build `GET /api/trends/sla` endpoint
- [x] Build `GET /api/trends/queue` endpoint
- [x] Build `GET /api/trends/escalation` endpoint
- [x] Build `GET /api/trends/qa` endpoint
- [x] Register trends routes in server app (`index.ts`)

### Frontend — All Sections (single-file TrendsView.tsx)
- [x] Create `TrendsView.tsx` main component with global controls
- [x] Build CheckpointPanel (Section 5) — evidence table, CSV export, RAG status
- [x] Build SlaSection (Section 1) — FRT + Resolution compliance charts
- [x] Build QueueSection (Section 2) — volume + age charts
- [x] Build EscalationSection (Section 4) — accuracy line + counts bar chart
- [x] Build QaSection (Section 3) — QA avg + Golden Rules charts + agent dropdown
- [x] Chart.js with Day 1 baseline vertical marker + target dashed lines

### Integration
- [x] Install chart.js + react-chartjs-2 + chartjs-plugin-annotation
- [x] Add "Trends" to top-level nav in `App.tsx` (between KPIs and QA)
- [x] Dark NOVA aesthetic styling (matches KpiDashboardView tokens)
- [x] Global controls (date range 4/8/12w, granularity daily/weekly, env live/UAT)
- [x] Full-width view registered
- [x] Build verified — no TypeScript errors in new files
- [ ] Push `nova-codex` branch
- [ ] Tell Nick to deploy

---

## Status Key
- [ ] Not started
- [~] In progress
- [x] Complete
- [!] Blocked / waiting on Nick

---

*TODO created: 2026-03-20 | Last updated: 2026-03-20*
