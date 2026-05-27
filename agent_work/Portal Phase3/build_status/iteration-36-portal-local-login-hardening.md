# Iteration 36 — Portal Local Login Hardening

**Slice:** Portal local login live hardening  
**Status:** Ready for evaluation

## What changed

### Client (`src/client/portal-main.tsx`)

1. **Token expiry check on page load** — Added `isTokenExpired()` helper. On portal load, stored tokens are now validated for expiry before establishing a session. Expired tokens are cleared, forcing the user back to the login screen instead of showing a phantom "logged in" state with failing API calls.

2. **Expired token handling in `ensureFreshToken()`** — Tokens that are already past expiry are now cleared immediately and return `null`, rather than falling through to the near-expiry refresh path.

3. **401 interception in `portalFetch()`** — Any API response with HTTP 401 now clears the stored portal token and redirects to `/portal` (login screen). Also handles the case where `ensureFreshToken()` returns null for non-auth endpoints by redirecting proactively.

### Server (`src/server/routes/portal-auth.ts`)

4. **Refresh endpoint: signature-only fallback for expired tokens** — The `/refresh` endpoint now does a two-pass token verification. First pass: strict `jwt.verify()` (validates signature AND expiry). If that fails, second pass: `jwt.verify()` with `{ ignoreExpiration: true }` (validates signature only). This allows local users whose tokens have just expired to still refresh their session. The downstream `refreshOidcToken()` already checks `access_state` in the database, so disabled/removed users are still blocked.

## Lifecycle enforcement summary

| Scenario | Behaviour |
|---|---|
| New local user logs in | bcrypt compare against stored hash → JWT issued → portal session starts |
| Disabled user attempts login | Login service returns "account is disabled" (403) |
| Disabled user with existing token | Portal auth middleware checks `access_state` on every request → 403 |
| Re-enabled user logs in | Login service finds active user (ORDER BY prioritises active) → normal login |
| Removed user attempts login | Login query returns removed row → "account has been removed" (403) |
| Removed user with existing token | Middleware checks `access_state` → 403; password_hash already cleared |
| Expired token on page load | Client detects expiry → clears token → shows login screen |
| Expired token during API call | Server returns 401 → client intercepts → clears token → redirects to login |
| OIDC user flow | Unchanged — all fixes are additive, no OIDC paths modified |
| Internal mode flow | Unchanged — internal auth bypasses portal JWT entirely |

## Nothing blocked or uncertain

The core login flow (admin creates user → user logs in → JWT issued → session active) was already structurally sound. The fixes address the session lifecycle edge cases that cause the "logged in but broken" state at runtime.
