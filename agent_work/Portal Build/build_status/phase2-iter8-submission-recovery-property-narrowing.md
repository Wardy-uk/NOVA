# Phase 2 Iteration 8 — Submission-path recovery plus property-question narrowing

**Status:** Ready for evaluation
**Date:** 2026-05-22

## What Changed

### 1. Submission-path recovery (offer/fail/re-offer loop eliminated)

**Root cause:** When `confirmAndSubmit` throws (Jira unavailable, config issue), the error propagated to the outer catch in `sendMessage`, which re-offered ticket creation. The next "yes" triggered `forceHandoff`, which also failed, creating an infinite loop.

**Fixes in `portal-chat.ts`:**

- **Summary-stage confirmation** (`case 'summary'`): Wrapped `confirmAndSubmit` in try/catch. On failure, sets `meta.submissionFailed = true` and returns a clear message directing the customer to the Submit button or email fallback. Does NOT re-offer ticket creation.

- **Offered-ticket-creation handler** (top of `processStage`): Wrapped `forceHandoff` in try/catch. On failure, sets `meta.submissionFailed = true`, moves stage to `confirmed`, and returns a clear email-contact fallback. No further offers are possible.

- **Outer error handler** (`sendMessage` catch): When `meta.submissionFailed` is already true, returns a final stable fallback instead of re-offering the broken path. Stage moves to `confirmed` to stop further processing.

- **New metadata field:** `submissionFailed?: boolean` added to `IntakeSessionMetadata` in `portal-types.ts`.

**Behavioural result:** After a submission failure, the customer sees one clear fallback message (email contact). No repeated offers. The button path on the summary card still works independently (the `/confirm` route already had its own error handling returning the error to the client).

### 2. Property-question narrowing

**Root cause:** `getPropertyMissingFields` always required `propertyIdentifier` (address or listing ID) regardless of subcategory or whether the customer had indicated a site-wide issue. This caused repeated "which property?" questions in feed-sync and explicitly site-wide journeys.

**Fixes in `portal-chat.ts`:**

- **`getPropertyMissingFields`**: Property identifier is now skipped for `property_feed_sync` subcategory (feed-level issues are typically system-wide, not about a single property). Also skipped when `propertyAddress` already contains site-wide language.

- **`SITE_WIDE_PATTERNS`**: Expanded to catch additional natural expressions: "not specific", "not about a specific", "not a particular", "no particular property/listing", "none in particular", "all listings", "the whole feed", "every single one", "not just one property/listing".

**Behavioural result:**
- Feed-sync issues progress without being asked for a specific property address.
- When a customer says "it's not one specific property" or "all our listings" in response to the property question, it's immediately recognised as site-wide and stops asking.
- Genuinely property-specific issues with a named address still work efficiently — this path was not touched.

## Files Modified

- `src/server/services/portal-chat.ts` — submission error handling (3 locations), `getPropertyMissingFields`, `SITE_WIDE_PATTERNS`
- `src/shared/portal-types.ts` — added `submissionFailed` to `IntakeSessionMetadata`

## What's Preserved

- All Phase 1 behaviour (conversational activation, hidden routing, category picker elimination)
- Earlier Phase 2 gains (natural clarification, summary rendering, confirmation recognition, efficient property-specific path)
- The button-click submission path on the summary card (independent error handling via the `/confirm` route)
- All other category domains (website, account, email, etc.) unaffected

## Still Uncertain

- Whether there are additional Jira configuration issues causing the submission failures in the evaluation environment (the fix handles the symptom — looping — but the underlying Jira connectivity is an environment concern)
- Whether the expanded SITE_WIDE_PATTERNS are sufficient for all natural customer expressions or whether the LLM follow-up generator might still occasionally ask for a property address in site-wide journeys (the template fallback is now correct; the LLM path is harder to guarantee)

## Build Verification

TypeScript compiles cleanly (`tsc --noEmit` passes with no errors).
