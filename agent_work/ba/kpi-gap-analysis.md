# KPI Rebuild — Gap Analysis (old engine vs new), 2026-06-07

What the LEGACY KPI engine has that the NEW rebuild does **not** yet. Built so far:
Org (Support/NT, 22 KPIs) · Wallboards rebuild (CC / Tech Support / SLA Breach / Support-All / KPI-Breach) ·
Agent engine (tiers 1–3) · daily capture into `kpi_org_daily` + `kpi_agent_daily` · 60s live snapshots.

## P0 — Parity blockers (needed before the new engine can replace the old)
| Gap | Old has | New status |
|-----|---------|-----------|
| **Org coverage** | All 17 teams + per-tier KPIs (CC Inc/SR/TPJ, Prod, T2, T3, Dev) | Only **Support/NT** (1 of 17). Other 3 Jira teams + 13 manual teams missing |
| **Historical / trends UI** | Daily History view + Trends view (17 metrics, checkpoint cols Last-Month/Day0/Day1/WTD/MTD/Day15/Day30, line charts, CSV) | We **store** daily rows but have **no history/trends UI** |
| **Weekly / monthly views** | Leaderboard + trends daily/weekly/monthly; WTD/MTD; Solved Today/Week/Month | We have daily + agent Solved Today/Week. **No dept or agent weekly/monthly rollup views** → JOB #3 |
| **Backfill** | backfillNovaAiKpis, backfill-agent-daily (from JiraEodTicketStatusSnapshot + QA/GR), backfill-status | **No backfill** — new tables only fill from first capture forward → JOB #2 |

## P1 — Important features (rich parity)
| Gap | Old has |
|-----|---------|
| **Leaderboard** | Rank by Combined/Productivity/SLA/Quality; composite 0–100; daily/weekly/monthly; team/tier filters |
| **Digests** | LLM daily + weekly narrative summaries (jira_kpi_digest), shown on dashboard |
| **Broader global KPIs** | FRT compliance % (per tier), Resolution compliance % (per tier), CSAT %, FCR rate, 1st-line resolution %, unassigned, waiting-on-requestor, AI tickets resolved / AI resolution rate, bug-ack time, survey scores (team/KAM/CSM), WTD % KPIs green/red |
| **Escalation accuracy report** | Escalation accuracy % + per-tier escalate/reject breakdown (EscalationReportView), manual rejection capture, Jira-changelog backfill |
| **QA views** | qa-summary, qa-agents, golden-rules detail/agents, call-QA (tone/confidence/knowledge/flow/satisfaction), coaching nudges, concerning-ticket drilldowns |

## P2 — Migration-only / nice-to-have
| Gap | Note |
|-----|------|
| Live vs UAT comparison | Migration/parity tool — likely **drop** in rebuild |
| Agent admin CRUD | Create/edit dbo.Agent rows |
| Drill-downs | Wallboard click → ticket list |
| Glossary, CSV export, auto-refresh toggle | Minor UX |
| Gamification | Deliberately **deferred** |

## Notes for the 3 jobs
- **Backfill (#2) is hard for STOCKS**: our engine computes open/over-SLA/oldest live from `jira_issue_cache`
  (current-state only) — there's no history. FLOWS (Solved, New, Escalated) CAN be recomputed historically
  (status-transition JQL `... DURING (dayX)`, escalation_log dates). Stock history must come from either the
  legacy daily tables (dbo.jira_kpi_daily / jira_agent_kpi_daily / JiraEodTicketStatusSnapshot) or be accepted
  as "from go-live forward only". → decision needed.
- **Weekly/monthly (#3) needs daily history**: aggregate `kpi_org_daily`/`kpi_agent_daily` per the rollup rule
  (flows=sum, stocks=avg/latest). Works going forward immediately; richer if backfilled (#2).
