# Checkpoint Evidence Panel — Expandable Tier Rows

## Status: Complete

## Tasks

- [x] Read existing CheckpointPanel component + API route
- [x] Update `CHECKPOINT_METRICS` in `trends.ts` — rename Dev Queue → Total Queue Size, Oldest Dev Ticket → Oldest Support Ticket
- [x] Add tier definitions to metrics config
- [x] Update `/api/trends/checkpoint` route to return `tiers` array per metric (with TODO placeholders where data doesn't exist)
- [x] Update `CheckpointData` interface in `TrendsView.tsx` to include tier breakdowns
- [x] Build expandable row UI in `CheckpointPanel` — chevron toggle, indented sub-rows, muted style
- [x] Apply RAG status colouring to tier sub-rows (same logic, per-tier targets or parent target)
- [x] Exclude `1st Line Resolution Rate %` and `Bug Ack Time (hours)` from expand behaviour
- [x] Verify CSV export unchanged (no tier rows in export)
- [x] Build compiles cleanly (no new errors)

## Tier Definitions

| Tier | Description |
|------|-------------|
| Customer Care | 1st Line |
| Production | Escalated/managed tickets |
| Tier 2 | |
| Tier 3 | |
| Development | |

## Metrics with expand behaviour

| Metric | Expandable | Notes |
|--------|-----------|-------|
| FRT Compliance % | Yes | Tier data: TODO placeholder |
| Resolution Compliance % | Yes | Tier data: TODO placeholder |
| Escalation Accuracy % | Yes | Tier data: TODO placeholder |
| Team QA Avg (V5) | Yes | Tier data: TODO placeholder |
| Golden Rules Avg % | Yes | Tier data: TODO placeholder |
| Total Queue Size (was Dev Queue Size) | Yes | **LIVE DATA** — SUM of per-tier ticket counts |
| Oldest Support Ticket (was Oldest Dev Ticket) | Yes | **LIVE DATA** — MAX across per-tier oldest |
| CSAT % | Yes | Tier data: TODO placeholder |
| FCR Rate % | Yes | Tier data: TODO placeholder |
| 1st Line Resolution Rate % | **No** | Flat row |
| Bug Ack Time (hours) | **No** | Flat row |

## Files Changed

- `src/server/routes/trends.ts` — Added TIERS const, `expandable`/`tierPatterns` fields on metrics, aggregate queries (SUM/MAX) for renamed metrics, per-tier queries for queue/age metrics, TODO placeholders for other expandable metrics
- `src/client/components/TrendsView.tsx` — New interfaces (`TierData`, `CheckpointMetricData`), expandable row UI with chevron toggle, tier sub-rows with muted style + RAG colouring

## Data Notes

- **Total Queue Size** and **Oldest Support Ticket** have real per-tier KPI patterns in `jira_kpi_daily` and are wired to live data
- All other expandable metrics return `null` for tier breakdowns (displayed as `—`) with `// TODO: wire tier data` comments in the route
- CSV export is unchanged — only parent rows are exported
