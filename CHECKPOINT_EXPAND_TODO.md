# Checkpoint Evidence Panel — Expandable Tier Rows

## Status: Complete

## Expandable Metrics — Data Sources

| Metric | Expandable | Data Source | Method |
|--------|-----------|-------------|--------|
| FRT Compliance % | **Yes** | `jira_kpi_daily` | Derived: `(volume - FRT breaches) / volume * 100` per tier |
| Resolution Compliance % | **Yes** | `jira_kpi_daily` | Derived: `(volume - SLA breaches) / volume * 100` per tier |
| Escalation Accuracy % | **Yes** | `jira_kpi_daily` | Derived: `escalated / (escalated + rejected) * 100` per destination tier (T2, T3, Dev only — CC/Production don't receive escalations) |
| Team QA Avg (V5) | **Yes** | `jira_qa_results` JOIN `jira_agent_kpi_daily` | JOIN on `assigneeName = AgentName`, group by `TierCode` |
| Golden Rules Avg % | **Yes** | `Jira_QA_GoldenRules` JOIN `jira_agent_kpi_daily` | JOIN on `Updater = AgentName`, group by `TierCode` |
| Total Queue Size | **Yes** | `jira_kpi_daily` | Direct per-tier KPI patterns (already existed) |
| Oldest Support Ticket | **Yes** | `jira_kpi_daily` | Direct per-tier KPI patterns (already existed) |
| CSAT % | No | Aggregate only — no tier dimension |
| FCR Rate % | No | Aggregate only — no tier dimension |
| 1st Line Resolution Rate % | No | Flat by definition |
| Bug Ack Time (hours) | No | Flat by definition |

## TierCode Mapping (jira_agent_kpi_daily → our tiers)

| TierCode | Maps to |
|----------|---------|
| T1 | customer_care |
| NTL | production |
| TPJM | production |
| T2 | tier2 |
| AI | (excluded — not a support tier) |

Note: Tier 3 and Development have no agent TierCodes (agents don't sit in those tiers), so QA/GR sub-rows for those tiers will show `—`.

## KPI patterns used for derived compliance

### FRT Compliance per tier
- CC: `CC Incidents FRT breached (actionable)` + `CC Service Requests FRT breached (actionable)` + `CC (TPJ) FRT breached (actionable)` vs `Number of Tickets in CC%`
- Production: `Production FRT breached (actionable)` vs `Number of Tickets in Production%`
- T2/T3/Dev: same pattern

### Resolution Compliance per tier
- CC: `CC Incidents over SLA (actionable)` + `CC Service Requests over SLA (actionable)` + `CC (TPJ) over SLA (actionable)` vs `Number of Tickets in CC%`
- Production/T2/T3/Dev: same pattern

### Escalation Accuracy per tier
- T2: `Tickets escalated to Tier 2` / (`escalated` + `Tickets rejected by Tier 2`)
- T3: same pattern
- Dev: same pattern
- CC/Production: N/A (don't receive escalations)
