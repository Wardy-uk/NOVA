# N.O.V.A — Nurtur Operational Virtual Assistant

Internal operations platform for the Nurtur tech support team. Aggregates tasks, KPIs, onboarding, service desk, CRM, surveys, training, and AI-assisted workflows into a single PWA.

## Tech Stack

- **Backend:** Express 5 + TypeScript (ESM), `tsx watch` for dev
- **Frontend:** React 19 + Tailwind 4 + Vite 6, lazy-loaded views
- **Primary Database:** MSSQL (Azure SQL via `mssql` package). Connection pool in `services/database.ts`. Schema migrations in `db/schema.ts` use `IF NOT EXISTS` / `ALTER TABLE` pattern.
- **Legacy SQLite:** sql.js still used for local dev/fallback (`daypilot.db`, in-memory, flushed every 15s). Server must be stopped before external DB scripts.
- **Calyx Database:** Separate SQLite (`calyx.db`) — never mix queries with main DB.
- **External DB:** `external-db.ts` manages separate MSSQL pools for abuse reports and admin queries via settings-configured connection strings.
- **KPI Database:** Separate MSSQL pool (`kpi-pipeline.ts`) connecting to `techservicesjsm` Azure SQL. ONLY touch tables populated by Nick's n8n workflows — see global [CLAUDE.md](http://CLAUDE.md) for forbidden tables.
- **Auth:** JWT + bcrypt + Entra SSO (PKCE device code flow). `req.user = { id, username, role }`.
- **AI:** OpenAI (standups, chat, AI actions, coaching), Anthropic SDK
- **External:** Jira REST, Dynamics 365, Azure DevOps, BriefYourMarket, MCP protocol, nodemailer

## Project Commands

```bash
npm run dev            # API (3001) + Vite (5173) concurrently
npm run dev:server     # API only
```

npm run dev:client # Vite only npm run build # vite build + tsc server

```
```

## Architecture

### Server (`src/server/`)

- `index.ts` — Express bootstrap, route wiring, sync timers, background jobs
- `db/schema.ts` — sql.js init, idempotent migrations (ALTER TABLE try/catch)
- `db/queries.ts` — All SQL query classes (TaskQueries, DeliveryQueries, etc.)
- `db/settings-store.ts` — File-based settings (settings.json)
- `routes/*.ts` — \~45 Express Router modules, each exporting `createXxxRoutes(deps)` factory
- `services/*.ts` — \~80 business logic modules, external API clients, AI pipelines
- `middleware/auth.ts` — JWT auth, role guards, area access guards

### Client (`src/client/`)

- `App.tsx` — Main SPA shell (1400+ lines), area/view navigation, auth, theme
- `components/*.tsx` — \~100 view components, mix of eager and lazy-loaded
- `hooks/` — useTasks, useHealth, useAuth, useTheme
- `utils/` — taskHelpers

### Shared (`src/shared/`)

- `types.ts` — Zod schemas + TypeScript interfaces (Task, ApiResponse, etc.)

## Major Feature Areas

AreaKey ViewsBackendService DeskDashboard, Kanban, Calendar, KPIs, Breached, Problem TicketsJira sync, SLA timers, queue monitor, ticket classifierKPI EngineDashboard, Comparison, Leaderboard, Daily History, Trends, QAkpi-pipeline, qa-pipeline, backfill scripts, Azure SQL readsOnboardingDashboard, Delivery, Overdue, Milestones, Config, Matrixmilestone-workflow, setup-orchestrator, template-builderCalyx (Customer Portal)Queue, Dashboard, Playlists, Problems, Changes, KB, SLOcalyx-db, calyx-slo-engine, calyx-email, portal authAI AgentAgent Dashboard, Workspace, Coaching, Pipelines, Profile, KB Gapsagent-loop, autonomy-engine, coach, perceiver, reasoner, actor, kb-article-serviceCRM & SalesCRM, Contracts, Sales Hotbox, Adobe Signdynamics365, bc-client, product-cancellationWallboardsSLA Breach, KPI Breach, Customer Care, Tech Support, Key Accounts, Customer Successserver-rendered HTML in index.ts, wallboard-logger, renderStatWallboardSurveysAdmin, Respondsurvey routesTrainingMatrix, Summarytraining routesPeopleTeam Workload, Agent Roster, Dev Reviewpeople routes, dev-review-queries

