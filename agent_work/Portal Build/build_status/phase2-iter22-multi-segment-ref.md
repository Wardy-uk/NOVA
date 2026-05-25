# Phase 2 Iteration 22 — Multi-segment reference preservation

## Status: Ready for evaluation

## What changed

**File:** `src/server/services/portal-chat.ts`

**Two regex patterns updated** (extraction + correction paths):

Old pattern: `(?:[-_]\d{2,5})?`
- Allowed only ONE optional trailing segment
- Segment had to be digits only (2-5 chars)
- `RM-45821-A` → captured as `RM-45821` (truncated)
- `ABC-12345-XZ` → captured as `ABC-12345` (truncated)

New pattern: `(?:[-_][A-Za-z0-9]{1,10})*`
- Allows ZERO OR MORE trailing segments
- Each segment can contain letters and digits (1-10 chars)
- `RM-45821-A` → captured as `RM-45821-A` (full)
- `ABC-12345-XZ` → captured as `ABC-12345-XZ` (full)

**Locations changed:**
1. `extractPropertyFieldsFromText()` (line ~517) — primary extraction from customer messages
2. `refreshStructuredFieldsFromCorrection()` (line ~224) — correction/restatement path

**What is preserved:**
- Initial anchor still requires letters-separator-digits (`[A-Za-z]{2,5}[-_]\d{2,5}`), so no false positives
- `isPhoneLikeValue()` guard still applied on all matches
- All other extraction tiers (keyword-prefixed, bare numeric) unchanged
- LLM extraction path unchanged (already handles full references correctly)
- Phone-number protection unchanged
- Account extraction, correction propagation, and all Phase 1 behaviour unchanged

## Nothing blocked or uncertain

The fix is minimal — two regex changes in the same file, same pattern. No architectural changes, no new code paths, no new dependencies.
