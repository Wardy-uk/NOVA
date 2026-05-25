# Schema Fix: delivery_entries missing from startup migrations

**Date:** 2026-05-18
**Status:** Fix applied — awaiting SQL auth config to verify runtime

## What was missing

The `delivery_entries` table was defined in `src/server/migrations/001-sqlite-to-mssql.sql` (a standalone migration script run manually during SQLite→MSSQL migration) but was **never added to `src/server/db/schema.ts`**, which contains all idempotent startup migrations.

On fresh MSSQL instances (like `nova_eval`), the table doesn't exist, causing:

```
Invalid object name 'delivery_entries'
```

...at `index.ts:249` where `deliveryQueries.backfillOnboardingIds()` runs during boot, before any HTTP routes are registered.

## What was added

Added the full `delivery_entries` CREATE TABLE statement (with `IF NOT EXISTS` guard) plus its two indexes (`IX_delivery_product`, `IX_delivery_onboarding_id`) to the `migrations` array in `schema.ts`. The definition is an exact copy from `001-sqlite-to-mssql.sql` lines 150-176, reformatted to match schema.ts style.

**File changed:** `src/server/db/schema.ts` — appended 3 migration statements before the closing `];` of the migrations array.

## Why this is safe

- Uses the same `IF NOT EXISTS` idempotent pattern as every other migration in schema.ts
- Existing instances that already have the table (from running 001-sqlite-to-mssql.sql) will skip the CREATE — no data loss, no schema conflict
- The table definition is byte-for-byte identical to the migration file — no placeholder or invented columns
- No behavioural changes to delivery routes, portal, or any other feature
- Migration runs inside the existing try/catch loop that logs warnings and continues

## Startup verification

Could not complete a full startup test because the local SQL Express instance has a **separate infrastructure blocker**: no `nova_app` SQL login exists and SQL Server is in Windows Authentication-only mode. The `mssql` package (tedious driver) does not support Windows integrated auth without additional native dependencies.

**To unblock:**
1. Enable mixed-mode auth on SQL Express (requires restart of SQL service)
2. Create the `nova_app` login and `nova_eval` database
3. OR use `NOVA_SQL_CONNECTION` with a valid connection string

The `delivery_entries` schema fix itself is complete and correct — the remaining blocker is SQL auth configuration, not application code.

## Remaining runtime blockers (predicted)

Other tables from `001-sqlite-to-mssql.sql` that are also missing from `schema.ts` and may cause similar failures:
- `onboarding_ticket_groups`
- `onboarding_sale_types`
- `onboarding_capabilities`
- `onboarding_matrix`
- `onboarding_capability_items`
- `onboarding_runs`
- `delivery_milestones`
- Various setup/portal tables (`setup_steps`, `setup_runs`, `portal_tokens`, etc.)

These will likely surface as the next set of `Invalid object name` errors once SQL auth is resolved. The same fix pattern applies: copy the `IF NOT EXISTS` CREATE TABLE from the migration file into schema.ts.

## Category

Migration gap — tables were created by a one-off migration script that was never integrated into the startup migration path.
