# Phase 2 Iteration 3 — Completion-Stage Conversational Coherence

**Status:** Ready for evaluation  
**Date:** 2026-05-22

## What changed

### 1. Conversational subject line (portal-chat.ts, `buildSummaryCard`)

**Before:** Auto-generated subject in conversational mode used internal taxonomy:
`[Portal] My Website — Content update: The phone number on our contact page is wrong`

**After:** Conversational path derives the subject from the customer's own first sentence:
`[Portal] The phone number on our contact page is wrong`

- Only applies when `meta.conversational === true` and a description exists
- Non-conversational (category-picker) path retains the original `Category — Subcategory: desc` format unchanged
- The `[Portal]` prefix is kept for internal routing identification

### 2. Typed natural-language confirmation at summary stage (portal-chat.ts, `processStage`)

**Before:** Any message typed at the summary stage was routed to `handleSummaryEdit`, which re-extracted fields and re-displayed the summary card. Typing "yes", "looks good", or "please go ahead" triggered field extraction on those words, producing a confusing loop.

**After:** The summary-stage case in `processStage` now checks `isAffirmativeResponse(content)` first. If the customer confirms naturally (e.g. "yes", "go ahead", "submit that", "sure"), the request progresses directly to `confirmAndSubmit`, creating the Jira ticket and returning a confirmation message. Non-affirmative messages still route to `handleSummaryEdit` as before.

- The `ChatMessageMetadata` type gained a `'confirmed'` type and `ticketKey` field
- The client (`PortalChat.tsx`) detects `confirmed` message metadata from the response and updates session/ticket state, showing the confirmed-ticket UI
- Uses the existing `isAffirmativeResponse` helper (same patterns as handoff confirmation)

## Files modified

- `src/server/services/portal-chat.ts` — subject generation + summary-stage confirmation routing
- `src/shared/portal-types.ts` — `ChatMessageMetadata` type extended
- `src/client/components/portal/PortalChat.tsx` — client-side confirmed-message detection

## Preserved behaviour

- Phase 1 conversational classification, KB check, and detail gathering: unchanged
- Phase 2 iter 1 category-picker removal and clarification continuity: unchanged
- Phase 2 iter 2 customer-facing summary-body improvement: unchanged
- Non-conversational (category-picker) subject format: unchanged
- Summary card confirm button: unchanged (still calls the confirm route directly)
- Summary edit via natural language: unchanged (non-affirmative messages still handled as edits)
- Force-handoff subject format: unchanged

## Nothing blocked or uncertain

Both changes are narrow and local. TypeScript compiles clean.
