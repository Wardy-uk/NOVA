# KPI Dashboard Gap Closure — Progress Tracker

> Updated: 2026-03-20
> Plan: `kpi-gaps-plan.md`

---

## Gap 1 — Agent Leaderboard QA Score Column ✅
- [x] Add LEFT JOIN to `/agents` SQL query in kpi-data.ts
- [x] Return QAAvgScore and QACount in API response
- [x] Add QAAvgScore column to Agent interface in KpiDashboardView.tsx
- [x] Render QA column in leaderboard table with RAG coloring
- [x] Show `—` for agents with no QA data
- [ ] Test: verify scores match, null handling works

## Gap 2 — FRT/Resolution % Targets Are Zero ✅
- [x] Implement target fallback map in `/team-snapshot` for known KPIs with 0 targets
- [x] FRT/Resolution Compliance % → target 95, higher is better
- [x] Actionable SLA breach KPIs → target 0, lower is better
- [ ] Test: FRT and Resolution KPIs show non-zero targets with correct RAG

## Gap 3 — Per-Tier FRT/Resolution Split ✅
- [x] Identify FRT/Resolution KPI names per tier from snapshot data
- [x] Add "SLA Compliance by Tier" section to KpiDashboardView.tsx
- [x] Render compact table/cards: Tier | FRT % | Resolution % | RAG
- [ ] Test: section renders correctly with live data

## Gap 4 — QA Trend on KPI Dashboard ✅
- [x] Add QA Summary section to KpiDashboardView.tsx
- [x] Fetch from existing `/qa-summary` endpoint
- [x] Display: avg score, Green/Amber/Red %, total scored
- [x] RAG color the avg score (Green >= 2.4, Amber >= 1.8, Red < 1.8)
- [ ] Test: section renders, auto-refreshes

## Gap 5 — KPI Digest in UI ✅
- [x] Add "Weekly Digest" section to KpiDashboardView.tsx
- [x] Fetch from existing `/digest` endpoint
- [x] Render most recent entry (html if available, else plain text summary)
- [x] Handle "no digest" gracefully
- [ ] Test: digest displays, empty state works

## Gap 6 — CSAT Placeholder ✅
- [x] Add CSAT placeholder card to KPI Dashboard
- [x] Auto-detect if CSAT data exists in snapshot → render normally
- [x] Add code comment in kpi-data.ts for expected CSAT KPI name
- [ ] Test: placeholder shows when no data

## Gap 7 — FCR Placeholder ✅
- [x] Add FCR Rate placeholder card to KPI Dashboard
- [x] Auto-detect if FCR data exists in snapshot → render normally
- [x] Add code comment in kpi-data.ts for expected FCR KPI name
- [ ] Test: placeholder shows when no data

## Final
- [x] npm run build passes cleanly
- [ ] Push to both repos (GitHub + TFS)
- [ ] Test on live server after deploy
