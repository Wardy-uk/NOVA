# Architecture Review (50+ Users)

## Executive Summary
The current architecture is optimized for a single-instance, low-to-moderate concurrency environment. For 50+ users, the biggest risks are state isolation, data durability, and the in-memory sql.js persistence model. The system will likely work at this scale for light usage but will become fragile under concurrent writes, increased data volume, or multi-instance deployment.

## Key Risks At 50+ Users

### 1) sql.js (WASM) persistence and concurrency
- Full DB export + file write every 15 seconds means IO spikes and blocking during writes.
- Single-process memory DB means no safe multi-process or multi-instance scaling.
- File corruption risk rises with process crashes during write, especially without WAL or transaction journaling like native SQLite.
- Backups are file copies of the main DB which can race with write operations.

### 2) Data isolation and multi-user scoping
- Tasks are stored globally and not tied to a user. The UI filters by “allowed sources,” not ownership.
- Per-user settings exist, but the core task store is shared. This risks cross-user visibility when multiple users connect personal integrations.

### 3) MCP client pooling and per-user credentials
- MCP connections are global and use global credentials. “Per-user” is mostly display and filtering, not data isolation.
- If users require distinct credentials or separate tenants, you’ll need per-user MCP sessions or a pool keyed by user/tenant.
- This is a hard blocker for expanding to multiple customer tenants.

### 4) File-based settings/users
- `settings.json` and `users.json` use read-modify-write without locking, which can lose updates under concurrent access.
- This becomes more likely as admin activity increases.

### 5) In-memory runtime state
- AI chat conversations are stored in memory, lost on restart, and not shared across instances.
- Sync timers and workflow evaluations are in-process; multiple instances would duplicate work without a coordinator.

## Migration Path (sql.js -> better-sqlite3 -> PostgreSQL)

### Phase 1: Stabilize the current storage
1. Move `settings.json` and `users.json` into database tables.
2. Add a `user_id` column to `tasks`, and enforce ownership or tenant scoping.
3. Introduce a small storage abstraction layer to separate queries from the engine.

### Phase 2: Switch to better-sqlite3 (lowest friction)
1. Replace `sql.js` with `better-sqlite3` and point to the same `daypilot.db`.
2. Enable WAL and set pragmas:
   - `journal_mode = WAL`
   - `synchronous = NORMAL`
3. Use transactions for write batches to reduce lock contention.
4. Keep the same schema and queries, but replace `sql.js` API usage with better-sqlite3 equivalents.

### Phase 3: PostgreSQL (multi-instance ready)
1. Introduce a query adapter layer so SQL strings don’t embed sqlite-specific syntax.
2. Migrate schema with a proper migration tool (knex, drizzle, or prisma).
3. Move background jobs to a worker queue (BullMQ or Cloud Tasks), and remove in-process timers.
4. Add connection pooling and statement caching.

## MCP Pooling Recommendations
1. Add a pool keyed by `{user_id, integration_id}` with LRU eviction and idle TTL.
2. Cache per-user credentials in the DB, not in process memory.
3. Add connection health telemetry and reconnect jitter to avoid thundering herd.

## Additional Recommendations
1. Task sync strategy: move to per-user sync or a pull-on-demand with short-lived caching.
2. Jobs and timers: move `setInterval` workflows into a job queue with distributed locks.
3. Observability: add structured logging and metrics for sync duration, MCP errors, and DB write latency.
4. Security: encrypt sensitive integration credentials at rest and split settings into public vs secret.

