# Checkpoint Evidence Panel — Expandable Tier Rows

## Status: Complete

## Tasks

- [x] Read existing CheckpointPanel component + API route
- [x] Update `CHECKPOINT_METRICS` in `trends.ts` — rename Dev Queue → Total Queue Size, Oldest Dev Ticket → Oldest Support Ticket
- [x] Add tier definitions to metrics config
- [x] Update `/api/trends/checkpoint` route to return `tiers` array per metric
- [x] Update `CheckpointData` interface in `TrendsView.tsx` to include tier breakdowns
- [x] Build expandable row UI in `CheckpointPanel` — chevron toggle, indented sub-rows, muted style
- [x] Apply RAG status colouring to tier sub-rows (same logic, per-tier targets or parent target)
- [x] Exclude non-expandable metrics (no per-tier data in DB)
- [x] Verify CSV export unchanged (no tier rows in export)
- [x] Build compiles cleanly (no new errors)
- [x] **Audited actual DB** via n8n workflow — confirmed which KPIs have per-tier data

## DB Audit Results (67 distinct KPIs in jira_kpi_daily)

### Metrics WITH per-tier data → expandable
| Metric | Tier KPIs in DB |
|--------|----------------|
| Total Queue Size | `Number of Tickets in CC (Incidents/SRs/TPJ)`, Production, Tier 2, Tier 3, Development |
| Oldest Support Ticket | `Oldest actionable ticket (days) in CC (Incidents/SRs/TPJ)`, Production, Tier 2, Tier 3, Development |

### Metrics WITHOUT per-tier data → flat rows
| Metric | Reason |
|--------|--------|
| FRT Compliance % | Only aggregate `FRT Compliance % (Open Queue)` exists |
| Resolution Compliance % | Only aggregate `Resolution Compliance % (Open Queue)` exists |
| Escalation Accuracy % | Only aggregate exists |
| Team QA Avg (V5) | Source: jira_qa_results (no tier column) |
| Golden Rules Avg % | Source: Jira_QA_GoldenRules (no tier column) |
| CSAT % | Only aggregate exists |
| FCR Rate % | Only aggregate exists |
| 1st Line Resolution Rate % | Aggregate only (by definition) |
| Bug Ack Time (hours) | Aggregate only |

### Other per-tier KPIs in DB (not used in checkpoint panel)
- FRT breached (actionable/not) — per tier
- Over SLA (actionable/not) — per tier
- No Reply tickets — per tier
- Escalation/rejection counts — to/by T2/T3/Dev

## Files Changed

- `src/server/routes/trends.ts` — TIERS const, expandable flags, aggregate SUM/MAX queries for queue/age, per-tier queries
- `src/client/components/TrendsView.tsx` — Expandable row UI with chevron, tier sub-rows, RAG colouring
