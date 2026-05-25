# Workstream 1 Phase 1 — Hardening Iteration Complete

**Date:** 2026-05-18
**Scope:** Behavioural hardening only — no architectural changes

## Files Changed

| File | Change |
|------|--------|
| `src/server/services/portal-chat.ts` | All three hardening objectives |
| `src/shared/portal-types.ts` | Added `attachmentMentioned` to `IntakeSessionMetadata` |

## Behavioural Changes Made

### 1. Removed classification-uncertainty wording

**Before (line ~597):**
> "It sounds like this might be about your website — could you tell me a bit more about what needs to happen?"

**After:**
> "Could you tell me a bit more about what needs to happen?"

The acknowledgment prefix (from LLM or fallback) still provides context without revealing internal confidence/routing logic.

### 2. Strengthened implied-website detection

**Keyword regex (`detectWebsiteFromKeywords`)** now additionally matches:
- `office` + wrong/incorrect/change/update/outdated/old/details
- `branch` + wrong/incorrect/change/update/outdated/old/details
- `contact details/info/information` + wrong/incorrect/change/update/outdated/old
- `our office/branch/contact/details` + wrong/incorrect/outdated/old/needs/change/update

**LLM system prompt** updated with:
- Explicit instruction that business-detail corrections (phone numbers, addresses, opening hours, office/branch details, contact information) should set `isWebsiteRelated=true` and `websiteSubcategory=website_content`
- Expanded `website_content` classification description to include opening hours, branch/office details, contact information

### 3. Improved attachment awareness

**Detection:** New `ATTACHMENT_PATTERNS` regex matches: attached, attachment, see attached, photo attached, i've attached, file attached, screenshot attached, attaching, i attach.

**Acknowledgment points:**
- **Intent stage (first message):** If attachment mentioned, appends "You'll be able to upload files when we get to the summary step." to the response
- **Detail stage:** On first detection, prefixes response with "Noted — you'll be able to upload files when we get to the summary step."
- **Summary card:** If attachment was mentioned at any point, appends "You mentioned an attachment — you'll be able to upload files before submitting."

**Metadata:** `attachmentMentioned` boolean added to `IntakeSessionMetadata` (persisted across session exchanges).

## Preserved Behaviours

- Conversational intake for website requests (high and moderate confidence paths) — unchanged
- Category picker fallback for non-website requests — unchanged
- KB deflection flow — unchanged
- Summary card structure and submit flow — unchanged
- Frustration detection and handoff — unchanged
- Status intent lookup — unchanged
- Non-LLM fallback path — unchanged (also hardened with same improvements)
- Portal shell, ticket creation, and request summary UI — untouched

## Build Validation

- `tsc --noEmit` passes with zero errors in changed files
- Pre-existing error in `agent-loop.ts:1193` (unrelated) remains

## Remaining Known Edge Cases

1. **"My phone number is wrong" without company context** — Will enter website intake but LLM may not know which page/account. Conversational follow-up will ask for the account name and URL.
2. **Attachment mentioned in summary edit stage** — Not detected (summary edit goes through `handleSummaryEdit` which doesn't check). Low risk since the summary card already shows the file upload area.
3. **Non-English attachment language** — Only English patterns detected. Acceptable for current user base.
