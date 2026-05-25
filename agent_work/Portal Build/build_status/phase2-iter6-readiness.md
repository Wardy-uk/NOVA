# Phase 2 Iteration 6 — Build Status

**Slice:** Multi-turn progression plus submission recovery
**Status:** Ready for evaluation
**Date:** 2026-05-22

## What Changed

### 1. Jira ticket creation failure — FIXED (root cause)

**File:** `src/server/services/portal-jira.ts`

The Jira REST client uses API v3 (`/rest/api/3/`), which requires the `description` field in Atlassian Document Format (ADF). The `createTicket` method was passing description as a plain string, causing a 400 error on every ticket creation attempt. The `addComment` method already used ADF correctly.

**Fix:** Added a `textToAdf()` helper that converts plain text (with paragraph breaks and line breaks) into valid ADF, and wired it into `createTicket`. This fixes all ticket creation paths:
- Summary-stage confirmation (natural language "yes" → `confirmAndSubmit`)
- Summary card button (POST `/confirm` → `confirmAndSubmit`)
- Force handoff (max exchanges → `forceHandoff`)
- Ticket-offer acceptance (detail stage → `forceHandoff`)

### 2. Multi-turn detail extraction stalling — FIXED

**File:** `src/server/services/portal-chat.ts` (handleDetailStage)

In multi-turn journeys, field extraction only ran against the current message. If a customer mentioned their account name or error details in an earlier message but it wasn't captured by extraction patterns at that time, it was never re-examined — causing the detail stage to loop asking for already-provided information.

**Fix:** After extracting from the current message, if key fields are still missing, re-extract from the full accumulated description (which contains all user messages concatenated). This gives regex and domain-specific extractors a second pass over the complete conversation content.

### 3. Detail-stage ticket-offer acceptance — FIXED

**File:** `src/server/services/portal-chat.ts` (isAffirmativeResponse)

The affirmative response detection was anchored to the start of the message (`^yes\b`), missing responses like "that would be great, yes please" or "I'd like to create a ticket". Some customer acceptance patterns during detail stage were not matched.

**Fix:** Broadened `isAffirmativeResponse` to also match:
- Ticket-creation intent anywhere in the message ("create a ticket", "raise a request")
- Affirmative phrases not at the start ("yes please", "sounds good", "go ahead") in short messages

## Preserved Behaviour

- All Phase 1 behaviour unchanged (no modifications outside portal-chat.ts and portal-jira.ts)
- Earlier Phase 2 gains preserved: conversational activation, hidden routing, natural clarification, summary-body wording, summary-stage confirmation recognition
- No changes to the client component, types, or routes

## Build Verification

- TypeScript compiles cleanly (`tsc --noEmit` passes with no errors)
- Changes are narrow and local: 3 targeted modifications across 2 files

## Still Uncertain

- The ADF conversion is minimal (paragraphs + hard breaks). If Jira descriptions need richer formatting (bold, links, lists), the `textToAdf` helper may need extension — but for the current intake flow, plain text paragraphs are sufficient.
- The multi-turn re-extraction runs regex patterns over the accumulated description on each round. This is cheap but could theoretically over-match on very long descriptions. The existing `if (!field)` guards prevent overwriting already-captured values.
