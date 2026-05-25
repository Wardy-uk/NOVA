# Local Docker SQL Evaluation Setup — Portal Conversational Intake

**Date:** 2026-05-18
**Status:** Ready for execution

---

## Overview

This document provides the exact steps to create a disposable local evaluation environment for testing the real portal conversational intake backend (`portal-chat.ts`) against a Docker SQL Server instance. No production credentials are used. No production data is touched.

---

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Docker Desktop installed and running | `docker --version` |
| Node.js 18+ | `node --version` |
| npm dependencies installed | `npm install` (already done if dev server has run before) |
| Chrome installed (for Puppeteer evaluator) | `C:/Program Files/Google/Chrome/Application/chrome.exe` |

---

## Step 1: Start Docker SQL Server

```powershell
docker run -d `
  --name nova-eval-sql `
  -e "ACCEPT_EULA=Y" `
  -e "MSSQL_SA_PASSWORD=N0vaEval2026!" `
  -p 1433:1433 `
  mcr.microsoft.com/mssql/server:2022-latest
```

Wait ~10 seconds for SQL Server to initialise, then create the database:

```powershell
docker exec nova-eval-sql /opt/mssql-tools18/bin/sqlcmd `
  -S localhost -U sa -P "N0vaEval2026!" -C `
  -Q "CREATE DATABASE nova_eval"
```

**Why the database must be pre-created:** The NOVA `initPool()` function connects to an existing database — it does not create one. The `runMigrations()` function creates tables within the database, but the database itself must exist first.

---

## Step 2: Configure .env

**Do NOT overwrite the existing `.env`.** Instead, create a separate file or temporarily prepend these values. The safest approach is a `.env.eval` file used with explicit sourcing.

Create `.env.eval` in the project root:

```env
# Docker SQL Server connection
NOVA_SQL_SERVER=127.0.0.1
NOVA_SQL_DATABASE=nova_eval
NOVA_SQL_USER=sa
NOVA_SQL_PASSWORD=N0vaEval2026!

# Backend port — must match Vite proxy target (vite.config.ts line 65)
PORT=3069

# Dev mode — enables codex test user auto-login
NODE_ENV=development
```

**To use it:** Before starting the backend, either:
- Copy these values into `.env` (temporarily), or
- Set them as environment variables in the terminal session:

```powershell
$env:NOVA_SQL_SERVER = "127.0.0.1"
$env:NOVA_SQL_DATABASE = "nova_eval"
$env:NOVA_SQL_USER = "sa"
$env:NOVA_SQL_PASSWORD = "N0vaEval2026!"
$env:PORT = "3069"
$env:NODE_ENV = "development"
```

---

## Step 3: Configure settings.json

The portal requires `portal_enabled` to be `"true"` in `settings.json`. The existing `settings.json` does NOT have this setting.

**Add to settings.json** (inside the `"settings"` object):

```json
"portal_enabled": "true"
```

**Note:** `portal_codex_test_user_enabled` does NOT need to be set. The code at `portal-auth.ts:300` auto-enables it when `NODE_ENV !== 'production'`:

```typescript
return settings.get('portal_codex_test_user_enabled') === 'true' || process.env.NODE_ENV !== 'production';
```

**Note:** `openai_api_key` is already present in `settings.json` (line 23). The LLM service reads it from there. No additional configuration needed for conversational intake.

---

## Step 4: Schema Migrations (Automatic)

**No manual migration step is required.**

On startup, `src/server/index.ts` line 199-200 calls:

```typescript
await initializeDatabase();
```

Which calls `initPool()` → `runMigrations()` in `schema.ts`. All ~180 migration statements execute using `IF NOT EXISTS` / `IF COL_LENGTH(...) IS NULL` guards. This creates every table including:

- `portal_organisations`
- `portal_users`
- `portal_chat_sessions`
- `portal_chat_messages`
- `portal_kb_articles`
- `portal_csat_surveys`
- Plus all non-portal tables (users, tasks, jira_issue_cache, etc.)

All tables start empty. No seed data is required — the codex test user flow auto-creates the necessary org and user rows on first login.

---

## Step 5: Seed Data (Automatic via Codex Test Login)

**No manual seed data is required.**

When the codex test login endpoint is called (`POST /api/portal/auth/codex-test-login`), it runs `createCodexTestSession()` in `portal-auth.ts:303` which:

1. **Upserts organisation:** `portal_organisations` row with `external_id='codex-test-org'`, `name='Codex Test Organisation'`
2. **Upserts user:** `portal_users` row with `external_id='codex-test-user'`, `email='codex.portal.test@nurtur.tech'`, `role='requester'`
3. **Issues JWT** with `{ userId, email, orgId, orgName, role }`

This happens automatically when the portal frontend loads with `?codexTestUser=1` or when the evaluator hits the test login endpoint.

---

## Step 6: Start the Environment

**Terminal 1 — Express backend:**

```powershell
# Set env vars (if not in .env)
$env:NOVA_SQL_SERVER = "127.0.0.1"
$env:NOVA_SQL_DATABASE = "nova_eval"
$env:NOVA_SQL_USER = "sa"
$env:NOVA_SQL_PASSWORD = "N0vaEval2026!"
$env:PORT = "3069"
$env:NODE_ENV = "development"

