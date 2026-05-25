# Phase 2 Iteration 4 — Detail-to-summary progression restoration

**Status:** Ready for evaluation  
**Date:** 2026-05-22  
**File changed:** `src/server/services/portal-chat.ts`

## What changed

### 1. Added missing `messageMeta` on ticket-creation acceptance (primary loop fix)

When `processStage` detects the customer accepting a ticket-creation offer via natural language ("yes", "go ahead", etc.), it calls `forceHandoff` to create the Jira ticket. Previously the return object omitted `messageMeta`, so the client never received the `{ type: 'confirmed', ticketKey }` signal needed to transition to the "Request Submitted" screen. The customer stayed in chat mode; their next message hit the `confirmed` stage guard and returned "This conversation has already been completed" — creating the error-and-re-offer loop.

**Fix:** Added `messageMeta: { type: 'confirmed', ticketKey }` to the return from the affirmative acceptance path in `processStage`.

### 2. Added missing `messageMeta` on max-exchanges forced handoff

The same signal was missing when the system auto-creates a ticket after exceeding `portal_chat_max_exchanges`. The client couldn't detect the confirmation.

**Fix:** Set `messageMeta = { type: 'confirmed', ticketKey, intent }` in the max-exchanges path in `sendMessage`.

### 3. Fixed "other" category handoff offer not setting `offeredTicketCreation`

When the detail stage hit `otherExchangeCount >= threshold`, it offered ticket creation but didn't set `meta.offeredTicketCreation = true`. On the next message, the affirmative acceptance handler at the top of `processStage` didn't fire (flag was false), so the flow fell through to `handleDetailStage` again — incrementing the counter and re-offering the ticket in a loop.

**Fix:** Added `meta.offeredTicketCreation = true` before the offer response.

### 4. Improved account field extraction for natural language

The regex-based account extraction only matched "for X" and "account: X" patterns, requiring a leading capital letter. Customers answering "which account?" with natural phrasing like "it's Acme Estates" or "Smith & Jones" were not matched, causing repeated clarification for the account field.

**Fixes:**
- Added three additional regex patterns: `X account`, `it's/this is/we're/I'm with X`, `account is/called X`
- Added short-answer fallback in `handleDetailStage`: when account is still missing and the customer's response is short (<=60 chars) and doesn't match greetings/affirmatives, treat it as a direct account answer

## What's preserved

- All Phase 1 behaviour (form-based intake, category routing, field config)
- Phase 2 conversational activation, hidden routing, natural clarification
- Phase 2 summary-body customer-facing improvement
- `forceHandoff` internal metadata persistence unchanged
- All other stage transitions unchanged

## Still blocked or uncertain

- The short-answer account fallback is intentionally aggressive for the "account is the only missing field" case. If a customer provides a very short non-account response at the wrong moment, it could be misassigned as the account name. This is bounded by the 60-char limit and the greeting/affirmative exclusion filter.
- LLM-based field extraction may still miss account names in longer multi-topic messages. The regex improvements and short-answer fallback cover the tested conversational paths but are not a general extraction solution.

## Verification

- TypeScript compilation passes cleanly (`tsc --noEmit`)
- The four changes are narrowly scoped to the identified behavioural blockers
- The conversational journey from clarification → ticket-creation acceptance → confirmation screen should now complete without looping
