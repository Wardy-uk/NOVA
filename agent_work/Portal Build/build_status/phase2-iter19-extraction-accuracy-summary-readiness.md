# Phase 2 Iteration 19 — Extraction Accuracy & Summary-Readiness Hardening

**Status:** Ready for evaluation
**Date:** 2026-05-23
**File changed:** `src/server/services/portal-chat.ts`

## What Changed

### 1. Phone-number vs listing/reference separation (lines 465–490)
- Added `isPhoneLikeValue()` helper that validates whether a string looks like a phone number (UK domestic format, international +44/+353/+1 prefix, or formatted phone pattern).
- Bare-number fallback now rejects international-prefix numbers (e.g. `447712345678`) and numbers that appear near formatted phone patterns in the same message.
- LLM-extracted `listingId` values are now guarded by `isPhoneLikeValue()` — phone-shaped values from LLM extraction are rejected before being stored as listing references.

### 2. Account name capture reliability (lines 1868–1900)
- Added explicit account-name extraction for longer messages (>60 chars) with patterns like "the account is X", "we're X", "I'm with X", "this is for X account".
- Previously only the short-answer fallback (≤60 chars) captured account names in the detail stage. Customers who mention their account name embedded in a longer message now get it captured.

### 3. Summary-readiness — late detail absorption (lines 2022, 2420, 2461)
- When description grows during multi-turn detail gathering (new user messages appended), `synthesisDone` and `synthesizedDescription` are now reset. This forces re-synthesis so the latest detail appears in the summary.
- When description is edited during summary review (regex or LLM path), `synthesisDone` is now also reset alongside `synthesizedDescription`, ensuring the summary reflects the edit.

### 4. Raw-concatenation cleanup (lines 2337–2357, 2385–2388)
- Synthesis now triggers for conversational flows where the opening message starts with a greeting (hi/hello/hey/good morning), even if the description is short and single-turn. Previously these bypassed synthesis and showed a raw greeting-prefixed description.
- Fallback description cleaning now handles partial field-value matches (e.g. "the account is X" matching field value "X", email addresses appearing within short surrounding text, office names with "the X office" phrasing).

## Preserved Behaviour
- All Phase 1 behaviour preserved (no changes outside portal-chat.ts).
- All earlier Phase 2 gains preserved: conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation, preserved summary review in system-offer flows, bundled URL capture, URL-first recognition, vague follow-up verification, metadata/visible-summary alignment, description synthesis consistency, portal/channel clarification recovery.

## Nothing Blocked
All changes compile cleanly (`tsc --noEmit` passes). No new dependencies or schema changes.