npm run dev:server
```

**Expected output:**
```
[N.O.V.A] Initializing database...
[N.O.V.A] Connected to MSSQL: 127.0.0.1/nova_eval
[N.O.V.A] Running migrations...
[N.O.V.A] Migrations complete
...
[N.O.V.A] Portal routes wired (currently enabled — toggle via Admin > Feature Flags)
[N.O.V.A] Server listening on port 3069
```

**Terminal 2 — Vite client:**

```powershell
npm run dev:client
```

**Expected output:**
```
VITE v6.x.x  ready in xxx ms
➜  Local:   http://127.0.0.1:5173/
```

---

## Step 7: Evaluator URL and Cookie Setup

### Manual browser testing:

```
http://127.0.0.1:5173/portal?codexTestUser=1
```

This sets the `portal_codex_test_user=1` cookie automatically. The Vite mock plugin intercepts requests when this cookie is present — but chat routes are **not intercepted** when the `mockBypass=chat` cookie is also set.

**To test against the real backend**, set the bypass cookie in browser DevTools:

```javascript
document.cookie = 'mockBypass=chat; path=/';
```

Then reload and start a new chat session. Chat API calls now go through Vite proxy → Express backend → real `portal-chat.ts` → LLM.

### Evaluator script:

The existing evaluator at `agent_work/eval_output/eval-portal-v2.mjs` uses Puppeteer and navigates to the portal with `?codexTestUser=1`. To route chat requests to the real backend, the evaluator must also set the `mockBypass=chat` cookie after page load:

```javascript
await page.setCookie({
  name: 'mockBypass',
  value: 'chat',
  domain: '127.0.0.1',
  path: '/',
});
```

**Evaluator URL:** `http://127.0.0.1:5173/portal?codexTestUser=1` (port may auto-increment to 5174 if 5173 is in use — check Vite output)

---

## Verification Checklist

Run these in order. Each step depends on the previous succeeding.

### V1: Docker SQL Server is running

```powershell
docker exec nova-eval-sql /opt/mssql-tools18/bin/sqlcmd `
  -S localhost -U sa -P "N0vaEval2026!" -C `
  -Q "SELECT name FROM sys.databases WHERE name = 'nova_eval'"
```

**Expected:** `nova_eval` in output.

### V2: Express backend starts and connects

```powershell
# Start backend (Terminal 1)
npm run dev:server
```

**Expected:** Log contains `Connected to MSSQL: 127.0.0.1/nova_eval` and `Server listening on port 3069`. No `"Database not configured"` error.

