# Evaluation Harness Fix — Mock Bypass for Real Chat Path

**Date:** 2026-05-18
**Status:** Implemented

## Selected Approach

**Option C — Conditional mock bypass via cookie.**

When the cookie `mockBypass=chat` is present, the Vite mock plugin calls `next()` for:
- All `/api/portal/chat*` routes (session creation, message sending, confirm)
- `/api/portal/auth/codex-test-login` (so the evaluator gets a real JWT from the Express backend)

All other mock routes (tickets, home-summary, KB, auth/mode) remain active — the portal shell UI continues to work with mock data.

## Why This Approach

| Option | Pros | Cons |
|--------|------|------|
| **A — Direct Express URL** | Zero mock changes | Evaluator must run against port 3069 directly, losing the portal frontend (Vite serves the SPA). No UI to drive with Puppeteer. |
| **B — Update mock to mirror Iteration 3** | Mock stays self-contained | Duplicates LLM logic in mock; must be maintained in lockstep with portal-chat.ts. Defeats the purpose — we'd be testing a second mock, not the real code. |
| **C — Cookie bypass (selected)** | Evaluator controls mock vs real per-run. Real backend logic exercised. Portal UI still served by Vite. Minimal code change. | Requires Express backend running alongside Vite. Chat routes need a real JWT (provided by codex-test-login on Express). |

Option C is the only one that lets Puppeteer drive the real portal UI while exercising the real `portal-chat.ts` backend logic.

## What Changed

### File: `src/client/dev/codexPortalMockPlugin.ts`

Added a bypass check at the top of the middleware, before any route matching:

```typescript
const hasMockBypass = (req.headers.cookie ?? '').includes('mockBypass=chat');
if (hasMockBypass && (path.startsWith('/api/portal/chat') || path === '/api/portal/auth/codex-test-login')) {
  return next();
}
```

When `mockBypass=chat` cookie is set:
- Chat routes (`/api/portal/chat/sessions`, `/api/portal/chat/sessions/:id`, `/api/portal/chat/sessions/:id/messages`, `/api/portal/chat/sessions/:id/confirm`) fall through to the Vite proxy → Express backend (port 3069)
- `codex-test-login` falls through to Express so the evaluator gets a real JWT
- All other mock routes (tickets, home-summary, KB articles) still handled by mock — portal shell UI works normally

When `mockBypass=chat` cookie is NOT set:
- Zero behaviour change. Existing mock flow works exactly as before.

## How to Run the Corrected Evaluation

### Prerequisites

1. Express backend running on port 3069 (or 3001 in dev):
   ```bash
   npm run dev:server
   ```
2. Vite dev server running (default port 5173):
   ```bash
   npm run dev:client
   ```

   Or use `npm run dev` to start both concurrently.

3. The Express backend must have access to MSSQL (for portal_users, portal_organisations, chat_sessions tables) and an OpenAI API key (for LLM classification in `portal-chat.ts`).

### Evaluator Changes

In the evaluator script (`_eval-v3b.mjs` or equivalent), the evaluator must:

1. **Set the bypass cookie** before navigating:
   ```javascript
   const page = await browser.newPage();
   await page.setCookie({
     name: 'mockBypass',
     value: 'chat',
     domain: '127.0.0.1',
     path: '/',
   });
   ```

2. **Obtain a real JWT** from the Express backend's codex-test-login:
   ```javascript
   const loginResp = await page.evaluate(async () => {
     const r = await fetch('/api/portal/auth/codex-test-login', { method: 'POST' });
     return r.json();
   });
   const token = loginResp.data.token;
   // Store token in localStorage so the portal frontend uses it
   await page.evaluate((t) => {
     localStorage.setItem('portal_token', t);
   }, token);
   ```

3. **Navigate to the portal** (keep the `codexTestUser=1` query param for non-chat mock routes):
   ```
   http://127.0.0.1:5173/portal?codexTestUser=1
   ```

### Exact URL

```
http://127.0.0.1:5173/portal?codexTestUser=1
```

(Same URL as before — the bypass is controlled by cookie, not URL.)

### Required Commands

```bash
# Terminal 1: Start both servers
npm run dev

# Terminal 2: Run evaluator
node _eval-v3b.mjs
```

## How to Confirm Requests Reach the Real Backend

1. **Server console logs:** `portal-chat.ts` logs `[portal-chat] processMessage session=X stage=Y` on every message. If you see these logs in the Express terminal, the real backend is handling chat.

2. **No "Which area does this relate to?" as first response:** The mock always returns this exact string with a `category_picker` metadata type. If the response to a website-related message is conversational (acknowledges the specific content), the real `handleIntentWithLlm()` path is executing.

3. **LLM API calls:** If using OpenAI, the Express server will show outbound API calls in debug mode. The mock makes zero external calls.

4. **9 categories vs 4:** If a category picker does appear (for non-website or low-confidence), it will show 9 options (production set) not 4 (mock set). This confirms the real `buildCategoryQuestion()` is running.

## Risks and Limitations

- **Requires running Express backend:** The mock-only evaluation mode (no backend needed) is still available by omitting the `mockBypass=chat` cookie. But behavioural evaluation of conversational intake requires the real backend.

- **Requires OpenAI API key:** The real `portal-chat.ts` calls `handleIntentWithLlm()` which uses the LLM service. Without a valid API key, chat messages will fail with a 500 error. This is expected — you cannot test LLM-powered conversational intake without an LLM.

- **Requires MSSQL connection:** Chat sessions and messages are persisted in MSSQL. The Express backend needs a working database connection. For local dev, the standard `.env` credentials suffice.

- **Non-deterministic LLM responses:** Unlike the mock (which is fully deterministic), the real backend's LLM classification may vary between runs. The evaluator criteria should account for this — check behavioural properties (message acknowledged, no category picker for clear website requests) rather than exact string matches.

- **Mock still handles non-chat routes:** Ticket list, ticket detail, home-summary, and KB articles are still served by the mock when the bypass cookie is set. This is intentional — the evaluator focuses on chat intake behaviour, and the mock provides stable test data for the surrounding UI. If full end-to-end evaluation is needed later, the bypass can be extended to cover more route prefixes.

## Production Impact

**None.** The bypass:
- Only activates in the Vite dev server (`apply: 'serve'`)
- Only activates when a specific cookie is set
- Is never included in production builds (`vite build` strips dev plugins)
- Does not modify any backend code
