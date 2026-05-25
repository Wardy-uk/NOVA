# Workstream 1 Phase 1 — Evaluation Environment Unblock

**Date:** 2026-05-18
**Status:** Resolved — no code changes required

---

## Root Cause

The Express API server (`npm run dev:server`) requires an MSSQL connection. When `NOVA_SQL_CONNECTION` or the individual `NOVA_SQL_SERVER`/`NOVA_SQL_DATABASE`/`NOVA_SQL_USER`/`NOVA_SQL_PASSWORD` env vars are missing, the server throws `"Database not configured"` at startup and exits immediately. The Vite proxy forwards `/api/*` to `http://127.0.0.1:3069` — with no backend listening, all API calls return HTTP 500.

There is **no SQLite fallback** and **no mock mode** on the server side. MSSQL is mandatory for the Express backend.

## Mock/Dev Mode — Already Exists

A **Vite-side mock plugin** (`src/client/dev/codexPortalMockPlugin.ts`) is already wired into `vite.config.ts` and active during `vite dev`. It intercepts `/api/portal/*` requests inside the Vite dev server middleware **before** they reach the proxy, so the Express backend is not needed for portal evaluation.

### What the mock covers

| Endpoint | Method | Covered |
|---|---|---|
| `/api/portal/auth/mode` | GET | Yes — returns `{ mode: 'oidc', codexTestUserEnabled: true }` |
| `/api/portal/auth/login` | GET | Yes — redirects to `/portal?codexTestUser=1` |
| `/api/portal/auth/codex-test-login` | POST | Yes — returns test token + user |
| `/api/portal/home-summary` | GET | Yes — open ticket count + announcement |
| `/api/portal/kb/popular` | GET | Yes — 3 seeded KB articles |
| `/api/portal/tickets` | GET | Yes — 3 seeded tickets, filter/search/pagination |
| `/api/portal/tickets/:key` | GET | Yes — full ticket detail with comments, history, SLA |
| `/api/portal/chat/sessions` | GET/POST | Yes — session list, create |
| `/api/portal/chat/sessions/:id` | GET | Yes — session + messages |
| `/api/portal/chat/sessions/:id/messages` | POST | Yes — multi-stage intake flow (intent → category → detail → summary) |
| `/api/portal/chat/sessions/:id/confirm` | POST | Yes — creates ticket from confirmed intake |
| `/api/portal/chat/sessions/:id/end` | POST | Yes — ends session |
| `/api/portal/events` (SSE) | GET | No — returns 501, non-critical (SSE retries silently with backoff) |
| `/api/portal/kb/categories` | GET | No — returns 501, only used for NOVA JWT probe (bypassed by codex test user) |

### Mock activation

The mock requires the cookie `portal_codex_test_user=1`. Without this cookie, requests fall through to the Vite proxy → dead backend → HTTP 500. The cookie is set automatically when navigating to `/portal?codexTestUser=1`.

---

## Exact Commands to Run the Portal Evaluation

### Option A: Frontend only (recommended for evaluation — no env vars needed)

```bash
npm run dev:client
```

Then open: **`http://127.0.0.1:5173/portal?codexTestUser=1`**

This runs Vite only (port 5173). The `codexTestUser=1` query param triggers the mock login flow, sets the cookie, and all subsequent `/api/portal/*` calls are handled by the Vite mock plugin. No Express backend required.

If port 5173 is already in use, Vite auto-increments (5174, 5175, etc.) — the mock plugin works on any port.

### Option B: Full stack (requires MSSQL credentials)

```bash
# .env must contain one of:
#   NOVA_SQL_CONNECTION=Server=<host>;Database=<db>;User Id=<user>;Password=<pass>
# or:
#   NOVA_SQL_SERVER=<host>
#   NOVA_SQL_DATABASE=<db>
#   NOVA_SQL_USER=<user>
#   NOVA_SQL_PASSWORD=<pass>

npm run dev
```

This starts both Express (port 3001, configurable via `PORT` env var) and Vite (port 5173). The Vite proxy target is hardcoded to `http://127.0.0.1:3069` in `vite.config.ts` — production uses port 3069, so either set `PORT=3069` or update the proxy target.

---

## Environment Variables Required (placeholder values)

For **Option A** (mock mode): **none**.

For **Option B** (full stack):

```env
# Required — pick one mode:
NOVA_SQL_CONNECTION=Server=your-server.database.windows.net;Database=nova;User Id=nova_user;Password=your_password

# OR individual vars:
NOVA_SQL_SERVER=your-server.database.windows.net
NOVA_SQL_DATABASE=nova
NOVA_SQL_USER=nova_user
NOVA_SQL_PASSWORD=your_password

# Optional:
PORT=3069
NODE_ENV=development
```

---

## What the User Must Provide Manually

For **Option A**: Nothing. The mock plugin and codex test user are self-contained.

For **Option B**: Real MSSQL credentials (Nick has these — they are the Azure SQL credentials for the NOVA database).

---

## Recommendation

Use **Option A** (`npm run dev:client` + `?codexTestUser=1`) for all portal behavioural evaluation. The mock plugin provides:

- 3 seeded tickets across different statuses (Reviewed, Awaiting Your Response, Resolved)
- Full ticket detail with comments, status history, and SLA data
- Complete chat intake flow (intent → category → detail → summary → confirm → ticket creation)
- Ticket filtering and search
- KB articles
- Home summary with open ticket count

This is sufficient for evaluating portal UX, ticket status display, chat intake flow, and the Website Design / Content intake journey without any backend dependencies.

---

## Files Referenced

- `vite.config.ts` — mock plugin registration + proxy config
- `src/client/dev/codexPortalMockPlugin.ts` — full mock implementation (553 lines)
- `src/client/portal-main.tsx` — codex test user auth flow
- `src/server/services/database.ts:21-25` — "Database not configured" error source
- `.env.example` — env var documentation (NOVA_SQL_CONNECTION listed as "Future")