## Key Patterns

- **Route factory:** Every route file exports `createXxxRoutes(deps)` → Express Router
- **Idempotent migrations:** ALTER TABLE wrapped in try/catch — safe to re-run
- **MCP integration:** `mcpManager.callTool(serverName, toolName, args)`
- **Direct REST clients** for Jira, D365, AzDo, BYM where MCP doesn't cover
- **Background sync:** Per-source timers (default 5 min), milestone eval every 15 min, problem scan every 15 min, AI improvement scan every 30 min, DB flush every 15s
- **AI Learning comparison:** Derives n8n's action from `jira_issue_cache.last_n8n_comment` (populated by jira sync matching n8n service account comments). `parseN8nAction()` extracts close/escalate/respond from comment body keywords. Settings: `n8n_comment_author_emails`, `n8n_comment_author_display_names`, `n8n_comment_body_marker`.
- **Settings:** Flat key-value in settings.json via FileSettingsQueries
- **Feature flags:** `GET /api/settings/feature-flags` returns boolean toggles (e.g. `wallboard_key_accounts_enabled`, `wallboard_cs_enabled`). Client fetches on login and hides tabs when flags are false.
- **API response pattern:** `res.json({ ok: true, data })` / `res.json({ ok: false, error })`
- **Lazy loading:** Heavy views use `lazy(() => import(...))` in App.tsx
- **PWA:** vite-plugin-pwa with workbox. manifest.webmanifest in public/, service worker auto-generated. Network-first for /api/*, cache-first for assets.
- **KB Article pipeline:** `kb_gap_log` (identified by AI triage) → `kb_article_drafts` (LLM-generated) → Confluence publish via MCP/REST. Settings: `kb_confluence_space`, `kb_confluence_parent_page_id`.
- **Escalation logging:** `escalation_log` table tracks all escalations (manual SOP-002 gate, AI agent, Jira transitions). `escalation-log-service.ts` handles logging + backfill from Jira changelog. Routes: `/api/escalations` (list, stats, backfill). UI: `EscalationReportView.tsx` in KPIs area.
- **Gamification:** `gamification.ts` — points-based achievement system for agents. Achievements award points, daily streaks tracked. Leaderboard with composite scoring, team/tier filters, daily/weekly/monthly views. Routes: `/api/gamification`.

## Subprojects

- `nova-mcp/` — Standalone MCP server for NOVA KPI deep analysis (separate repo, separate package.json)
- `calyx-phases/` — Phase-by-phase implementation docs for Calyx customer portal

## Data Files (Never Commit)

- `.env` — credentials
- `users.json` — password hashes

## Git Remotes — Push to ALL

This repo has two remotes. **Always push to both** after every commit:

```bash
git push origin && git push azdo
```

- `origin` → GitHub (https://github.com/Wardy-uk/NOVA.git)
- `azdo` → Azure DevOps (https://nickw@tfs.briefyourmarket.com/BYM2020/Core/_git/N.O.V.A)

Never push to only one. If one push fails, flag it — don't silently skip.

## Backlog — What To Work On

The single source of truth for all NOVA backlog items is Nick's Obsidian vault:

```
C:\Users\NickW\Documents\Nicks knowledge base\Projects\NOVA\NOVA Backlog - Prioritised.md
```

**Read this file at the start of every session.** It contains:
- Go-live checklist (Phases 1–5) with verification steps
- Priority 1–5 items with effort estimates and WP numbers
- Harness gaps that gate autonomy activation
- Done table for shipped items

When you ship a WP or complete a task, update that file — move the item to the Done table, add the version number and date. Don't update a separate file or board — this is the only backlog.

Nick's personal (non-NOVA) tasks are in `C:\Users\NickW\Documents\Nicks knowledge base\Tasks\Master Todo.md` — read this if Nick asks about his wider task list.