# Portal Phase3 Iteration 4 — Build Status

**Slice:** Reopened / follow-up ticket continuity final hardening
**Status:** Ready for evaluation
**Date:** 2026-05-24

## What Changed

### 1. Frustration override yields to follow-up with ticket reference
`processStage()` in portal-chat.ts now checks whether a frustration-flagged message also matches escalation/chase patterns AND contains a Jira ticket reference (NT-xxx / NTPJ-xxx). When all three are true, frustration handling is suppressed and the message routes through the normal intent stage as a follow-up case.

**File:** `src/server/services/portal-chat.ts` (~line 962)

### 2. followUpTicketKey populated even without Jira cache hit
Three code paths (handleIntentWithLlm, handleIntentWithoutLlm, handleStatusIntent, handleDetailStage) now set `meta.followUpTicketKey` from the regex-extracted ticket reference *before* attempting the Jira cache lookup. If the cache returns nothing or errors, the key is still preserved. When cache lookup fails with a ticket ref present, the response acknowledges the ref and asks for what still needs attention — no redundant "what's your ticket reference?" prompt.

**File:** `src/server/services/portal-chat.ts` (~lines 1471, 1578, 1791, 2098)

### 3. NT/NTPJ ticket references excluded from listingId extraction
The alphanumeric listing-ref regex in `extractPropertyFieldsFromText()` and `refreshStructuredFieldsFromCorrection()` now rejects patterns starting with `NT-` or `NTPJ-`. This prevents follow-up ticket references from appearing as "Listing ref" in the summary card. They instead flow through `followUpTicketKey` → "Related ticket" in the summary.

**File:** `src/server/services/portal-chat.ts` (~lines 549, 228)

### 4. Redundant ticket-reference prompts suppressed
Because followUpTicketKey is now set at extraction time (change 2), the existing guard `if (meta.category === 'followup' && !meta.followUpTicketKey)` in the detail stage correctly skips the "could you tell me the ticket reference" question. The detail-stage cache-miss path now also returns a response acknowledging the ref instead of falling through silently.

## Verification

- TypeScript compiles cleanly (`npx tsc --noEmit` — no errors).
- No changes to portal-types.ts, portal-intake.ts, or frontend components were needed. The existing frontend summary card already renders `followUpTicketKey` as "Related ticket".

## Regression Risk

- Low. Changes are confined to follow-up routing priority and ticket-ref extraction guards.
- Frustration handling for non-follow-up messages is unchanged (the new guard only triggers when escalation/chase patterns AND a ticket ref are both present).
- Existing follow-up patterns from Iteration 3 are preserved — the only change is that the frustration override no longer intercepts them when a ticket reference is present.

## Still Blocked or Uncertain

- Nothing blocked. The four named defects (frustration interception, followUpTicketKey not set, Listing ref display, redundant prompts) are all addressed.
- Edge case: messages with frustration + chase language but *no* ticket reference still route through frustration handling. This is intentional — without a ticket ref, there's no follow-up continuity to preserve.
