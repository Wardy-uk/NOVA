# N.O.V.A (Nurtur Operations & Visibility Aggregator)

Personal productivity aggregator for managing tasks across Jira, Microsoft 365, Monday.com, Dynamics 365, and more. Built for the Nurtur tech team.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express 5 + TypeScript (ESM) |
| Frontend | React 19 + Tailwind 4 + Vite 6 |
| Database | sql.js (in-memory SQLite, flushed to `daypilot.db` every 15s) |
| Auth | JWT (bcrypt passwords) + Entra SSO (PKCE device code flow) |
| External APIs | MCP protocol (Jira, MS365, Monday), direct REST (Jira, Dynamics 365, Azure DevOps, BriefYourMarket) |
| AI | OpenAI (standup briefings, chat, AI actions) |

## Project Structure

```
src/
  server/
    index.ts              # Express app bootstrap, route wiring, sync timers
    middleware/auth.ts     # JWT auth, role guards, area access guards
    db/
      schema.ts           # sql.js init, migrations (ALTER TABLE try/catch pattern)
      queries.ts          # All SQL query classes (TaskQueries, DeliveryQueries, etc.)
      settings-store.ts   # File-based settings (settings.json)
      user-store.ts       # File-based users (users.json)
      notifications.ts    # Notification queries
      audit.ts            # Audit log queries
    routes/*.ts           # Express Router modules (one per feature area)
    services/*.ts         # Business logic, external API clients
    utils/
      role-helpers.ts     # Role parsing, isAdmin()
      source-filter.ts    # Task source filtering
  client/
    App.tsx               # Main SPA shell — area/view navigation, auth, theme
    main.tsx              # React entry point
    components/*.tsx      # All UI components (50+)
    hooks/                # useTasks, useHealth, useAuth, useTheme
    utils/                # taskHelpers, etc.
  shared/
    types.ts              # Zod schemas + TypeScript interfaces (Task, ApiResponse, etc.)
    brand-settings-defs.ts
```

## Dev Commands

```bash
npm run dev            # Starts API (port 3001) + Vite (port 5173) concurrently
npm run dev:server     # API only (tsx watch)
npm run dev:client     # Vite only
npm run build          # Vite build + tsc server
npm run db:reset       # Re-run schema migrations
```

## Data Storage

- **SQLite** (`daypilot.db`): Tasks, delivery entries, CRM, milestones, onboarding config, audit logs, notifications, problem tickets, instance setup, branches, logos, etc.
- **settings.json**: All integration credentials, feature flags, UI preferences (file-based, not in SQLite)
- **users.json**: User accounts (file-based, not in SQLite)
- **backups/**: Daily DB backups with 7-day rotation

**IMPORTANT**: sql.js is in-memory. The DB file is loaded at startup and flushed periodically. External scripts that touch `daypilot.db` directly must run with the server stopped, or changes will be overwritten.

## Auth & Roles

- JWT issued on login, passed as `Authorization: Bearer <token>` or `?token=` query param
- `req.user` has `{ id, username, role }` on all protected routes
- Roles: `admin`, plus custom roles defined in `settings.json` key `custom_roles`
- Area access: Custom roles have per-area access levels (`hidden` / `view` / `edit`)
- Admin always has full access; `isAdmin()` checks for the `admin` role string
- Entra SSO: PKCE auth code flow, auto-provisions users on first login

## Key Patterns

### Route Pattern
Every route file exports a `createXxxRoutes(deps...)` factory that returns an Express Router. Dependencies are injected from `index.ts`.

### Migrations
Schema migrations in `schema.ts` use try/catch around ALTER TABLE — if the column already exists, the error is caught and ignored. This makes migrations idempotent.

### MCP Integration
`McpClientManager` connects to MCP servers (Jira, MS365, Monday) configured via Admin > Integrations UI. Tools called via `mcpManager.callTool(serverName, toolName, args)`.

### Direct REST Clients
Some integrations bypass MCP for features MCP doesn't support:
- `JiraRestClient`: Issue creation, linking, custom fields (onboarding tickets, service desk)
- `Dynamics365Service`: Dataverse Web API via MSAL device code auth
- `AzDoClient`: Azure DevOps REST (Git push for template compilation)
- `BymClient`: BriefYourMarket API (instance setup automation)

### Background Sync
- Per-source sync timers with configurable intervals (default 5 min)
- Full sync runs 5s after startup, then individual source timers take over
- Milestone workflow evaluation every 15 min
- Problem ticket scanning every 15 min
- DB auto-save every 15s, daily backup hourly check

### Settings
All config is stored in `settings.json` via `FileSettingsQueries`. Keys are flat strings (e.g., `jira_ob_email`, `d365_client_id`, `sso_enabled`). The `.env` file seeds initial values on first run only.

## UI Areas & Views

The frontend organises into 4 main areas plus standalone views:

| Area | Views |
|------|-------|
| My NOVA | My Focus, My Dashboard, NOVA Insights, My Tasks, NOVA Briefing, My Team, My Chat |
| Service Desk | Dashboard, My Tickets, Kanban, Calendar, My Breached |
| Onboarding | Overview, Delivery, Overdue, Milestones, Onboarding Matrix |
| Account Management | CRM |
| Standalone | Settings, Admin Panel, My Feedback, Help |

## Versioning

- Bump patch version in `package.json` with every commit/deploy
- Status bar shows `v{version} ({gitHash})`
- `__APP_VERSION__` and `__GIT_HASH__` are injected at build time via Vite `define`

## Files to Never Commit

- `.env` — contains real credentials
- `users.json` — contains password hashes
- `settings.json` — contains API tokens
- `daypilot.db` — binary database
- `.d365-token-cache.json` — MSAL token cache

These are all in `.gitignore`.

## Coding Conventions

- TypeScript strict mode, ESM (`"type": "module"`)
- Server uses `.js` extensions in imports (TypeScript ESM requirement)
- All inline JS in the frontend — no separate JS files for pages
- Tailwind 4 for styling (no config file, uses CSS-based config)
- Zod for runtime validation of shared types
- No test framework currently in use
- Route handlers use `res.json({ ok: true, data })` / `res.json({ ok: false, error })` pattern
