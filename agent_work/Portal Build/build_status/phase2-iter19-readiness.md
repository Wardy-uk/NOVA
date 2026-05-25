# Phase 2 Iteration 19 — Extraction Accuracy and Summary-Readiness Hardening

**Status:** Ready for evaluation
**Date:** 2026-05-23

## What Changed

### 1. Phone number vs listing/reference ID separation (portal-chat.ts)
- **Keyword-prefixed match** (e.g. "ref 07712345678"): now validates the captured number through `isPhoneLikeValue()` before accepting it as a listing ID. Previously, a phone number following "ref" or "listing" would be incorrectly stored as a listing reference.
- **Bare digit fallback**: added rejection of 7-9 digit numbers starting with 0 (partial UK phone numbers like area codes), in addition to the existing 10-13 digit rejection.
- **`isPhoneLikeValue()` strengthened**: now treats any 7+ digit number starting with 0 as phone-like (was only 10+), catching partial UK phone numbers that were previously leaking into listing ID fields.

### 2. Account name capture reliability (portal-chat.ts)
- **Regex account patterns** in `extractFieldsRegex()`: changed from requiring uppercase first character `[A-Z]` to allowing any letter `[A-Za-z]` with case-insensitive flag. Customers typing "acme corp" or "the smiths agency" in lowercase are now captured by regex when LLM extraction misses them.
- **Explicit account patterns** in detail-stage long-message handling: same case-insensitivity fix applied.
- **Opening message regex extraction**: added `extractFieldsRegex()` call in `handleIntentStage()` so that account names, browsers, and contact preferences are extracted from the first message BEFORE the LLM classification path. This ensures account is available when the LLM determines all fields are present and goes directly to summary.

### 3. Summary readiness — late detail absorption (portal-chat.ts)
- The `extractFieldsRegex()` call added in `handleIntentStage()` (Fix 2 above) also addresses the summary readiness gap: previously, if the opening message contained an account name that only regex could catch (not the LLM), the summary could be built without it. Now regex runs first.

### 4. Raw-concatenation fallback cleanup (portal-chat.ts, portal-types.ts)
- **Prose joining**: when LLM synthesis fails and the fallback renders the filtered transcript, lines are now joined with spaces and punctuation normalisation instead of preserving transcript-style line breaks. Produces "The phone number is wrong on our contact page. It shows 0161 555 1234 but should be 0161 555 6789." instead of multi-line transcript fragments.
- **Synthesis retry**: on first synthesis failure, the system now allows one retry (next time `buildSummaryCard` is called or `synthesizeSummaryFields` is re-invoked) instead of permanently marking synthesis as done. Added `synthesisRetried` flag to `IntakeSessionMetadata`.

## Files Modified
- `src/server/services/portal-chat.ts` — all four fixes
- `src/shared/portal-types.ts` — added `synthesisRetried` metadata field

## What's Not Changed
- All Phase 1 behaviour preserved
- All earlier Phase 2 gains preserved (conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, summary confirmation recognition, summary review in system-offer flows, bundled URL capture, URL-first recognition, vague follow-up verification, metadata/visible-summary alignment, description synthesis consistency, portal/channel clarification recovery)
- No broad redesign or architecture changes
- No changes to ticket submission, KB deflection, or Jira integration

## Nothing Blocked or Uncertain
All changes are narrow, local, and type-check clean.
