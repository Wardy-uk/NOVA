# NOVA Agent View — Build Specification

> **Purpose:** A personal dashboard for each support agent showing their role, what good looks like, and where they stand against it — plus a manager roster view with RAG health indicators.
>
> **Context:** This replaces the static development plan documents, the NEURO 1-2-1 prep n8n workflow, and parts of the existing Agent KPIs page. It becomes the single place an agent goes to understand their performance and development.
>
> **Development plans source:** `C:\Users\NickW\Documents\Nicks knowledge base\Documents\HR\[Agent Name] - Development Plan.md` (13 files)

---

## Quick start for Claude Code

1. Read this spec fully before starting
2. Read `CLAUDE.md` for project conventions
3. Start with Phase 1: schema migrations in `src/server/db/schema.ts`, then `scripts/import-dev-plans.mjs`
4. Development plan files to import are at: `C:\Users\NickW\Documents\Nicks knowledge base\Documents\HR\*Development Plan.md`

---

## 1. Two audiences, one page

### Agent view (non-admin users)
When an agent logs into NOVA, they land on a personal page scoped to their data only. They cannot see other agents. The page answers three questions:

1. **What is my role?** — Role clarity section from their development plan
2. **What does good look like?** — Targets, goals, and team-wide training expectations
3. **Where am I against that?** — Live KPIs, QA scores, golden rules, with targets overlaid

### Manager view (admin users — Nick)
A roster/grid of all agents in `TEAM_AGENTS` with RAG status indicators per agent. Clicking an agent opens their full agent view (same as what the agent sees, plus any manager-only context like 1-2-1 history and prep).

---

## 2. Manager roster — the landing page for Nick

Grid of agent cards showing at-a-glance health. Each card shows:

| Column | Source | RAG logic |
|--------|--------|-----------|
| Agent name + role + tier | `Agent` table + development plan data | — |
| KPI health | `jira_agent_kpi_daily` (latest row) | Green: SLA ≥95% + TPH on target. Amber: one off. Red: both off or SLA <85% |
| QA health | `jira_agent_kpi_daily` (QAOverallAvg) | Green: ≥8.0. Amber: 6.5–7.9. Red: <6.5 |
| Golden Rules | `jira_agent_kpi_daily` (GoldenRulesAvg) | Green: ≥2.5/3. Amber: 2.0–2.4. Red: <2.0 |
| Training | Development plan training items (NOVA DB) | Green: all complete. Amber: in progress. Red: overdue |
| Satisfaction | Per-agent survey score (NOVA surveys) | Derive single score per agent from survey responses |
| Next 1-2-1 | O365 calendar integration | Shows date. Amber: ≤2 days. Red: overdue |
| Overall | Composite | Worst RAG across columns + manual override (SOLID/WATCH/AT RISK/NEW) |

**Actions per agent card:**
- Click → opens their full agent view
- "Generate 1-2-1 Prep" button → generates the prep report (section 5)
- "1-2-1 Snapshot" button → captures current metrics as point-in-time record

---

## 3. Agent view — the personal dashboard

### Layout: Left (≈65%) + Right (≈35%)

**Left panel — Performance** (based on existing AgentKpisView, scoped to single agent, dev plan targets overlaid)

Performance section (from `jira_agent_kpi_daily`): Tickets Resolved (trend % + avg/day), Tickets Per Hour (with target), Avg Open Tickets, Avg >2h Overdue (target: 0), Avg No Update Today (target: 0), Oldest Ticket days (target: ≤3).

Quality section (from `jira_agent_kpi_daily` + `jira_qa_results`): QA Score Overall (with target e.g. ≥8.0 by Day 90), Accuracy/Clarity/Tone sub-scores, QA Traffic Light (G/A/R), Concerning Tickets. Clickable → navigates to QA view filtered to this agent.

Golden Rules section: Overall Score (target: ≥2.5/3), Ownership, Next Action, Timeframe. Each colour-coded against target.

SLA section: FRT compliance %, Resolution compliance %, Breached ticket count.

**Right panel — Development context**

Role clarity: formatted text from development plan — "what is my role" answer.
Current strengths: bulleted list — positive reinforcement.
Development goals: each as a card with title, description, target metric + date, live indicator (current value vs target with progress bar), status (Not started/In progress/On track/At risk/Complete).
Team-wide training: checklist — manager editable, agent read-only.
Important context: nullable — e.g. Isabel's DD team direction note.

---

## 4. Data model

### `agent_development_plans`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto |
| agent_name | TEXT | Matches AgentName in `jira_agent_kpi_daily` |
| plan_period | TEXT | e.g. "April 2026 to July 2026" |
| role_title | TEXT | e.g. "2nd Line Support Analyst" |
| function_name | TEXT | e.g. "Technical Support" |
| role_clarity | TEXT | Markdown paragraph |
| strengths | TEXT | JSON array of strings |
| important_context | TEXT | Nullable |
| status | TEXT | active / archived |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### `agent_development_goals`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto |
| plan_id | INTEGER FK | → agent_development_plans.id |
| title | TEXT | Goal title |
| description | TEXT | What + why |
| measure_description | TEXT | "How we'll measure it" |
| metric_key | TEXT | Nullable — maps to KPI/QA field e.g. "TimeframeAvg", "QAOverallAvg" |
| metric_target | REAL | Nullable — target value |
| target_date | TEXT | ISO date |
| status | TEXT | not_started / in_progress / on_track / at_risk / complete |
| sort_order | INTEGER | Display order |

### `agent_training_items`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto |
| plan_id | INTEGER FK | → agent_development_plans.id |
| title | TEXT | Training item name |
| description | TEXT | Nullable |
| target_date | TEXT | Nullable — ISO date |
| completed | INTEGER | 0/1 |
| completed_at | TEXT | Nullable |
| sort_order | INTEGER | Display order |

