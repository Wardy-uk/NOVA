# Phase 2 Iteration 16 — Field-boundary and edit-value hardening

**Status:** Ready for evaluation  
**Date:** 2026-05-23

## What changed

Three targeted fixes in `src/server/services/portal-chat.ts`:

### 1. Account extraction boundary hardening
- **`ACCOUNT_STOP` regex** (extractFieldsRegex): Added ~20 more stop words — `portal`, `system`, `platform`, `photos`, `images`, `listings`, `login`, `password`, `access`, `keeps`, `shows`, `display`, `error`, `problem`, `issue`, `when`, `because`, `since`, `however`, `also`, possessive pronouns. This prevents account name capture from running past the actual name into trailing problem/content text.
- **`cleanAccountName()`**: Added stripping for `portal|system|platform` suffixes (alongside existing `website|site`), expanded the trailing-phrase regex to catch more problem nouns (`photos`, `images`, `listings`, `login`, `password`), and added dash/em-dash boundary stripping (`— some trailing text`).

### 2. Edit-value filler stripping
- **`cleanEditValue()`**: Added patterns for `make/set it to`, `change/update it to`, `it should be/say`, `it needs to be/say`, `please` prefix (with optional verb). These cover the filler phrases that were leaking into stored field values during summary edits.

### 3. Multi-field edit cross-contamination prevention
- **New `cleanFieldBoundary()` function**: Strips any trailing text from a captured value that looks like the start of another field's edit instruction (e.g. `, and the account to ...`, `description should be ...`). Applied to all text-based field captures in `handleSummaryEdit()` — subject, account, description, and person name. This is a belt-and-suspenders defence: even if `EDIT_SPLIT` fails to segment correctly, individual values won't absorb the next field's instruction.

## Files modified
- `src/server/services/portal-chat.ts` — 4 functions modified, 1 function added

## Preservation
- All Phase 1 behaviour preserved (no structural changes to stage flow or routing).
- All earlier Phase 2 gains preserved (conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, natural summary confirmation, summary review in system-offer flows, bundled URL capture, vague follow-up verification, metadata/visible-summary alignment, description synthesis consistency).

## Nothing blocked
- Clean TypeScript compile, no new dependencies.
