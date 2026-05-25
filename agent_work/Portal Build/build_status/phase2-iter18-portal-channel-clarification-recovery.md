# Phase 2 Iteration 18 — Portal/Channel Clarification Recovery

**Status:** Ready for evaluation
**Date:** 2026-05-23

## What Changed

### 1. Website portal inference from URL (`portal-chat.ts`)
- `extractPropertyFieldsFromText` now infers `affectedPortals = 'Website'` when a non-portal-domain URL is already captured (e.g., customer's own website URL, not rightmove.co.uk)
- `getPropertyMissingFields` skips requiring `affectedPortals` when a customer website URL already makes the channel obvious
- This prevents the portal clarification question from ever being asked in the most common case: customer provides a website URL and describes a website issue

### 2. Portal clarification loop prevention (`portal-chat.ts`, `portal-types.ts`)
- Added `portalClarificationAsked` flag to `IntakeSessionMetadata`
- If the system has already asked "is this affecting your website, portals, or both?" once and the customer's response didn't resolve the field, the system defaults to 'Website' and progresses rather than re-asking
- This is a hard cap at one portal clarification attempt — prevents indefinite looping

### 3. Broader portal keyword recognition
- Added "our site", "the site", "my site" as equivalents of "website" in portal detection
- Added "both", "all of them", "everywhere", "all portals" as valid portal clarification responses (maps to "Website, Property portals")

### 4. Account fragment leakage reduction
- `isLikelyAccountName` now rejects standalone portal/channel names ("Rightmove", "the website", "both", etc.) that would otherwise be captured as account names
- Short-answer fallback regex expanded to reject portal/channel vocabulary ("website", "rightmove", "zoopla", "our site", "both", "all of them", etc.)
- `cleanAccountName` strips trailing portal names from captured account text

## Files Modified
- `src/server/services/portal-chat.ts` — inference logic, loop prevention, extraction tightening
- `src/shared/portal-types.ts` — added `portalClarificationAsked` to `IntakeSessionMetadata`

## Build Status
- TypeScript compilation: clean (no errors)

## Nothing Blocked
All changes are self-contained within the portal/channel clarification path. No broader architectural changes needed.