### V3: Portal gate is open

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3069/api/portal/auth/mode"
```

**Expected:** `{ ok: true, data: { mode: "oidc", ..., codexTestUserEnabled: true } }`
**If 503:** `portal_enabled` is not `"true"` in settings.json.

### V4: Codex test login creates user and returns token

```powershell
$response = Invoke-RestMethod -Uri "http://127.0.0.1:3069/api/portal/auth/codex-test-login" -Method POST -ContentType "application/json"
$response | ConvertTo-Json
$token = $response.data.token
```

**Expected:** `{ ok: true, data: { token: "<jwt>", user: { userId: <id>, email: "codex.portal.test@nurtur.tech", ... } } }`

### V5: Chat session creation works

```powershell
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
Invoke-RestMethod -Uri "http://127.0.0.1:3069/api/portal/chat/sessions" -Method POST -Headers $headers
```

**Expected:** `{ ok: true, data: { id: <number>, portal_user_id: <number>, status: "active", ... } }`

### V6: Conversational intake produces LLM response (not category picker)

```powershell
$sessionId = <id-from-V5>
$body = '{"content":"Our homepage phone number is wrong. It should be 01234 567890."}'
Invoke-RestMethod -Uri "http://127.0.0.1:3069/api/portal/chat/sessions/$sessionId/messages" -Method POST -Headers $headers -Body $body
```

**Expected:** Response contains a conversational acknowledgment referencing phone numbers / website / content change. The `metadata` field should NOT contain `"type":"category_picker"`.

**If metadata contains `category_picker`:** The real backend is not being hit — check that the mock bypass cookie is set and the request is going to port 3069 (not being intercepted by the Vite mock plugin).

### V7: Vite client loads portal UI

```
http://127.0.0.1:5173/portal?codexTestUser=1
```

**Expected:** Portal login redirects to home page. "Get help" button visible. Chat opens and accepts input.

---

## Cleanup Commands

### Stop and remove Docker container:

```powershell
docker stop nova-eval-sql
docker rm nova-eval-sql
```

### Remove env vars from current session:

```powershell
Remove-Item Env:\NOVA_SQL_SERVER -ErrorAction SilentlyContinue
Remove-Item Env:\NOVA_SQL_DATABASE -ErrorAction SilentlyContinue
Remove-Item Env:\NOVA_SQL_USER -ErrorAction SilentlyContinue
Remove-Item Env:\NOVA_SQL_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\PORT -ErrorAction SilentlyContinue
```

### Remove .env.eval (if created):

```powershell
Remove-Item ".env.eval" -ErrorAction SilentlyContinue
```

### Revert settings.json (remove portal_enabled):

Remove the `"portal_enabled": "true"` line if it was added solely for evaluation. If the portal is intended to stay enabled, leave it.

### Full reset (start fresh):

```powershell
docker rm -f nova-eval-sql
docker run -d --name nova-eval-sql -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=N0vaEval2026!" -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
Start-Sleep -Seconds 10
docker exec nova-eval-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "N0vaEval2026!" -C -Q "CREATE DATABASE nova_eval"
```

---

## Risks and Limitations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **OpenAI API charges** | Each chat message makes an LLM call (~$0.01-0.05 per exchange) | Evaluator runs 7 scenarios × ~3 messages each ≈ $0.50 max |
| **Docker image size** | `mssql/server:2022-latest` is ~1.5GB download | One-time download; subsequent starts are instant |
| **Port 1433 conflict** | Another SQL Server or service may use 1433 | Change host port: `-p 14330:1433` and use `NOVA_SQL_SERVER=127.0.0.1,14330` |
| **Port 3069 conflict** | Production NOVA uses 3069 on BYM-AAPP01, but locally this should be free | Check with `netstat -ano | findstr :3069` before starting |
| **settings.json is shared** | Adding `portal_enabled` affects the dev environment beyond evaluation | Revert after evaluation if portal should remain disabled in dev |
| **Non-portal startup errors** | Backend may log errors for Jira sync, D365, etc. due to dummy/missing credentials | These are non-fatal — portal chat still works. Ignore non-portal errors. |
| **Jira ticket creation fails** | `confirmAndSubmit()` will fail because Jira onboarding credentials are not configured for the eval DB | Intake conversation is fully testable up to the confirmation step. Ticket creation failure does not block evaluation of conversational behaviour. |
| **Mock intercepts non-chat routes** | Home summary, ticket list, KB still served by Vite mock plugin | This is correct — evaluation targets chat intake only. Non-chat routes using mock data is expected. |

---

## Architecture Summary

```
Browser (evaluator / manual)
  │
  ├── GET /portal?codexTestUser=1
  │     → Vite dev server (5173) serves portal.html
  │     → Sets portal_codex_test_user=1 cookie
  │
  ├── POST /api/portal/auth/codex-test-login
  │     → Cookie has portal_codex_test_user=1 BUT no mockBypass=chat
  │     → Vite mock plugin handles it (returns test token)
  │     → OR: with mockBypass=chat → proxied to Express → real portal-auth.ts
  │
  ├── POST /api/portal/chat/sessions (with mockBypass=chat cookie)
  │     → Vite mock plugin sees mockBypass=chat → skips → next()
  │     → Vite proxy → http://127.0.0.1:3069/api/portal/chat/sessions
  │     → Express portalGate (checks portal_enabled=true) → ✓
  │     → Express portalAuth (validates JWT) → ✓
  │     → portal-chat.ts → creates session in Docker MSSQL
  │
  └── POST /api/portal/chat/sessions/:id/messages (with mockBypass=chat cookie)
        → Same path → portal-chat.ts
        → LLM call via llm-service.ts → OpenAI (using key from settings.json)
        → Conversational intake response stored in Docker MSSQL
        → Returns to browser
```

---

*Local Evaluation Environment Builder — NOVA Attractor Programme*
*2026-05-18*
