# KPI Dashboard Gap Closure — Implementation Plan

> Source: `C:\Users\NickW\Documents\Nicks knowledge base\Projects\NOVA KPI Dashboard Gaps.md`
> Codebase: `C:\Users\NickW\Claude\windows automation\daypilot`
> Created: 2026-03-20

---

## Key Findings from Codebase Audit

- **KPITarget is embedded in `dbo.KpiSnapshot`** — there is NO separate `dbo.KpiTargets` table in the codebase. Targets come from the `KPITarget` column in the snapshot rows themselves (set by n8n).
- **RAG is pre-calculated** — the `RAG` column in KpiSnapshot already has 1/2/3 values. The dashboard just renders them.
- **Color tokens** exist in `KpiDashboardView.tsx` as `C.green`, `C.amber`, `C.red`, `C.teal`, etc.
- **Agent leaderboard** is at lines 582-805 in `KpiDashboardView.tsx`. The `/agents` endpoint in `kpi-data.ts` queries `dbo.Agent` with optional column detection.
- **`/qa-summary`** endpoint already exists (lines 244-269 in kpi-data.ts) — returns avgScore, green/amber/red counts, etc.
- **`/digest`** endpoint already exists (lines 446-463) — returns period, summary, html, CreatedAt.

---

## Implementation Order

### Gap 1 — Agent Leaderboard QA Score Column (HIGHEST PRIORITY)
**Files:** `kpi-data.ts` (server), `KpiDashboardView.tsx` (client)
**Approach:**
1. Add LEFT JOIN to `/agents` endpoint SQL query joining `dbo.jira_qa_results` on agent full name
2. Return `QAAvgScore` and `QACount` in the response
3. Add `QAAvgScore` column to leaderboard table in the client component
4. RAG color: Green >= 2.5, Amber >= 1.5, Red < 1.5, `—` if null

### Gap 2 — FRT % and Resolution % Targets Are Zero
**Files:** `kpi-data.ts` (server investigation)
**Approach:**
1. Since targets are in `KpiSnapshot.KPITarget` (not a separate table), the issue is that n8n is writing 0 or null as the target value
2. Check current KPITarget values for FRT/Resolution KPIs via a diagnostic query
3. If targets are 0/null in the data, we need to handle this client-side: hardcode known targets as fallbacks when KPITarget is 0
4. Add a target fallback map in the `/team-snapshot` route for known KPIs with missing targets

### Gap 3 — Per-Tier FRT/Resolution Split
**Files:** `KpiDashboardView.tsx` (client)
**Approach:**
1. Add new "SLA Compliance by Tier" section between KPI Overview and Agent Leaderboard
2. Filter existing snapshot data for KPIs matching FRT/Resolution patterns per tier
3. Render as a compact table: Tier | FRT % | Resolution % | RAG

### Gap 4 — QA Trend on KPI Dashboard
**Files:** `KpiDashboardView.tsx` (client)
**Approach:**
1. Add "QA Summary" card section after SLA Compliance by Tier
2. Fetch from existing `/api/kpi-data/qa-summary?env=${env}&days=7` endpoint
3. Display: Overall avg score, Green/Amber/Red %, Total scored
4. RAG the avg: Green >= 2.4, Amber >= 1.8, Red < 1.8

### Gap 5 — KPI Digest in UI
**Files:** `KpiDashboardView.tsx` (client)
**Approach:**
1. Add "Weekly Digest" section at bottom of KPI Dashboard
2. Fetch from existing `/api/kpi-data/digest?env=${env}&days=7`
3. Show most recent entry: period, summary/html, CreatedAt
4. Render html if populated, else render summary as plain text

### Gap 6 — CSAT Placeholder
**Files:** `KpiDashboardView.tsx` (client), optionally `kpi-data.ts`
**Approach:**
1. Add placeholder card in dashboard: "CSAT — Not yet configured"
2. Check if any KpiSnapshot row has KPI containing "CSAT" — if so, render it normally
3. Add code comment in kpi-data.ts documenting expected CSAT KPI name

### Gap 7 — FCR Placeholder
**Files:** `KpiDashboardView.tsx` (client), optionally `kpi-data.ts`
**Approach:**
1. Same pattern as Gap 6: placeholder card "FCR Rate — Pipeline not yet configured"
2. Check if any KpiSnapshot row has KPI containing "FCR" — if so, render it normally
3. Add code comment in kpi-data.ts documenting expected FCR KPI name

---

## SQL Guardrails
**DO NOT touch:** JiraSlaRaw, JiraSlaRawArchive, JiraSlaRawArchiveOld, JiraSlaRawOld, JiraTickets, JiraTicketsArchive, JiraTicketsUAT

## Dev Constraints
- CommonJS only (no ESM, no Bun, no top-level await outside async)
- Use existing color tokens (C.green, C.amber, etc.)
- Parameterised SQL queries for user input
- Keep `/agents` JOIN efficient (30-day window + GROUP BY on 18k rows)
