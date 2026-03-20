# Wallboard Tile Drill-Down — Implementation Plan

## Goal
Add click-to-drill-down to every tile on all 4 NOVA wallboards. Clicking a tile opens a side panel showing the matching tickets. **No changes** to wallboard layout, styling, or content.

## Current Architecture
All 4 wallboards are **server-rendered HTML** pages displayed in iframes:

| Tab | Route | Structure | Data Source |
|-----|-------|-----------|-------------|
| SLA Breach Board | `/wallboard/breached` | 3 summary cards + agent table | SQL Server `dbo.Agent` |
| KPI Breach Board | `/wallboard/team-kpis` | 5 summary cards + KPI table | SQL Server `dbo.KpiSnapshot` |
| Customer Care | `/wallboard/cc` | 9 tiles (3 tiers × 3 metrics) | SQL Server `dbo.KpiSnapshot` |
| Technical Support | `/wallboard/tech-support` | 9 tiles (3 tiers × 3 metrics) | SQL Server `dbo.KpiSnapshot` |

Tile counts come from SQL Server KPI snapshots (populated by n8n workflow `pBrRdWYxtYFy4mGh`).
Actual ticket data lives in Jira, accessible via `fetchServiceDeskTickets('all')`.

## N8N KPI Engine — How Tiles Are Calculated

Source: n8n workflow "Daily KPI Report v3.1" → "Parse All Open" code node.

### Key fields
- **Current Tier**: `customfield_12981` — values: "Customer Care", "Production", "Tier 2", "Tier 3", "Development"
- **Request Type**: `customfield_13482` — values: "Incident", "Chat", "AI Request", "Emailed Request", "GDPR", "Service Request", "TPJ Request", "Onboarding" (excluded)

### CC bucket logic (all tier = "Customer Care")
- **CC (Incidents)**: request type ∈ {Incident, Chat, AI Request, Emailed Request, GDPR}
- **CC (Service Requests)**: request type = "Service Request"
- **CC (TPJ)**: request type = "TPJ Request"

### Metric logic
- **Total (volume)**: All open tickets matching tier + bucket
- **No Reply**: Same filter + `isNoReply()` — status ≠ "Waiting on Requestor", created ≥ 4h ago, Agent Next Update not in future, Agent Last Updated not today, within 52-week window
- **Over SLA (actionable)**: Same filter + Resolution SLA breached + due date OK + status in actionable set (Open, Reopened, Work in Progress)

### Tech Support (no bucket subdivision — just tier)
| Tier | Tiers for "No Reply" | Tiers for "Over SLA" |
|------|---------------------|---------------------|
| Production | Production | Production |
| Tier 2 | Tier 2 | Tier 2 |
| Development | Tier 3 (note: different!) | Development |

## Approach

### 1. Make tiles clickable (server-rendered HTML changes)
Add `data-kpi` attribute, `cursor:pointer`, and `onclick` handler to each tile. On click, send `window.parent.postMessage(...)` to the parent NOVA app.

- **CC + Tech Support** (`renderStatWallboard`): Each tile div gets onclick → postMessage with KPI name.
- **SLA Breach Board**: Agent table rows get onclick → postMessage with agent name.
- **KPI Breach Board**: KPI table rows get onclick → postMessage with KPI name.

### 2. New API endpoint: `GET /api/tasks/service-desk/wallboard/drill-down`
Accepts `?kpi=<KPI name>` query param. Maps KPI name to Jira filter criteria server-side.

**CC Wallboard tile → filter mapping:**

| KPI name | Tier | Request Types | Metric |
|----------|------|---------------|--------|
| `Number of Tickets in CC (Incidents)` | Customer Care | Incident, Chat, AI Request, Emailed Request, GDPR | total |
| `Number of Tickets in CC (Service Requests)` | Customer Care | Service Request | total |
| `Number of Tickets in CC (TPJ)` | Customer Care | TPJ Request | total |
| `Number of Tickets With No Reply in CC (Incidents)` | Customer Care | Incident, Chat, AI Request, Emailed Request, GDPR | no_reply |
| `Number of Tickets With No Reply in CC (Service Requests)` | Customer Care | Service Request | no_reply |
| `Number of Tickets With No Reply in CC (TPJ)` | Customer Care | TPJ Request | no_reply |
| `CC Incidents over SLA (actionable)` | Customer Care | Incident, Chat, AI Request, Emailed Request, GDPR | sla_breached |
| `CC Service Requests over SLA (actionable)` | Customer Care | Service Request | sla_breached |
| `CC TPJ over SLA (actionable)` | Customer Care | TPJ Request | sla_breached |

**Tech Support tile → filter mapping:**

| KPI name | Tier | Metric |
|----------|------|--------|
| `Number of Tickets in Production` | Production | total |
| `Number of Tickets in Tier 2` | Tier 2 | total |
| `Number of Tickets in Development` | Development | total |
| `Number of Tickets With No Reply in Production` | Production | no_reply |
| `Number of Tickets With No Reply in Tier 2` | Tier 2 | no_reply |
| `Number of Tickets With No Reply in Tier 3` | Tier 3 | no_reply |
| `Production over SLA (actionable)` | Production | sla_breached |
| `Tier 2 over SLA (actionable)` | Tier 2 | sla_breached |
| `Development over SLA (actionable)` | Development | sla_breached |

**SLA Breach Board**: Filter by Jira assignee matching the agent name from the clicked row.

**KPI Breach Board**: KPI rows that map to ticket-count KPIs use the same mapping tables above. KPIs that don't map to tickets (percentages, oldest days, etc.) show a "No ticket drill-down available for this KPI" message.

### 3. Drill-down side panel component (`WallboardDrillPanel.tsx`)
- Slide-out panel on the right (same pattern as existing drawers)
- Shows list of matching tickets with: Jira key (linked), summary, status, assignee, priority, SLA remaining, age
- Mounted once in App.tsx, triggered by postMessage from any wallboard iframe

### 4. PostMessage listener in App.tsx
- `useEffect` with `window.addEventListener('message', handler)`
- Receives `{ type: 'wallboard-drill', kpi: '...' }` from iframe
- Sets state to open drill panel + passes KPI to it

## Key Decisions
- **No wallboard visual changes** — only add click interactivity
- **Ticket data fetched live from Jira** via existing `fetchServiceDeskTickets('all')`
- **PostMessage bridge** between iframe and parent NOVA app
- **KPI → filter mapping lives server-side** in the drill-down API endpoint
- **Request type field is `customfield_13482`** (confirmed from n8n KPI engine)
- **CC Incidents includes Chat, AI Request, Emailed Request, GDPR** (not just "Incident")

## Open Question
- For SLA Breach Board agent rows: does the agent name in SQL Server (`AgentName + AgentSurname`) match the Jira assignee `displayName` exactly?
