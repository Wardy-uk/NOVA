# N.O.V.A — Nurtur Operational Virtual Assistant

A single-pane-of-glass operational dashboard that aggregates tasks from Jira, Microsoft 365 (Planner, To-Do, Calendar, Email), and Monday.com. Powered by AI standup rituals, a delivery pipeline tracker, CRM, and KPI dashboards.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Vite 6 |
| Backend | Express v5 (Node.js), TypeScript |
| Database | sql.js (WASM SQLite) |
| Integrations | MCP SDK (Jira via `mcp-atlassian`, MS Graph, Monday) |
| AI | OpenAI GPT-4o-mini (standups, next-action suggestions) |
| Auth | JWT + bcrypt, first-user admin setup |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.template .env
# Edit .env with your credentials (see Configuration below)

# 3. Start development servers
npm run dev
```

This runs:
- **API server** on `http://localhost:3001` (Express)
- **Dev server** on `http://localhost:5173` (Vite, proxies `/api` to 3001)

On first load, you'll be prompted to create an admin account.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both servers (concurrently) |
| `npm run dev:server` | API server only (tsx watch) |
| `npm run dev:client` | Vite dev server only |
| `npm run build` | Production build (Vite + tsc) |
| `npm start` | Run production build |
| `npm run db:reset` | Reset database schema |

## Configuration

Copy `.env.template` to `.env` and configure:

### Required

| Variable | Description |
|----------|-------------|
| `PORT` | API server port (default: `3001`) |

### Jira

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | Your Atlassian instance URL |
| `JIRA_PERSONAL_TOKEN` | Jira Personal Access Token |

Jira connects via `mcp-atlassian` (installed with `uvx`). The server auto-detects available tools and uses a fallback pattern to handle different MCP tool versions.

### Microsoft 365

| Variable | Description |
|----------|-------------|
| `MS365_MCP_CLIENT_ID` | Azure AD app registration client ID |
| `MS365_MCP_TENANT_ID` | Tenant ID (default: `common`) |

Requires an Azure AD app registration with delegated permissions: `Tasks.Read`, `Calendars.Read`, `Mail.Read`, `User.Read`. Enable "Allow public client flows" for device-code auth.

Alternatively, M365 data can be synced via **Power Automate Cloud flows** that write JSON to OneDrive. See `docs/power-automate-cloud-flows.md`.

### Monday.com

| Variable | Description |
|----------|-------------|
| `MONDAY_API_TOKEN` | Monday.com Personal API Token |
| `MONDAY_BOARD_IDS` | Optional: comma-separated board IDs to limit sync |

### AI Features

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (configured in Settings UI) |

The API key can also be set via the Settings page at runtime. Used for standup rituals and next-action suggestions.

## Architecture

```
src/
├── client/                    # React frontend
│   ├── App.tsx                # Root component, view routing, auth gate
│   ├── main.tsx               # React entry point
│   ├── hooks/                 # useAuth, useTasks, useTheme, useIntegrations
│   ├── components/            # All UI views and components
│   └── styles/globals.css     # Tailwind v4 theme variables
├── server/
│   ├── index.ts               # Express bootstrap, route mounting, sync timers
│   ├── middleware/auth.ts      # JWT Bearer token verification
│   ├── db/
│   │   ├── schema.ts          # DDL, migrations, index seeds
│   │   └── queries.ts         # Query classes (Tasks, Rituals, Settings, Delivery, CRM, Users)
│   ├── routes/                # Express route handlers
│   │   ├── auth.ts            # Login, register, first-run setup
│   │   ├── tasks.ts           # Task CRUD + stats + sync trigger
│   │   ├── jira.ts            # Jira MCP tool calls (issues, transitions, users)
│   │   ├── o365.ts            # MS Graph Planner + To-Do create/update
│   │   ├── delivery.ts        # Delivery pipeline (xlsx + DB entries)
│   │   ├── crm.ts             # CRM customers + reviews
│   │   ├── standups.ts        # AI standup rituals (morning/replan/eod)
│   │   ├── actions.ts         # AI next-action suggestions
│   │   ├── settings.ts        # Key-value settings
│   │   ├── integrations.ts    # Integration credential management
│   │   ├── health.ts          # Health check + MCP server status
│   │   └── ingest.ts          # Power Automate bulk task ingestion
│   └── services/
│       ├── aggregator.ts      # 6 source adapters + stale task cleanup
│       ├── ai-actions.ts      # GPT-4o-mini next-action suggestions
│       ├── ai-standup.ts      # GPT-4o-mini standup ritual generation
│       ├── integrations.ts    # Integration definitions + MCP config
│       ├── mcp-client.ts      # MCP SDK client lifecycle
│       └── onedrive-watcher.ts# OneDrive folder polling for PA Cloud
└── shared/
    └── types.ts               # Zod schemas + shared TypeScript interfaces
```

