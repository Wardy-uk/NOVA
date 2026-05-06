# nova-mcp

MCP server for NOVA — HTTP API client for KPI analysis, AI agent management, and full raw data access.

## Setup

```bash
npm install
npm run build
```

Create `config.json` in the project root:

```json
{
  "nova_api_url": "https://nova.nurtur.tech",
  "nova_username": "...",
  "nova_password": "..."
}
```

## Usage

```bash
npm start        # production (compiled)
npm run dev      # development (tsx)
```

## Tools (89)

### KPI Analysis (13)

| Tool | Description |
|------|-------------|
| `nova_trend_analysis` | KPI trend over time with week-over-week change, rolling average, breach periods |
| `nova_agent_comparison` | Compare agents on 23 metrics (QA, Golden Rules, SLA, CSAT, volume) |
| `nova_focus_areas` | Cross-reference KPIs/QA/Golden/SLA to surface top 5 areas needing attention |
| `nova_qa_deep_dive` | Deep QA analysis: distribution, dimensions, categories, coaching priorities |
| `nova_sla_breakdown` | SLA compliance analysis by tier with over-SLA counts |
| `nova_checkpoint_summary` | Live vs UAT data comparison |
| `nova_raw_kpi_query` | Low-level KPI daily data fetch by LIKE pattern |
| `nova_admin_get_config` | Read NOVA settings (masked) |
| `nova_admin_set_setting` | Write a single NOVA setting (dry-run by default) |
| `nova_team_snapshot` | Current live KPI values — all KPIs with targets and RAG status |
| `nova_eod_snapshot` | End-of-day KPI values for a specific historical date |
| `nova_agent_daily` | Per-agent daily time series (volume, QA, Golden Rules, SLA, CSAT) |
| `nova_agent_leaderboard` | Current agent stats — open tickets, solved, availability, QA scores |

### QA Tools (4)

| Tool | Description |
|------|-------------|
| `nova_qa_results` | Individual ticket-level QA scores (paginated) |
| `nova_qa_agents` | QA score breakdown per agent with RAG distribution |
| `nova_golden_rules` | Golden Rules summary, results, or per-agent (3 views) |
| `nova_kpi_digest` | AI-generated KPI narrative summary |

### Trend Tools (4)

| Tool | Description |
|------|-------------|
| `nova_sla_trend` | SLA compliance trend (daily/weekly) |
| `nova_queue_trend` | Queue volume trend by tier (daily/weekly) |
| `nova_qa_trend` | QA score trend with optional agent filter |
| `nova_escalation_trend` | Escalation volume and accuracy trend |

### Operational Tools (4)

| Tool | Description |
|------|-------------|
| `nova_backlog` | Read backlog board (columns + items) or single item |
| `nova_manager_overview` | Manager dashboard — team overview with alerts |
| `nova_coaching_prep` | Generate 1-2-1 coaching prep or save snapshot |
| `nova_hygiene_status` | Queue hygiene check status |

### AI Agent Tools (20)

| Tool | Description |
|------|-------------|
| `nova_agent_status` | Agent loop status, health, stats |
| `nova_agent_decisions` | Decision history with confidence scores |
| `nova_agent_costs` | LLM cost breakdown by model/mode |
| `nova_agent_flagged` | High-risk flagged tickets |
| `nova_agent_approvals` | Pending/approved/declined approvals |
| `nova_agent_coaching` | Coaching scores and nudge history |
| `nova_agent_kb_gaps` | Knowledge base gaps by category |
| `nova_agent_alerts` | Anomalies and threshold breaches |
| `nova_agent_lifecycle` | Ticket lifecycle state breakdown |
| `nova_agent_providers` | LLM provider usage stats |
| `nova_agent_suggestions` | AI-generated rule improvement suggestions |
| `nova_agent_guardrails` | Safety check rules |
| `nova_agent_autonomy` | Auto-approval conditions |
| `nova_agent_start` | Start agent loop |
| `nova_agent_stop` | Stop agent loop |
| `nova_agent_pause` | Pause agent loop |
| `nova_agent_approve` | Approve pending action |
| `nova_agent_decline` | Decline pending action |
| `nova_agent_dismiss_flag` | Dismiss flagged ticket |
| `nova_agent_setting` | Update agent lifecycle setting |

