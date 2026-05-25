# Phase 2 Iteration 14 — Build Status: READY FOR EVAL

**Date:** 2026-05-23
**Slice:** Summary fidelity hardening

---

## What Changed

### 1. Multi-field summary edit parsing fixed (portal-chat.ts)

**Root cause:** The `EDIT_SPLIT` regex lookahead required field keywords (subject, account, urgency, etc.) to appear immediately after optional verb words (change, update, etc.), but the verb group `(?:change|update|set|correct|make|also\s+)?` didn't include `\s+` after it. So "change urgency" didn't match because "change" was captured but the space before "urgency" was unaccounted for. Additionally, urgency-value patterns like "mark this as high" and "this is urgent" were not recognized by the split lookahead.

**Fix:** 
- Restructured the verb group in the lookahead to `(?:(?:change|update|set|correct|make)\s+)?` (with `\s+` inside the group)
- Added alternative patterns for urgency-value splits: `mark\s+(?:it|this)\s+(?:as\s+)?` and `(?:this|it)\s+(?:is|should\s+be)\s+` before urgency values (urgent/high/critical/normal)
- Fixed the urgency match regex in the per-segment handler to accept "mark this as" in addition to "mark it as"

### 2. Description regex refined (portal-chat.ts)

- First description edit pattern now accepts "to say" as a keyword phrase (e.g., "change description to say 'X'") by adding `(?:say\s+)?` after `to\s+`

### 3. Account name cleaning improved (portal-chat.ts)

- Added `.replace(/\s+not\s+\S.*$/i, '')` to `cleanAccountName()` to strip correction suffixes like "not BriefYourMarket" from "Greenfield Lettings not BriefYourMarket"

### 4. Synthesis consistency — all summary paths now synthesize (portal-chat.ts)

**Root cause:** `synthesizeSummaryFields()` was only called before `buildSummaryCard()` in 3 of 17 call sites. Most paths skipped synthesis entirely, resulting in raw transcript as subject/description.

**Fix:**
- Made `buildSummaryCard` async and added `await this.synthesizeSummaryFields(meta)` at its top
- Added idempotency via `meta.synthesisDone` flag (set after synthesis runs or skips, prevents duplicate LLM calls)
- Updated all 17 call sites and 3 enclosing functions to use `await`
- Added `synthesisDone?: boolean` to `IntakeSessionMetadata` in portal-types.ts

### 5. Metadata description now uses synthesized content (portal-chat.ts)

**Root cause:** The summary card's `messageMeta.fields.description` always used raw `f.description` (transcript), even when `meta.synthesizedDescription` existed and was displayed in the card body. This meant the client-side metadata diverged from what was visually shown.

**Fix:** In `buildSummaryCard`, the `messageMeta.fields` now spreads `f` but overrides `description` with `meta.synthesizedDescription || f.description`, so the metadata matches the visible card.

---

## Files Changed

| File | Change |
|------|--------|
| `src/server/services/portal-chat.ts` | Multi-field edit regex, urgency regex, description regex, cleanAccountName, async buildSummaryCard with synthesis, metadata description sync |
| `src/shared/portal-types.ts` | Added `synthesisDone?: boolean` to `IntakeSessionMetadata` |

---

## Test Results (API-level)

| Test | Before | After |
|------|--------|-------|
| Multi-field edit: subject + urgency | Subject captured entire message, urgency unchanged | Both fields updated correctly |
| Multi-field edit: account + "mark this as critical" | Account captured entire message, urgency unchanged | Account + urgency both updated |
| Multi-field edit: account + description | Account captured entire message, description unchanged | Both fields updated correctly |
| Account "X not Y" correction | Captured "X not Y" as account | Correctly cleaned to just "X" |
| Description "to say 'X'" | Captured "say 'X'" | Correctly captured just "X" |
| Virtual tour subject (was truncated) | `[Portal] Something broken — The virtual tour on 42 Oak Lane isn't loading...Accou...` | `[Portal] Property visibility issue — Virtual tour not loading on 42 Oak Lane property page` |
| Metadata description | Raw transcript in all sessions | Synthesized description matching card body |
| Vague gating | Working | Still working |
| Natural confirmation | Working | Still working |
| Hidden routing | Working | Still working |

---

## Still Blocked / Uncertain

- **Account confusion** (BriefYourMarket vs Greenfield Lettings): The intake extraction sometimes captures the platform name instead of the customer name. This is outside this slice's scope (field extraction quality, not summary fidelity).
- **Bot response parroting**: The bot occasionally parrots truncated user input in responses (e.g., "I can see we need to add a new user to the CRM - our new sales manager Sarah Johnson ne...."). Pre-existing, outside scope.
- **Category mislabeling**: Some journeys get categorized as "Content update" or "Property visibility" when the actual issue is different. This is a classification issue, not a summary fidelity issue.

---

## Ready for Evaluation

Yes. The running portal now:
- Applies multi-field summary edits correctly across tested patterns
- Produces consistently synthesized subjects and descriptions across all summary paths
- Stores the synthesized description in the metadata fields sent to the client and used for ticket creation
- Preserves all earlier Phase 2 conversational gains (vague gating, hidden routing, natural confirmation, etc.)
