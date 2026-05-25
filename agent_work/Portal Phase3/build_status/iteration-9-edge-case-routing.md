# Build Status — Iteration 9: Edge-case Routing Sensitivity Hardening

## Status: Ready for evaluation

## What Changed

### 1. Letters/correspondence precedence over website (portal-chat.ts)

**Problem**: When a customer mentions letters/correspondence AND incidentally mentions website detail (e.g. "I need market appraisal letters for properties on our website catchment"), the LLM's `isWebsiteRelated` classification could fire first (line 1319) and route to website, skipping the deterministic letters detection that came later (line 1522).

**Fix**: Moved the `detectLettersFromKeywords()` check to run BEFORE the `isWebsiteRelated` LLM gate. Letters keyword signals now take precedence over LLM website classification. The later duplicate letters block was removed (replaced with a comment pointer).

### 2. Follow-up detection for "is not fixed" without "still" (portal-chat.ts)

**Problem**: The `ESCALATION_CHASE_PATTERNS` regex matched `still (not (fixed|resolved|...))` but not the plain form `is not fixed`. A customer saying "NT-12345 is not fixed" would not trigger the follow-up path.

**Fix**: Added `is not (fixed|resolved|sorted|done|working)` as an alternative branch in the ESCALATION_CHASE_PATTERNS regex.

## Files Modified

- `src/server/services/portal-chat.ts` — two targeted changes (letters precedence + follow-up regex)

## Regression Risk

- **Low**. Letters detection uses the same `detectLettersFromKeywords` function and routing logic, just moved earlier. Only affects messages that contain BOTH letters keywords AND website mentions.
- The regex addition is additive — existing patterns remain unchanged.

## Blocked/Uncertain

Nothing blocked. Both changes are self-contained.
