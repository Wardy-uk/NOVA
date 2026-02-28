# N.O.V.A (Nurtur Operational Virtual Assistant)

A single-pane-of-glass operational dashboard that aggregates tasks, tickets, emails, and calendar events from multiple sources into a unified workspace with AI-powered insights, delivery pipeline tracking, and onboarding automation.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Vite 6 |
| Backend | Express v5 (Node.js), TypeScript |
| Database | sql.js (WASM SQLite, in-memory with file persistence) |
| Integrations | MCP SDK (Jira, MS365, Monday.com), Dataverse API (D365) |
| AI | OpenAI GPT-4o-mini (standups, next-action suggestions, chat) |
| Auth | JWT + bcrypt, optional Entra ID SSO, Jira OAuth 3LO |

## Features

| Area | Description |
|------|-------------|
| **My NOVA** | Dashboard with AI standup rituals, conversational chat, task prioritisation, team workload view |
| **Service Desk** | Dashboard KPIs, Kanban with Jira drag-and-drop transitions, calendar view, ownership filters |
| **Onboarding** | Ticket automation matrix, bulk Jira ticket creation, milestone calendar |
| **Delivery** | Pipeline tracker with milestones, linked tickets, CRM autocomplete, xlsx/SharePoint sync |
| **CRM** | Dynamics 365 account management with RAG status reviews |
| **Admin** | Users, teams, roles, permissions, audit log, integrations, milestones, onboarding config, feedback |
| **Notifications** | Bell icon with alerts for SLA breaches, overdue milestones, upcoming deliveries |

## Integrations

| Source | Method | Data |
|--------|--------|------|
| Jira | MCP (`mcp-atlassian`) | Tickets, transitions, comments, Service Desk |
| Microsoft 365 | MCP (`@softeria/ms-365-mcp-server`) | Planner, To-Do, Calendar, Email, OneDrive |
| Monday.com | MCP (`@mondaydotcomorg/monday-mcp-server`) | Boards, tasks |
| Dynamics 365 | Dataverse Web API (`@azure/msal-node`) | CRM accounts, contacts |
| SharePoint | Via MS365 MCP | Delivery spreadsheet sync (push/pull) |

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (API on :3001, Vite on :5173)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Reset database
npm run db:reset
```

On first load, you'll be prompted to create an admin account.

## Configuration

Integration credentials are configured through the UI:

- **My Settings** -- Personal integrations (Jira, MS365, Monday.com), Jira OAuth, AI key override
- **Admin > Integrations** -- Global integrations (D365, SSO, Jira service account, Jira OAuth app)
- **Admin > AI Keys** -- Global OpenAI API key

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `JWT_SECRET` | JWT signing secret | Random (dev only) |
| `DATA_DIR` | Database file location | Project root |
| `FRONTEND_URL` | Frontend URL for SSO callback | `http://localhost:5173` |

## Project Structure

