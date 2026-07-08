# Database Layer — Local Context

This directory manages NOVA's primary MSSQL database.

## Critical rules
- `schema.ts` contains ALL migrations. They run at startup and MUST be idempotent.
- `database.ts` manages the MSSQL connection pool (min: 2, max: 50). Pool exhaustion has been a past issue — see `PROBLEM-connection-pool-exhaustion.md` in project root.
- `queries.ts` contains all SQL query classes. Group related queries in the same class.
- `settings-store.ts` reads/writes `settings.json` (file-based, NOT in the database).
- `calyx-db.ts` and `calyx-queries.ts` connect to a SEPARATE SQLite database (`calyx.db`). Never import main MSSQL pool functions into Calyx code or vice versa.
- `external-db.ts` manages additional MSSQL pools for abuse reports and admin queries — these use settings-configured connection strings, not env vars.

## Azure SQL safety
The KPI pipeline connects to `techservicesjsm`. ONLY touch tables populated by Nick's n8n workflows. Forbidden tables are listed in the global CLAUDE.md.
