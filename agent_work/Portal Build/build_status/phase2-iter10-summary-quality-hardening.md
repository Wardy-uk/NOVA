# Phase 2 — Iteration 10: Summary Quality and Readiness Hardening

**Status:** Ready for evaluation
**Date:** 2026-05-22

## What Changed

### 1. Vague journey problem elicitation (all domains)

Previously, the vague-journey gate only triggered for `category='other'`. Journeys classified into a specific domain (website, property, account) could skip straight to gathering account/URL without establishing what the problem actually was.

**Change:** Added a `descriptionLacksActionableDetail()` helper and moved the vague gate earlier in `handleDetailStage`, before missing-field computation. It now fires for ALL conversational journeys (not just `other`) when the description lacks actionable detail. The old `other`-only gate was removed since the new one is a superset.

This means "Hi, I need help with my website" will now produce "Could you describe the issue in a bit more detail — what specifically isn't working or what do you need us to do?" before asking for account or URL.

### 2. Summary field quality

- **Subject:** Auto-generated subjects now strip greetings ("Hi, ", "Good morning, ") and truncate long first-sentences to 100 chars. Previously, subjects could start with "Hi, I'm having..." or be excessively long.
- **Description in summary card:** Greeting prefixes stripped on display; triple-newlines collapsed. The raw description in metadata is preserved for Jira.
- Added `stripGreeting()` utility used by both subject generation and summary display.

### 3. Summary edit requests

`handleSummaryEdit` was completely rewritten. Previously it just called `extractFields()` (which won't overwrite existing values) and rebuilt the card — edits were effectively ignored.

**New behaviour:**
- Explicit edit patterns are parsed first: "change the subject to X", "the account is actually Y", "set urgency to high", "the person's name is Z", etc.
- If no explicit pattern matches, falls back to LLM extraction with **overwrites allowed** (not the initial-extraction path that protects existing values).
- Regex fallback for URLs, account fields, and property fields also applied.
- The summary card is then rebuilt with the updated values.

Supported explicit edit patterns:
- Subject, account, description, urgency, person name, person email
- Multiple phrasing variants: "change X to Y", "X should be Y", "X is actually Y", "actually the X is Y"

## Files Modified

- `src/server/services/portal-chat.ts` — all three changes in this single file

## What's Preserved

- All Phase 1 converged behaviour
- Conversational activation and hidden routing
- Natural clarification and cross-domain disambiguation
- Stable non-looping failure handling (detailRounds, maxDetailRounds)
- Property-question narrowing
- Summary rendering structure and metadata format
- Natural summary confirmation recognition (isAffirmativeResponse)
- Efficient concrete property-specific paths
- Security-sensitive fast-track
- Frustration detection and empathy handling
- KB deflection flow

## Compilation

TypeScript compiles cleanly (`tsc --noEmit --skipLibCheck` — no errors).

## Blocked/Uncertain

- None identified. The changes are narrowly scoped to the three gaps specified in the brief.