```
src/
  client/
    App.tsx                   # Root component, area routing, auth gate
    components/               # 35+ React components
    hooks/                    # useTasks, useAuth, useTheme, useIntegrations
    utils/                    # Task helpers, formatters
  server/
    index.ts                  # Express server, route mounting, sync timers
    middleware/auth.ts         # JWT Bearer token verification
    db/
      schema.ts               # DDL, migrations, indexes, seed data
      queries.ts              # Query classes (Tasks, Rituals, Settings, Delivery, CRM, Users, Feedback)
      audit.ts                # Audit log queries
      notifications.ts        # Notification queries
    routes/
      auth.ts                 # Login, register, SSO (Entra ID), Jira OAuth 3LO
      tasks.ts                # Task CRUD, stats, service desk search, SD dashboard
      delivery.ts             # Delivery pipeline, xlsx import, SharePoint sync, linked tickets
      dynamics365.ts           # D365 CRM sync, purge & re-sync
      milestones.ts           # Delivery milestone management
      onboarding.ts           # Jira ticket orchestration
      onboarding-config.ts    # Onboarding matrix configuration
      feedback.ts             # User feedback with admin reply
      settings.ts             # User and global settings
      admin.ts                # User/team/role management
      crm.ts                  # CRM customers + reviews
      team.ts                 # Team workload aggregation
      notifications.ts        # Notification CRUD + check
      chat.ts                 # Conversational AI chat
      audit.ts                # Activity audit log
      standups.ts             # AI standup rituals
      actions.ts              # AI next-action suggestions
    services/
      aggregator.ts           # Multi-source task sync engine (6 adapters)
      mcp-client.ts           # MCP server connection manager
      dynamics365.ts          # Dataverse API client
      integrations.ts         # Integration definitions + MCP config
      ai-actions.ts           # OpenAI task analysis
      ai-standup.ts           # OpenAI standup generation
      jira-client.ts          # Direct Jira REST v3 (onboarding automation, OAuth bearer)
      jira-oauth.ts           # Jira OAuth 3LO service (PKCE)
      entra-sso.ts            # Entra ID SSO auth flow
      chat-service.ts         # Conversational AI with context-aware prompts
      notification-engine.ts  # Notification generation (SLA, milestones, deliveries)
deploy/
  deploy.ps1                  # Git pull + build + restart service
  install-service.ps1         # NSSM Windows Service setup
  setup-iis-site.ps1          # IIS reverse proxy configuration
```

## Database

Uses `sql.js` (SQLite compiled to WASM). The database file `daypilot.db` is stored at the project root (or `DATA_DIR`).

### Tables

| Table | Purpose |
|-------|---------|
| `tasks` | Aggregated tasks from all sources (transient flag for session-only MS365 data) |
| `rituals` | AI standup outputs (morning/replan/eod) |
| `settings` | Key-value configuration |
| `delivery_entries` | Delivery pipeline entries |
| `delivery_milestones` | Per-delivery milestone instances |
| `milestone_templates` | Milestone definitions (30-day model) |
| `milestone_sale_type_offsets` | Milestone day offsets per sale type |
| `crm_customers` | CRM customer records with RAG status |
| `crm_reviews` | Business review history |
| `users` | Auth accounts (local + SSO) |
| `user_settings` | Per-user preferences |
| `user_task_pins` | Per-user pinned tasks |
| `teams` | Team definitions |
| `feedback` | User feedback with admin reply |
| `onboarding_sale_types` | Sale type definitions |
| `onboarding_capabilities` | Capability definitions |
| `onboarding_matrix` | Sale type x capability matrix |
| `onboarding_capability_items` | Capability sub-items |
| `onboarding_ticket_groups` | Jira ticket groupings |
| `onboarding_runs` | Ticket creation run history |
| `audit_log` | Activity audit trail (entity, action, user, changes) |
| `notifications` | User notifications (SLA breach, overdue, upcoming) |

Schema migrations run automatically on startup via `ALTER TABLE` wrapped in try/catch.

## Deployment

Deployed on Windows Server via IIS reverse proxy to Node.js, managed as a Windows Service (NSSM).

```powershell
# On the server (C:\Nurtur\NOVA)
.\deploy\deploy.ps1 -Branch nova-codex
```

This pulls latest code, runs `npm ci`, builds, and restarts the service.

## Security

- Helmet HTTP security headers
- Rate limiting on login/register (15 attempts per 15 min)
- JWT auth on all `/api/*` routes (except `/api/auth/*`)
- Debug endpoints gated behind admin role
- Role-based access control with configurable permissions per area

## Key Patterns

- **Task IDs** are composite: `${source}:${source_id}` (e.g., `jira:PROJ-123`)
- **MCP tool calls** use candidate-list fallback for cross-version compatibility
- **Database writes** call `saveDb()` to flush WASM in-memory state to disk
- **Transient tasks** -- MS365 sources are session-only, purged on server restart
- **Stale cleanup** is source-aware: skips when 0 tasks returned from a source
- **Onboarding orchestrator** is idempotent and resume-safe via onboardingRef lookup

## License

Private -- internal use only.
