# Backend Runtime Enablement — Portal Conversational Evaluation

**Date:** 2026-05-18
**Status:** Analysis complete — action required

---

## Problem Statement

The evaluator now correctly reaches the real conversational intake runtime path (mock bypass via `mockBypass=chat` cookie, line 371-374 of `codexPortalMockPlugin.ts`). However, chat API requests return HTTP 500 because the Express backend cannot start — MSSQL configuration is missing from `.env`.

The Vite mock plugin **cannot** be used for conversational evaluation because it implements the **old category-first flow** (hardcoded `intent → category_picker → detail → summary` at lines 486-514 of the mock). The real `portal-chat.ts` implements LLM-powered conversational intake — the behaviour under test. Testing against the mock would validate the wrong system.

---

## Is MSSQL Mandatory?

**Yes.** There is no fallback, dev mode, or SQLite path for portal chat.

| Component | MSSQL Required | Why |
|-----------|---------------|-----|
| Server startup | **Yes** | `initializeDatabase()` calls `initPool()` which calls `buildConfig()` — throws `"Database not configured"` if env vars missing. Server exits before listening. |
| Portal auth | **Yes** | Reads/writes `portal_organisations`, `portal_users` tables. |
| Portal chat sessions | **Yes** | Creates/reads `portal_chat_sessions`, `portal_chat_messages` tables. |
| Portal chat LLM calls | No (degrades) | Uses `llm-service.ts` → OpenAI. Without `openai_api_key` in settings, LLM calls fail and chat falls back to keyword-based classification. |
| Jira ticket creation | No (degrades) | `confirmAndSubmit()` calls `portalJira.createIssue()`. Without Jira credentials, ticket creation fails but intake conversation still works. |
| Settings | No | File-based (`settings.json`), not MSSQL. |

The sql.js/SQLite mentioned in CLAUDE.md is only used for Calyx — portal chat has no SQLite code path whatsoever.

---

## Environment Variables Required

### Minimum (backend starts, chat sessions work):

```env
# Pick ONE mode — connection string OR individual vars:

# Option A: Connection string
NOVA_SQL_CONNECTION=Server=<host>;Database=<db>;User Id=<user>;Password=<pass>

# Option B: Individual vars
NOVA_SQL_SERVER=<host>
NOVA_SQL_DATABASE=<db>
NOVA_SQL_USER=<user>
NOVA_SQL_PASSWORD=<pass>

# Server
PORT=3001
NODE_ENV=development
```

### For conversational LLM intake (recommended):

```env
# In settings.json (not .env):
# "openai_api_key": "<key>"
# Without this, chat uses keyword fallback — not the conversational behaviour under test.
```

### For full ticket creation (optional for evaluation):

```env
# In .env:
JIRA_URL=https://nurtur.atlassian.net
JIRA_PERSONAL_TOKEN=<token>

# In settings.json:
# "jira_onboarding_email": "<email>"
# "jira_onboarding_token": "<token>"
```

### Portal feature gate:

```json
// In settings.json — must be present:
{
  "portal_enabled": "true",
  "portal_codex_test_user_enabled": "true"
}
```

---

## Three Runtime Options

### Option A: Connect to Production Azure SQL (Recommended)

Nick's NOVA instance already has an Azure SQL database with all portal tables created by schema migrations.

**Required from Nick:**
- `NOVA_SQL_CONNECTION` string (or the four individual vars)
- Confirmation that `openai_api_key` is in `settings.json`

**Commands:**
```bash
# Add to .env:
NOVA_SQL_CONNECTION=Server=<nick-provides>;Database=<nick-provides>;User Id=<nick-provides>;Password=<nick-provides>

# Start full stack:
npm run dev

# Open evaluator URL:
# http://127.0.0.1:5173/portal?codexTestUser=1
# (add mockBypass=chat cookie if testing real backend chat)
```

**Pros:** Zero setup, production-identical schema, all tables exist.
**Cons:** Requires Nick's credentials. Writes test data to production DB. Evaluator creates test sessions/messages in production tables.

**Risk mitigation:** Portal test user (userId=-1) is clearly identifiable. Test sessions can be cleaned with `DELETE FROM portal_chat_sessions WHERE portal_user_id = -1`.

### Option B: Local SQL Server Express (Self-Contained)

Install SQL Server Express locally. Schema migrations in `schema.ts` are idempotent — they create all tables on first run.

**Setup:**
```powershell
# Download & install SQL Server 2022 Express (free):
# https://www.microsoft.com/en-us/sql-server/sql-server-downloads

# After install, create database:
sqlcmd -S localhost\SQLEXPRESS -Q "CREATE DATABASE nova_eval"
sqlcmd -S localhost\SQLEXPRESS -Q "CREATE LOGIN nova_eval WITH PASSWORD='EvalPass123!'"
sqlcmd -S localhost\SQLEXPRESS -d nova_eval -Q "CREATE USER nova_eval FOR LOGIN nova_eval; EXEC sp_addrolemember 'db_owner', 'nova_eval'"
```

**Env vars:**
```env
NOVA_SQL_SERVER=localhost\SQLEXPRESS
NOVA_SQL_DATABASE=nova_eval
NOVA_SQL_USER=nova_eval
NOVA_SQL_PASSWORD=EvalPass123!
```

