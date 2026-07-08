# Services Layer — Local Context

\~80 service modules live here. This is the business logic layer between routes and database.

## Key subsystems

- **AI pipeline:** `llm-service.ts` (provider abstraction), `ai-actions.ts`, `ai-standup.ts`, `coach.ts`, `ticket-classifier.ts` — all use structured Zod schemas for AI output validation (see `*-schema.ts` files). Shared utilities in `shared/flex-schemas.ts` and `shared/adf-utils.ts`.
- **Jira:** `jira-client.ts` (REST), `jira-sync-service.ts` (background sync), `jira-sla.ts`, `jira-cache-queries.ts` — sync timer runs independently, don't duplicate
- **KPI:** `kpi-pipeline.ts` (separate MSSQL pool to `techservicesjsm`), `qa-pipeline.ts` — Azure SQL safety rules apply
- **Agent loop:** `agent-loop.ts`, `perceiver.ts`, `reasoner.ts`, `actor.ts`, `observer.ts`, `autonomy-engine.ts` — AI agent architecture, be careful with changes here
- **Calyx:** `calyx-slo-engine.ts`, `calyx-email.ts`, `calyx-kpi-sync.ts` — uses Calyx SQLite, NOT main MSSQL
- **External integrations:** `dynamics365.ts`, `azdo-client.ts`, `bym-client.ts`, `adobe-sign-client.ts`, `mcp-client.ts` — each has its own auth/connection lifecycle

## Conventions

- Services are instantiated and injected from `index.ts`. Don't create singletons with side effects at import time.
- AI output schemas live alongside their service as `{feature}-schema.ts` files using Zod.
- `prompt-loader.ts` loads prompts from `config/prompts/`. Don't inline prompt strings in services.