### MI Report Tools (2)

| Tool | Description |
|------|-------------|
| `nova_mi_report` | Full monthly MI report |
| `nova_mi_commentary` | Read/write MI commentary narrative |

### Backlog Management Tools (6)

| Tool | Description |
|------|-------------|
| `nova_backlog_list` | List items grouped by column with filters |
| `nova_backlog_add` | Add new backlog item |
| `nova_backlog_update` | Update backlog item fields |
| `nova_backlog_move` | Move item between columns |
| `nova_backlog_remove` | Delete backlog item |
| `nova_backlog_columns` | List/add/rename/delete/reorder columns |

### AI Learning Tools (2)

| Tool | Description |
|------|-------------|
| `nova_agent_submit_learning` | Submit correction/learning for AI agent |
| `nova_agent_learnings` | List active AI learnings |

### KPI Data Gaps (8) — v4.0

| Tool | Description |
|------|-------------|
| `nova_kpi_agent_detail` | Detailed per-agent KPI metrics (full field set) |
| `nova_kpi_qa_scores` | Raw QA score data before aggregation |
| `nova_kpi_team` | Team-wide aggregate KPIs |
| `nova_kpi_breached` | SLA-breached tickets |
| `nova_kpi_snapshot_compare` | Compare two date snapshots side-by-side |
| `nova_kpi_call_qa` | Call recording QA (summary/agents/results) |
| `nova_kpi_dedup` | Duplicate ticket analysis |
| `nova_kpi_backfill_status` | Data backfill progress |

### People & Roster (3) — v4.0

| Tool | Description |
|------|-------------|
| `nova_people_roster` | Team roster, calendar, survey scores |
| `nova_people_agent` | Individual agent profile, plan, snapshots, actions, calendar, aged tickets |
| `nova_team_workload` | Team workload distribution |

### Pipeline & Data Quality (4) — v4.0

| Tool | Description |
|------|-------------|
| `nova_pipeline` | n8n pipeline monitoring (stats/runs/drift/compare) |
| `nova_data_audit` | Data quality audit trail |
| `nova_ai_trend` | AI agent performance trend |
| `nova_checkpoint` | Data checkpoint validation |

### Escalation & Problem Tickets (3) — v4.0

| Tool | Description |
|------|-------------|
| `nova_escalations` | Escalation list and stats |
| `nova_problem_tickets` | Problem ticket detection (list/stats/config/scan-status/detail) |
| `nova_escalation_reasons` | Escalation reason categories and T2 agents |

### Agent Intelligence (5) — v4.0

| Tool | Description |
|------|-------------|
| `nova_agent_workspace` | AI agent workspace queue and ticket detail |
| `nova_agent_classifications` | Ticket classification data and breakdown |
| `nova_agent_confidence` | Confidence scores, overrides, auto-rules |
| `nova_ai_improvement` | AI improvement stats, comparisons, signals |
| `nova_agent_coaching_detail` | Per-agent coaching data |

### Dev Review & Surveys (3) — v4.0

| Tool | Description |
|------|-------------|
| `nova_dev_review` | Dev review queue, dashboard, outbox, ticket detail |
| `nova_surveys` | Surveys and CSAT (list/teams/categories/satisfaction/detail) |
| `nova_standups` | Standup data (today/cached/history) |

### Admin & Audit (4) — v4.0

| Tool | Description |
|------|-------------|
| `nova_audit_log` | System audit trail |
| `nova_admin_data` | Admin reference data (users/teams/products/roles) |
| `nova_settings` | System settings and feature flags |
| `nova_training` | Training data (summary/categories/items/scores/users) |

### Remaining Coverage (4) — v4.0

| Tool | Description |
|------|-------------|
| `nova_my_tickets` | Ticket queues, events, defers per agent |
| `nova_gamification` | Leaderboard, profiles, achievements, points |
| `nova_milestones` | Milestone tracking (summary/matrix/calendar/overdue/templates/delivery) |
| `nova_feedback` | Internal feedback records |
