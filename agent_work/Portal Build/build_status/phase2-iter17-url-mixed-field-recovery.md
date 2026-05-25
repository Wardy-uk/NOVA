# Phase 2 Iteration 17 — URL clarification and mixed-field extraction recovery

**Status:** Ready for evaluation  
**Date:** 2026-05-23  
**File changed:** `src/server/services/portal-chat.ts`

## What changed

### 1. Broader URL recognition (extractUrlFromText)
Previously only matched `https?://` prefixed URLs. Customers who provided bare domains (`www.smithjones.co.uk`, `example.com`) were not captured, causing the system to loop asking for a URL that was already given.

Now matches three tiers:
- `https://` / `http://` prefixed (highest confidence, unchanged)
- `www.` prefixed domains
- Bare domains with common TLDs (`.co.uk`, `.com`, `.org`, `.net`, `.agency`, `.io`, `.uk`, `.biz`, `.tech`, `.info`) — excludes email-like fragments

### 2. Phone number protection on listing ID extraction (extractPropertyFieldsFromText)
The fallback `\b(\d{5,})\b` pattern was capturing phone numbers as listing/reference IDs. Now guarded:
- Rejects numbers in phone-related context (preceded/followed by "phone", "tel", "mobile", etc.)
- Rejects 10-13 digit numbers starting with `0` (UK phone number shape)
- Keyword-preceded matches (`property 12345`, `listing ref 67890`) remain unaffected

### 3. URL boundary in account name extraction (extractFieldsRegex)
Account name regex patterns could capture URL fragments when account and URL were provided in the same message. Added a URL boundary check that truncates the captured account name before any URL-like pattern (`https://`, `www.`, or bare domain TLD).

### 4. URL fragment cleanup in cleanAccountName
Added two cleanup rules to strip URL fragments that may have leaked past the regex boundary:
- Strips trailing `https://...` or `www.` URLs
- Strips trailing bare domain patterns (`.co.uk`, `.com`, etc.)

## What was preserved
- All Phase 1 behaviour unchanged
- All prior Phase 2 gains: conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, natural summary confirmation recognition, preserved summary review in system-offer flows, bundled URL capture, vague follow-up verification, metadata/visible-summary alignment, description synthesis consistency
- Global URL capture at processStage level (line 794-797) continues to work — now benefits from the improved regex
- LLM-based URL extraction path unchanged (still a supplementary layer)
- Keyword-prefixed listing ID extraction (`property 12345`) unchanged

## Nothing blocked or uncertain
All changes are narrow regex improvements. TypeScript compiles cleanly. No architectural changes, no new dependencies, no new LLM calls.
