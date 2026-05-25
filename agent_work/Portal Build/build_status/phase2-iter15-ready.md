# Phase 2 Iteration 15 — Summary Synthesis Reliability and Extraction Cleanup

**Status:** Ready for evaluation
**Date:** 2026-05-23

## What Changed

### 1. Summary synthesis fires more consistently

**File:** `src/server/services/portal-chat.ts` — `synthesizeSummaryFields()`

- Lowered the length threshold from 150 chars to 80 chars for triggering LLM synthesis. Multi-turn problem journeys with concise answers (e.g. 3 turns of ~30 chars each) now qualify for synthesis where previously they were skipped.
- Added detection of conversational noise markers (yes/yeah/hi/ok etc.) in the description as an additional trigger — if the description contains conversational fragments from a multi-turn flow, synthesis fires even if the text is short, producing a clean summary instead of showing raw transcript fragments.

### 2. Cleaner inline account extraction

**File:** `src/server/services/portal-chat.ts` — `cleanAccountName()` + `extractFieldsRegex()`

- `cleanAccountName()` now strips trailing conversational/problem phrases that aren't part of the account name (e.g. "Anderson Estates is having issues" → "Anderson Estates", "Smith & Co not working" → "Smith & Co").
- Added stop-word boundary detection in the regex account extraction pipeline — the greedy `[A-Za-z0-9 &'.-]{2,40}` pattern now terminates before common problem words (is, are, not, broken, having, etc.) instead of capturing them as part of the account name.

### 3. Filler-stripped edit values

**File:** `src/server/services/portal-chat.ts` — new `cleanEditValue()` function

- Added `cleanEditValue()` that strips instruction filler from extracted edit values ("just be", "simply", "should be", "needs to be", "could you make it" etc.).
- Applied to all regex-based edit matches (subject, description) and LLM-extracted edit values (subject, description).
- Added filler-stripping instruction to the LLM edit extraction prompt as a defence-in-depth measure.

## What's Preserved

- All Phase 1 behaviour unchanged
- All earlier Phase 2 gains: conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, natural summary confirmation, summary review in system-offer flows, bundled URL capture, vague follow-up verification, multi-field summary edits, metadata/visible-summary alignment

## Build

TypeScript compiles cleanly (`tsc --noEmit` passes with no errors).

## Nothing Blocked

All three targeted improvements are implemented. No new dependencies or architectural changes.