### `agent_121_snapshots`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto |
| agent_name | TEXT | |
| snapshot_date | TEXT | ISO date |
| metrics_json | TEXT | JSON blob of all KPI/QA values at point in time |
| goals_json | TEXT | JSON blob of goal statuses |
| prep_json | TEXT | Nullable — AI-generated prep document |
| transcript_md | TEXT | Nullable — imported Plaud transcription/summary |
| notes | TEXT | Nullable — manager notes |
| created_at | TEXT | ISO timestamp |

### `agent_121_actions`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto |
| snapshot_id | INTEGER FK | → agent_121_snapshots.id |
| agent_name | TEXT | |
| description | TEXT | e.g. "Update timeframes on every ticket for next two weeks" |
| owner | TEXT | Agent name or "Nick" |
| due_date | TEXT | Nullable — ISO date |
| status | TEXT | open / in_progress / complete / cancelled |
| completed_at | TEXT | Nullable |
| created_at | TEXT | ISO timestamp |

### Data seeding
Import 13 development plans from vault: `C:\Users\NickW\Documents\Nicks knowledge base\Documents\HR\*Development Plan.md`. Build `scripts/import-dev-plans.mjs`. After import, NOVA is source of truth.

---

## 5. 1-2-1 process — five-step loop

**Step 1 — Prep** (auto day before, or manual "Generate Prep"): AI-generated doc with metrics since last 1-2-1, goal progress, QA highlights (RED/concerning), training status, outstanding actions, suggested talking points. Surfaces as notification.

**Step 2 — Meeting**: Prep open as reference. No NOVA interaction needed.

**Step 3 — Import**: Plaud transcription/summary from vault. NOVA extracts themes, decisions, commitments.

**Step 4 — Outcome capture**: Record commitments as tracked actions (surface in next prep). Update goal statuses. Qualitative = manual; quantitative = auto from live data.

**Step 5 — Snapshot**: Auto-freeze all metrics. Next prep uses this as baseline. Loop closes.

### Calendar integration
Read next 1-2-1 from Nick's O365 calendar (match agent name in meeting title). Auto-generate prep day before. NOVA already has O365 access — review `src/server/routes/o365.ts` for suitability.

---

## 6. Navigation & access control

New area: **"People"**. Agent Roster (admin only) + My Performance (non-admin agent view). Non-admin default → My Performance. Admin → Roster with click-through. Existing Agent KPIs page stays for team comparison. Reuse `resolveAgentScope()` for scoping.

---

## 7. API endpoints

```
GET  /api/people/roster                        — Agent list + RAG summaries (admin)
GET  /api/people/agent/:agentName              — Full agent view data (scoped or admin)
GET  /api/people/agent/:agentName/plan         — Development plan + goals + training
PUT  /api/people/agent/:agentName/plan         — Update plan (admin)
PUT  /api/people/goals/:goalId                 — Update goal status (admin)
PUT  /api/people/training/:itemId              — Toggle training complete (admin)
POST /api/people/agent/:agentName/snapshot     — Create 1-2-1 snapshot
GET  /api/people/agent/:agentName/snapshots    — List snapshots
POST /api/people/agent/:agentName/generate-prep — Generate AI 1-2-1 prep
GET  /api/people/agent/:agentName/calendar     — Next 1-2-1 date from O365
POST /api/people/agent/:agentName/actions      — Create tracked action
PUT  /api/people/actions/:actionId             — Update action status
```

---

## 8. What this replaces

| Current | Replaced by |
|---------|-------------|
| Vault development plan .md files | NOVA `agent_development_plans` tables |
| NEURO 1-2-1 prep n8n workflow | NOVA 1-2-1 prep generation |
| Manual "send dev plan" task | Agent self-service in NOVA |
| Separate Agent KPIs page | Embedded in agent view with dev context |
| NEURO People note 1-2-1 tracking | O365 calendar integration |

---

## 9. Build phases

**Phase 1 — Data model + import**: Schema migrations, import script for 13 plans, plan CRUD API.
**Phase 2 — Agent view + plan editor**: AgentProfileView.tsx, left/right layout, goal-to-metric wiring, inline editor (admin).
**Phase 3 — Manager roster**: AgentRosterView.tsx, RAG logic, click-through, manual status override.
**Phase 4 — 1-2-1 process + calendar**: O365 review, AI prep, transcript import, outcome capture, auto-snapshot, notifications.
**Phase 5 — Nav + access control**: People area in App.tsx, role routing, agent default view, survey scores on roster.

---

## 10. Resolved decisions

1. O365 — already has access, review suitability in Phase 4
2. SSO — all 13 agents have accounts, Azure admins to review permissions
3. Plan editing — yes, inline in NOVA UI, admin-only
4. Survey scores — per-agent satisfaction from NOVA survey responses, aggregated single score
5. Metric mapping — quantitative goals wired to live KPI/QA fields, qualitative = manual via 1-2-1
6. 1-2-1 process — five-step loop formalised: Prep → Meeting → Import → Outcome → Snapshot

---

## Technical notes

- Follow NOVA patterns: `createXxxRoutes(deps)`, `res.json({ ok, data })`, sql.js migrations with try/catch ALTER TABLE
- React 19 + Tailwind 4, component per view
- Reuse `TEAM_AGENTS` constant, `resolveAgentScope()`, existing KPI/QA query patterns
- Dev plan markdown structure: `## Role clarity` / `## Current strengths` / `## Team-wide training` / `## Development goals` with `### Goal N` sub-sections
