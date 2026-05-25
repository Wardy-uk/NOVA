# Phase 2 Iteration 5 — Submission-path restoration

**Status:** Ready for evaluation  
**Date:** 2026-05-22  
**Files changed:** `src/server/services/portal-chat.ts`, `src/client/components/portal/PortalChat.tsx`, `src/shared/portal-types.ts`

## What changed

### 1. Fixed duplicate message insertion on natural-language confirmation (critical)

When a customer typed "yes" at the summary stage, `confirmAndSubmit()` inserted its own confirmation message (without metadata), and then `sendMessage()` inserted a second message (with the `type: 'confirmed'` metadata). The `SELECT TOP 1 ORDER BY created_at DESC` query could return the metadata-less message, causing the client to never detect the confirmation signal. The ticket was created server-side but the client stayed on the summary card.

**Fix:** Added `skipMessage` option to `confirmAndSubmit()`. The natural-language confirmation path in `processStage()` now passes `{ skipMessage: true }`, so only `sendMessage()` inserts the message — with the correct `type: 'confirmed'` metadata. The button-click confirm route continues to insert its own message as before.

### 2. Fixed client error handling on confirm endpoint failure

When the `/confirm` endpoint returned a 500 or `{ ok: false }`, the client logged to console but showed nothing to the user. The submit button stopped spinning and the user was stuck with no feedback and no way to know what happened.

**Fix:** Added `submitError` state. On server error or network failure, the SummaryCard now shows a red error banner with the specific error message. The submit button changes to "Try again" so the user knows they can retry. Error is cleared on the next submit attempt.

### 3. Added detail-stage clarification cap to prevent infinite loops

When the LLM field extraction repeatedly failed to capture a field (e.g., account name in unusual phrasing), the system kept asking for it indefinitely. Customers got stuck in a clarification loop and could never reach summary.

**Fix:** Added `detailRounds` and `lastMissingCount` tracking to session metadata. After 3 consecutive rounds where the missing field count hasn't decreased, the system stops asking and auto-progresses to KB check / summary with whatever has been collected. The counter resets when extraction makes progress (missing count decreases).

## What's preserved

- All Phase 1 behaviour (form-based intake, category routing, field config)
- Phase 2 conversational activation and hidden routing
- Phase 2 natural clarification tone and vocabulary firewall
- Phase 2 summary-body customer-facing wording
- Phase 2 iter4 fixes (messageMeta on acceptance, offeredTicketCreation flag, account extraction improvements)
- Button-click confirm path still inserts its own message
- `forceHandoff` path unchanged

## Still blocked or uncertain

- The clarification cap of 3 rounds is a fixed threshold. If a customer genuinely needs more than 3 exchanges to provide required fields, they'll reach summary with incomplete data. The ticket will still be created — the missing fields just won't be populated. This is preferable to the customer being stuck in an infinite loop.
- If `portalJira.createTicket()` itself fails (Jira API down), both the natural-language and button-click paths will still fail. The difference now is that the button-click path shows the error to the user and allows retry, and the natural-language path surfaces the error via the existing `sendMessage` error handler.

## Verification

- TypeScript compilation passes cleanly (`tsc --noEmit`)
- All three changes are narrowly scoped to the identified submission-path blockers
- The conversational journey from late clarification → summary → confirmation → ticket creation should now complete reliably through both paths (natural language and button click)