**Commands:**
```bash
npm run dev
# Schema auto-migrates on first start — all portal tables created.
```

**Pros:** No production data risk. Fully isolated. Repeatable.
**Cons:** Requires SQL Server Express install (~1.5GB). Portal org/user tables start empty — codex test user auto-provisions on first login.

### Option C: Docker SQL Server (Fast, Disposable)

```powershell
docker run -d --name nova-eval-sql -e 'ACCEPT_EULA=Y' -e 'SA_PASSWORD=EvalPass123!' -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest

# Wait 10s for startup, then create database:
docker exec nova-eval-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'EvalPass123!' -C -Q "CREATE DATABASE nova_eval"
```

**Env vars:**
```env
NOVA_SQL_SERVER=localhost
NOVA_SQL_DATABASE=nova_eval
NOVA_SQL_USER=sa
NOVA_SQL_PASSWORD=EvalPass123!
```

**Pros:** Fastest setup. Disposable — `docker rm -f nova-eval-sql` destroys everything.
**Cons:** Requires Docker Desktop. SQL Server image is ~1.5GB download.

---

## Recommended Runtime Path

**For immediate evaluation:** Option A (production Azure SQL) if Nick provides credentials.

**For self-contained evaluation:** Option C (Docker) if Docker is available, else Option B (SQL Server Express).

**Evaluation flow regardless of option:**

1. Set MSSQL env vars in `.env`
2. Ensure `settings.json` contains:
   ```json
   {
     "portal_enabled": "true",
     "portal_codex_test_user_enabled": "true",
     "openai_api_key": "<key>"
   }
   ```
3. Run `npm run dev` (starts both Express on :3001 and Vite on :5173)
4. Navigate to `http://127.0.0.1:5173/portal?codexTestUser=1`
5. The codex test user login sets the `portal_codex_test_user` cookie
6. For evaluator scripts: also set `mockBypass=chat` cookie to route chat requests to real backend
7. Chat requests now hit real `portal-chat.ts` → LLM-powered conversational intake

---

## Verification Steps

### 1. Backend starts successfully
```bash
npm run dev:server
# Expected: "[N.O.V.A] Connected to MSSQL: <host>/<db>"
# Expected: "[N.O.V.A] Server listening on port 3001"
# NOT expected: "Database not configured" error
```

### 2. Portal gate is open
```bash
curl http://127.0.0.1:3001/api/portal/auth/mode
# Expected: {"ok":true,"data":{"mode":"oidc",...,"codexTestUserEnabled":true}}
# If 503: portal_enabled is not "true" in settings.json
```

### 3. Chat session creation works
```bash
# First get a test token:
curl -X POST http://127.0.0.1:3001/api/portal/auth/codex-test-login
# Returns: {"ok":true,"data":{"token":"<jwt>","user":{...}}}

# Then create a session:
curl -X POST http://127.0.0.1:3001/api/portal/chat/sessions \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json"
# Expected: {"ok":true,"data":{"id":<number>,...}}
```

### 4. Conversational intake responds (not category picker)
```bash
curl -X POST http://127.0.0.1:3001/api/portal/chat/sessions/<id>/messages \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"content":"Our homepage phone number is wrong, it should be 01234 567890"}'
# Expected: Response acknowledges the phone number / website context
# NOT expected: "Which area does this relate to?" with category_picker metadata
```

### 5. Evaluator script runs end-to-end
```bash
node agent_work/eval_output/eval-portal-v2.mjs
# Check screenshots in agent_work/eval_output/v2/
# s1_02_first_response.png should show conversational response, not category buttons
```

---

## Known Risks / Limitations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Production DB writes** (Option A) | Test sessions pollute production tables | Use portal_user_id=-1 filter for cleanup |
| **No OpenAI key** | Chat falls back to keyword classification — not the conversational behaviour under test | Ensure `openai_api_key` is in settings.json |
| **Schema drift** | Local DB may have different schema version than production | Schema migrations are idempotent; run `npm run dev` to auto-migrate |
| **Jira unavailable** | `confirmAndSubmit()` fails at ticket creation step | Intake conversation still testable up to confirmation; only final ticket creation fails |
| **Port conflict** | Port 3001 may be in use | Set `PORT=3069` in .env (matches Vite proxy target in vite.config.ts) |
| **Mock still intercepts non-chat routes** | Ticket list, home summary, KB use mock data even with real backend | This is fine — evaluation targets chat intake only |

---

## What Must NOT Change

- No modifications to `portal-chat.ts` or any backend service
- No changes to evaluator criteria or scenarios
- No new mock behaviour in the Vite plugin
- No weakening of portal auth or feature gates
- The `mockBypass=chat` mechanism is already in place and correctly scoped

---

## Summary

The real conversational backend requires MSSQL — there is no way around it. The mock plugin implements the old category-first flow and cannot be used for conversational evaluation. The fastest unblock is for Nick to provide Azure SQL credentials (Option A). The safest self-contained path is Docker SQL Server (Option C). All options require `openai_api_key` in `settings.json` for the LLM-powered intake to function as designed.

---

*Runtime Environment Support — NOVA Attractor Programme*
*2026-05-18*
