# Phase 2 Iteration 20 — Downstream Summary Fidelity Hardening

**Status:** Ready for evaluation
**Date:** 2026-05-23

## What Changed

All changes in `src/server/services/portal-chat.ts`.

### 1. Inline description edits now propagate downstream (post-summary correction fix)

In `confirmAndSubmit()`, when the customer edits the description via the inline summary card, `meta.synthesizedDescription` is now cleared. Previously, the old LLM-synthesized description would override the customer's explicit correction in the downstream Jira ticket, because the downstream path uses `meta.synthesizedDescription || f.description` and synthesis was never cleared on inline edits. The customer's visible edit now becomes the canonical downstream description.

### 2. Inline account edits are now cleaned

Account values edited inline in the summary card are now run through `cleanAccountName()` before storage. Previously only chat-based edits went through cleaning — inline edits stored the raw value, which could include trailing fragments.

### 3. Phone-number vs listing/reference separation strengthened

The bare-number fallback path in `extractPropertyFieldsFromText()` now additionally checks `isPhoneLikeValue(num)` before accepting a number as a listing ID. Previously the keyword-tagged path used `isPhoneLikeValue` but the bare-number path used a set of inline heuristics that didn't fully overlap, creating a gap where some phone-shaped numbers could leak into listing ID.

### 4. Account name cleaning improved

`cleanAccountName()` now handles:
- Trailing "account" / "account's" (e.g. "ABC Corp account" → "ABC Corp")
- Trailing possessive "'s" (e.g. "ABC Corp's" → "ABC Corp")
- Standalone "it's" prefix (e.g. "it's ABC Corp" → "ABC Corp")
- Internal double-space collapsing

## Nothing Blocked

All changes are self-contained in portal-chat.ts. Type-check passes cleanly.

## Preserved Behaviour

- All Phase 1 behaviour preserved (no structural changes to routing, stage flow, or field config)
- All earlier Phase 2 gains preserved (conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, summary confirmation recognition, summary review in system-offer flows, bundled URL capture, URL-first recognition, vague follow-up verification, portal/channel clarification recovery, user-facing summary experience)
- Chat-based summary edits (handleSummaryEdit) unchanged
- Summary card display logic unchanged
- Synthesis pipeline unchanged
