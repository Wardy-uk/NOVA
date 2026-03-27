# N.O.V.A Technical Debt

Tracked issues affecting reliability, scalability, and maintainability.

---

## High Priority

### 1. No Database Transactions
- **Location**: All multi-step DB operations across `src/server/db/queries.ts` and route handlers
- **Risk**: Multi-step operations (e.g., onboarding ticket creation + linking, bulk imports) can partially fail with no rollback, leaving data in an inconsistent state
- **Fix**: Wrap multi-step operations in `BEGIN`/`COMMIT` blocks using sql.js transaction support

### 2. In-Memory Pagination
- **Location**: Task fetching in `src/server/routes/tasks.ts`, KPI queries
- **Risk**: All tasks loaded into memory then paginated in JS. At 100k+ tasks, memory usage will spike
- **Fix**: Move pagination to SQL level with `LIMIT`/`OFFSET` and push filtering into queries

### 3. Debug Logging in Production
- **Location**: `src/server/routes/kpi-data.ts`, various route and service files (`console.log('[KPI DEBUG]...')`)
- **Risk**: Noisy logs in production, potential performance impact, possible data leakage
- **Fix**: Introduce structured logging with levels (debug/info/warn/error) and strip debug logs from production builds

---

## Medium Priority

### 4. Monolithic queries.ts (3,344 lines)
- **Location**: `src/server/db/queries.ts`
- **Risk**: Hard to navigate, review, and maintain. 22+ query classes in a single file increases merge conflict risk
- **Fix**: Split into per-domain files (`task-queries.ts`, `delivery-queries.ts`, `crm-queries.ts`, etc.)

### 5. Magic String Settings Keys
- **Location**: All calls to `settingsQueries.get('key_name')` across routes and services
- **Risk**: No compile-time safety — typos silently return `undefined`
- **Fix**: Create a `SettingsKey` enum or const object and use it everywhere

### 6. No MCP Result Caching
- **Location**: `src/server/services/mcp-client.ts`, KPI and task sync paths
- **Risk**: Every dashboard refresh triggers fresh MCP tool calls to Jira/MS365. Slow under load
- **Fix**: Add TTL-based caching layer for MCP tool results (e.g., 60s for KPI data, 5min for task lists)

### 7. File-Based Settings and Users
- **Location**: `src/server/db/settings-store.ts`, `src/server/db/user-store.ts`
- **Risk**: `settings.json` and `users.json` don't support concurrent writes from multiple processes. Blocks horizontal scaling
- **Fix**: Migrate to SQLite tables (or PostgreSQL when moving to production)

### 8. Hard-Coded MCP Server Names
- **Location**: `src/server/index.ts`, `src/server/services/aggregator.ts`, route files
- **Risk**: Server IDs (`'jira'`, `'msgraph'`, `'monday'`) used as raw strings. Renaming breaks silently
- **Fix**: Define server name constants in a shared module

---

## Low Priority

### 9. TaskAggregator Monolith
- **Location**: `src/server/services/aggregator.ts`
- **Risk**: Single class merges tasks from 7 sources with complex per-source logic. Hard to test or extend
- **Fix**: Refactor into per-source adapter pattern with a common interface

### 10. Full Sync on Every Startup
- **Location**: `src/server/index.ts` (sync timers)
- **Risk**: Fetches all tasks from all sources on every server restart. Slow startup with large datasets
- **Fix**: Implement incremental sync using `last_synced` timestamps per source

### 11. Minimal Type Safety on raw_data
- **Location**: `src/shared/types.ts` — `raw_data: unknown` on Task interface
- **Risk**: Source-specific metadata accessed without type narrowing throughout components
- **Fix**: Define discriminated union types per source (e.g., `JiraRawData`, `PlannerRawData`)

### 12. No Sync Failure Alerting
- **Location**: Background sync timers in `src/server/index.ts`
- **Risk**: Sync failures are logged but not surfaced. Stale data can go unnoticed for hours
- **Fix**: Add sync health status to the existing health endpoint and surface in the UI
