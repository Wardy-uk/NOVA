# Runtime Path Validation — Portal Chat Intake

**Date:** 2026-05-18
**Status:** Root cause identified

## Summary

The evaluator never executes Iteration 3 logic. It hits a **Vite dev-server mock plugin** that implements its own hardcoded category-picker flow, completely bypassing the real `portal-chat.ts` service.

## Observed Runtime Path

### Evaluator path (what actually runs)

```
_eval-v3b.mjs
  → puppeteer opens http://127.0.0.1:5174/portal?codexTestUser=1
  → Vite dev server (port 5173/5174) handles request
  → codexPortalMockPlugin (Vite middleware, registered BEFORE proxy rules)
  → Mock intercepts ALL /api/portal/* routes when codex test cookie is present
  → POST /api/portal/chat/sessions/:id/messages
  → Mock handler at codexPortalMockPlugin.ts lines 478-506
  → ALWAYS returns "Which area does this relate to?" with 4-option category_picker
  → Request NEVER reaches Express backend (port 3069)
```

### Production path (what Iteration 3 modified)

```
Customer → portal UI → POST /api/portal/chat/sessions/:id/messages
  → Express backend (port 3069)
  → portal-chat.ts → processStage() → handleIntentStage()
  → handleIntentWithLlm() → LLM classifies message
  → If website + confidence ≥ 0.6: conversational flow (NO category picker)
  → If website + confidence 0.4–0.6: conversational clarification
  → If non-website or confidence < 0.4: category picker fallback
```

## Where Category-Picker Dominance Originates

**File:** `src/client/dev/codexPortalMockPlugin.ts`, lines 478–484

```typescript
if (state.stage === 'intent') {
  state.stage = 'category';
  assistant = createAssistantMessage(
    sessionId,
    'Which area does this relate to?',
    { type: 'category_picker', categories: CATEGORY_OPTIONS },
  );
}
```

This is a hardcoded state machine with three stages:
1. `intent` → always emits category picker (4 options)
2. `category` → resolves category from text, asks "describe what should be happening"
3. anything else → builds summary card

The mock has **no LLM call**, **no confidence scoring**, **no conversational routing**, and **no awareness of Iteration 3 changes**. It was written as a deterministic test harness for the portal shell UI, not for intake behaviour validation.

## Mock vs Production Path Comparison

| Aspect | Mock (evaluator hits this) | Production (Iteration 3 lives here) |
|--------|---------------------------|--------------------------------------|
| Entry point | `codexPortalMockPlugin.ts:478` | `portal-chat.ts:428` (handleIntentStage) |
| LLM classification | None | Full ConversationalIntakeSchema |
| Website detection | None | LLM confidence + keyword fallback |
| Category picker | Always shown, unconditionally | Only for non-website or low-confidence |
| Field extraction | None from opening message | LLM extracts subject, account, URL, etc. |
| Conversational ack | None | LLM-generated acknowledgment of specific request |
| Re-description | Always ("describe what should be happening") | Never for website requests with detail |

## Whether Iteration 3 Logic Executes

**No.** Iteration 3 logic in `portal-chat.ts` is **syntactically present and structurally correct** but is **never reached** by the evaluator because:

1. The mock plugin is registered as Vite middleware (`configureServer`) at plugin index 0
2. Vite middleware runs BEFORE the proxy rules in `vite.config.ts:63-76`
3. The mock checks `hasCodexTestCookie(req)` (line 383) — the evaluator sets this cookie
4. When the cookie is present, the mock handles ALL `/api/portal/*` routes and returns without calling `next()`
5. The Express backend proxy at port 3069 is never consulted

The Iteration 3 code would execute correctly for:
- Production users (no codex test cookie)
- Dev users accessing via the Express backend directly (port 3001/3069)
- Any request that does NOT have `portal_codex_test_user=1` cookie

## Mock's 4-Option Category Set vs Production's 9-Option Set

The mock defines only 4 categories (line 92-97):
- My Website, My Account, Billing & Contracts, Something Else

Production `buildCategoryQuestion()` (portal-chat.ts:1233-1254) defines 9 categories:
- My Website, My Account, Email Marketing, LeadPro & CRM, Data Feeds & Integrations, Property Listings, Onboarding & Setup, Billing & Contracts, Something Else

This means the evaluator is testing against a **different category set** than production would show even if the category picker did appear.

## Likely Root Cause of Evaluator/Runtime Mismatch

The mock plugin was created to support UI development of the portal shell (ticket list, detail view, status flow, login). It provides deterministic, LLM-free responses so the portal UI can be developed and tested without a running backend or API keys.

When Iteration 3 modified the backend intake behaviour in `portal-chat.ts`, the mock was not updated to reflect those changes. The evaluator was then run against the mock, which still implements the original category-first flow.

This is not a bug in Iteration 3's implementation. It is a **test infrastructure gap** — the evaluator validates the mock's behaviour, not the production service's behaviour.

## Recommended Next Action

**Option A (minimal, recommended):** Run the evaluator against the Express backend instead of the Vite dev server. Change the evaluator URL from `http://127.0.0.1:5174/portal` to `http://127.0.0.1:3069/portal` (or use 3001 in dev). This will exercise the real `portal-chat.ts` code path including LLM classification.

**Option B (complementary):** Update the mock plugin to mirror Iteration 3's conversational routing for website requests, so that UI-only testing reflects the intended behaviour. This keeps the mock useful for offline development but requires maintaining parity.

**Option C (structural):** Add a conditional bypass in the mock — when a specific query param or header is set (e.g., `?mockBypass=1`), the mock calls `next()` instead of handling the request, allowing it to fall through to the Express proxy. This lets the evaluator choose mock vs real backend per-run.

Do **not** modify production behaviour. The production code is correct. The issue is purely in the test harness routing.
