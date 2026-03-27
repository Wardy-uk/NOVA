# N.O.V.A TODO

Actionable tasks derived from the codebase review. Ordered by priority.

---

## High Priority

- [ ] **Add DB transactions for multi-step operations**
  - Wrap onboarding orchestrator DB writes in BEGIN/COMMIT
  - Wrap bulk import operations in transactions
  - Wrap delivery entry + milestone creation in transactions

- [ ] **Move pagination to SQL level**
  - Replace in-memory task pagination with LIMIT/OFFSET queries
  - Push status/source filters into SQL WHERE clauses
  - Update route handlers to pass page/pageSize to query layer

- [ ] **Clean up debug logging**
  - Remove or gate `console.log('[KPI DEBUG]...')` statements
  - Consider adding a simple log level utility (debug/info/warn/error)
  - Audit all routes/services for stray debug logs

---

## Medium Priority

- [ ] **Split queries.ts into per-domain files**
  - Extract TaskQueries -> `task-queries.ts`
  - Extract DeliveryQueries + MilestoneQueries -> `delivery-queries.ts`
  - Extract CrmQueries -> `crm-queries.ts`
  - Extract OnboardingConfigQueries + OnboardingRunQueries -> `onboarding-queries.ts`
  - Extract KPI-related queries -> `kpi-queries.ts`
  - Update imports in index.ts and all route files

- [ ] **Create settings key constants**
  - Define `SETTINGS_KEYS` const object with all known keys
  - Replace all raw string access with constant references
  - Add TypeScript type for settings key union

- [ ] **Add MCP result caching**
  - Create simple TTL cache utility
  - Cache KPI/QA Jira query results (60s TTL)
  - Cache task list results per source (5min TTL, invalidated on manual sync)

- [ ] **Migrate settings/users to DB**
  - Create `settings` and `users` tables in schema.ts
  - Write migration to import existing JSON files
  - Update FileSettingsQueries and FileUserQueries to use SQL
  - Keep JSON export for backup compatibility

- [ ] **Define MCP server name constants**
  - Create `src/server/constants.ts` with server IDs
  - Replace all string literals across index.ts, aggregator.ts, and routes

---

## Low Priority

- [ ] **Refactor TaskAggregator into adapter pattern**
  - Define `TaskSourceAdapter` interface (fetchTasks, mapToTask, getSourceName)
  - Implement per-source adapters (JiraAdapter, PlannerAdapter, etc.)
  - Simplify aggregator to iterate adapters

- [ ] **Implement incremental sync**
  - Track `last_synced` timestamp per source in DB
  - Pass timestamp to MCP/REST calls where APIs support it
  - Fall back to full sync if last_synced > 24h ago

- [ ] **Add discriminated union types for raw_data**
  - Define JiraRawData, PlannerRawData, MondayRawData, etc.
  - Update Task interface with source-discriminated raw_data
  - Add type guards for components accessing raw_data fields

- [ ] **Surface sync health in UI**
  - Add per-source last_synced and last_error to health endpoint
  - Show sync status indicators on the dashboard
  - Add toast/notification on consecutive sync failures
