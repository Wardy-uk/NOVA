# KPI Rebuild — Full Parity & Legacy Retirement Plan

**Goal:** bring the NOVA-only KPI Rebuild to full feature parity with the legacy
"KPIs" area + the n8n "Daily KPI Report v4" workflow, so both can be retired and
n8n switched off. Started 2026-06-15.

## Context (verified 2026-06-15)
- **Rebuild area** (`#kpi-rebuild-*`) = 100% NOVA, tables `kpi_org_daily` /
  `kpi_agent_daily` in the **NOVA app DB**. Engine: `services/kpi-org/`, `services/kpi-agent/`.
- **Legacy "KPIs" area** + n8n write `dbo.jira_kpi_daily`, `jira_agent_kpi_daily`,
  `dbo.Agent` stats, `JiraEodTicketStatusSnapshot`, `KpiSnapshot` in **techservicesjsm**.
- NOVA's OLD `kpi-pipeline.ts` also still writes those legacy tables (races n8n) — see
  `memory/reference-kpi-daily-dual-writer.md`.
- Today: Operational Indicators repointed to the NOVA engine; SLA-field bug fixed
  (`cf[14048]`/`cf[14046] = breached()`); 4 throughput + per-tier FRT KPIs added.

## Already closed (since 2026-06-07 gap doc)
Daily History UI · Trends UI · Weekly/Monthly rollups · Backfill · Operational
Indicators on NOVA · SLA fix · per-tier volume/no-reply/oldest/over-SLA/FRT/escalations/
solved(transition)/CSAT/FRT+Res compliance/FCR.

## STATUS (2026-06-15)
- [x] **B2 done** (commit 44a9f47) — AI×3, 1st-line, bug-ack, WTD×2 ported to kpi-org.
- [x] **P1 done** (commit 01f090e) — 34 per-tier SLA Met/Breached/Compliance + Escalation Accuracy (daily + All Time).
- KPI-DATA parity layer complete. Remaining = operational (B1, P2) + UI (P3–P7) + retirement.
- ⚠ Deploy pending: commits 372d393, 44a9f47, 01f090e need a prod deploy + capture to populate.

## HARD BLOCKERS (must do before n8n off)
- [ ] **B1 — `dbo.Agent` stats dependency.** `assignment-engine.ts` (round-robin),
  `capacity-planner.ts`, `agent-availability.ts`, `people.ts`, `agent.ts` READ
  `OpenTickets_Total/Over2Hours`, `SolvedTickets_Today/ThisWeek`, `OldestTicketDays`.
  Only n8n + NOVA's old `refreshAllAgentMetrics` keep them fresh. Fix: make the Rebuild
  `kpi-agent` engine maintain `dbo.Agent` stats (own job), OR repoint consumers to
  `kpi_agent_daily`. Decision: keep writing `dbo.Agent` from a small NOVA job (least
  disruptive to round-robin).
- [ ] **B2 — Port 9 NOVA-only KPIs into kpi-org:** AI Tickets Resolved/Pending/
  Resolution Rate % (from `approval_queue`), 1st-line Resolution % (resolved-today CC
  tier / total), Bug-Ack hours (comment scan on bug types), WTD % Green/Red (meta, from
  `kpi_org_daily`). Needs new compute kinds in `nt-compute.ts`.

## FEATURE PARITY
- [ ] **P1 — 35 granular per-tier SLA KPIs:** FRT/Resolution Met/Breached/Compliance per
  tier (CC/Prod/T2/T3/Dev) + Escalation Accuracy % (All Time). Extend registry/compute.
- [ ] **P2 — Email digests:** daily + weekly LLM narrative; evidence email; agent KPI
  email (n8n currently sends these). Port to a NOVA job reading the Rebuild tables.
- [ ] **P3 — Leaderboard view** (rank agents Combined/Productivity/SLA/Quality; composite
  0–100; daily/weekly/monthly; team/tier filters).
- [ ] **P4 — QA views:** qa-summary, qa-agents, golden-rules detail/agents, call-QA,
  coaching nudges, concerning-ticket drilldowns (read existing QA/GR pipelines).
- [ ] **P5 — Escalation accuracy report** (EscalationReportView equivalent in Rebuild).
- [ ] **P6 — Remaining wallboards:** SLA Breach (agent-level), Key Accounts, Customer
  Success, Dev Review, Risk Board.
- [ ] **P7 — `JiraEodTicketStatusSnapshot` consumers:** confirm what still reads it;
  replicate in NOVA if needed (open-by-status EOD).

## RETIREMENT (after parity)
- [ ] Stop NOVA's old `kpi-pipeline.ts` legacy writes (the 4 jobs).
- [ ] Switch off n8n "Daily KPI Report v4" (KriwNYXfWcGBW7D7).
- [ ] Remove / redirect the old top-level "kpis" area.

## DROP / DEFER
Gamification · Live-vs-UAT comparison.

## Sequence
Phase 1 = B2 + P1 (extend the engine — mechanical, low risk, like today).
Phase 2 = B1 + P2 (operational duties so n8n can go dark).
Phase 3 = P3–P7 (UI/views/wallboards).
Phase 4 = Retirement.