### Key Patterns

- **Task IDs** are composite: `${source}:${source_id}` (e.g., `jira:PROJ-123`)
- **MCP tool calls** use a candidate-list fallback — tries multiple tool name variants to handle different MCP server versions
- **Database writes** call `saveDb()` to flush WASM in-memory state to disk
- **Stale cleanup** is source-aware: task sources (Jira, Planner, Monday) skip cleanup when 0 tasks returned; ephemeral sources (calendar, email) allow full purge
- **Per-source sync intervals** — each integration has its own configurable polling interval, falling back to the global default (5 min)

## Database

Uses `sql.js` (SQLite compiled to WASM). The database file `daypilot.db` is stored at the project root.

### Tables

| Table | Purpose |
|-------|---------|
| `tasks` | Aggregated tasks from all sources |
| `rituals` | AI standup ritual outputs (morning/replan/eod) |
| `settings` | Key-value configuration |
| `delivery_entries` | Delivery pipeline entries (DB-backed) |
| `crm_customers` | CRM customer records with RAG status |
| `crm_reviews` | Business review history per customer |
| `users` | Auth accounts (JWT, bcrypt) |

Schema migrations run automatically on startup via `ALTER TABLE` wrapped in try/catch (safe for existing databases).

## API Routes

All routes under `/api/*` (except `/api/auth/*`) require a JWT Bearer token.

### Core

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/login` | Authenticate, returns JWT |
| `POST /api/auth/register` | Create account (open on first run) |
| `GET /api/tasks` | List tasks (filters: `?status=`, `?source=`) |
| `GET /api/tasks/stats` | Aggregated statistics |
| `POST /api/tasks/sync` | Trigger full sync |
| `GET /api/health` | Server + MCP connection health |

### Jira

| Endpoint | Description |
|----------|-------------|
| `GET /api/jira/issues/:key` | Fetch issue detail |
| `PATCH /api/jira/issues/:key` | Update fields, add comment, transition |
| `GET /api/jira/issues/:key/transitions` | Available workflow transitions |
| `POST /api/jira/issues` | Create issue |
| `GET /api/jira/projects` | List projects |
| `GET /api/jira/users/search?query=` | Search Jira users |

### Microsoft 365

| Endpoint | Description |
|----------|-------------|
| `POST /api/o365/planner/tasks` | Create Planner task |
| `PATCH /api/o365/planner/tasks/:id` | Update Planner task |
| `POST /api/o365/todo/tasks` | Create To-Do task |
| `PATCH /api/o365/todo/tasks/:id` | Update To-Do task |

### Delivery & CRM

| Endpoint | Description |
|----------|-------------|
| `GET /api/delivery` | Parsed xlsx data (`?limit=N`) |
| `CRUD /api/delivery/entries` | DB-backed delivery entries |
| `CRUD /api/crm/customers` | CRM customer management |
| `CRUD /api/crm/customers/:id/reviews` | Business reviews |

### AI

| Endpoint | Description |
|----------|-------------|
| `POST /api/actions/suggest` | AI next-action suggestions |
| `POST /api/standups/morning` | Generate morning briefing |
| `POST /api/standups/replan` | Generate mid-day replan |
| `POST /api/standups/eod` | Generate end-of-day review |

### Ingestion

| Endpoint | Description |
|----------|-------------|
| `POST /api/ingest` | Bulk task upsert from Power Automate (`?prune=true`) |
| `GET /api/ingest/status` | PA bridge health check |

## Views

| View | Description |
|------|-------------|
| **Command Centre** | Home page: overdue tasks, due today/week, completion counts, urgency and status charts |
| **My Focus** | AI-suggested next actions with priority reasoning |
| **Tasks** | All tasks grouped by source, filter chips, sort, overdue filter |
| **Standup** | AI morning briefing, mid-day replan, end-of-day review with persistence |
| **KPIs** | Completion rate, average task age, per-source breakdown, health indicators |
| **Delivery** | Delivery pipeline: xlsx viewer + DB-backed entries with starred items |
| **CRM** | Customer health (RAG), business reviews, CRUD |
| **Settings** | Integration credentials, sync intervals, AI config, theme toggle |

## M365 Integration Options

Two paths for Microsoft 365 data:

1. **Direct MCP** — MS Graph MCP server with device-code OAuth (requires Azure AD app registration)
2. **Power Automate Bridge** — PA Cloud flows write JSON to OneDrive, server watches the folder and ingests

See `docs/power-automate-cloud-flows.md` and `docs/power-automate-bridge.md` for setup guides.

## Branding

Nurtur brand theme applied throughout:
- Primary teal: `#5ec1ca`
- Dark navy background: `#272C33`
- Surface: `#2f353d`, Overlay: `#363d47`, Border: `#3a424d`
- Fonts: Plus Jakarta Sans (headings), Figtree (body)
- Light/dark/system theme toggle supported
