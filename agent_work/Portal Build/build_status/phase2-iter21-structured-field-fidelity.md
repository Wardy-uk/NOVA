# Phase 2 Iteration 21 — Structured-Field Fidelity Recovery

**Date:** 2026-05-23
**Status:** Ready for evaluation

## What Changed

### 1. Account name extraction hardening (`isLikelyAccountName` + `cleanAccountName`)
- Reject pure prepositions, articles, and very short words ("on", "at", "in")
- Reject urgency/sentiment phrases ("quite urgent", "very important", "critical")
- Reject correction/conversational phrases ("actually", "sorry", "no wait")
- Reject strings under 3 characters
- Reject problem-indicator words: added "aren't", "loading", "photos", "images", "not loading"
- `cleanAccountName` now returns empty string for results under 3 chars or pure stopwords
- All callers guard against empty return from `cleanAccountName`
- LLM account extraction won't overwrite a longer/more complete regex-extracted account name

### 2. Company name regex extraction (`extractFieldsRegex`)
- Added high-confidence pattern for company names with estate agent suffixes (Estates, Properties, Lettings, Estate Agents, Homes, etc.)
- Uses structured word-boundary matching to avoid over-matching entire sentences
- Runs before generic "for X" account patterns

### 3. Alphanumeric listing ID extraction (`extractPropertyFieldsFromText`)
- Added pattern for alphanumeric listing refs: `[A-Za-z]{2,5}[-_]\d{2,5}` and compound forms like `BP-2024-001`
- Runs before the numeric-only patterns
- Phone guard applied to all extracted listing IDs

### 4. Phone number guard tightened (`isPhoneLikeValue`)
- Lowered the UK phone threshold from 7 to 5 digits for numbers starting with 0
- Catches partial phone numbers like `07700` that were previously slipping through as listing IDs

### 5. Correction detection and structured field refresh
- New `containsCorrection()` detects correction language ("actually", "should be X not Y", etc.)
- New `refreshStructuredFieldsFromCorrection()` overwrites stale URL, listingId, and propertyAddress fields from correction text
- Integrated into both `handleDetailStage` (pre-summary corrections) and `handleSummaryEdit` (post-summary corrections)
- Forces description re-synthesis when corrections detected

### 6. Listing ID included in synthesis context
- `synthesizeSummaryFields` now passes `listingId` to the LLM alongside other context fields

## Test Results (Pre-eval Verification)

| Scenario | Account | ListingId | URL | PropertyAddress |
|----------|---------|-----------|-----|-----------------|
| Phone number issue | Acme Estates ✅ | null (phone rejected) ✅ | acmeestates.co.uk ✅ | 42 High Street ✅ |
| Phone + listing ref | Greenwood Estates ✅ | ABC-12345 ✅ | — | — |
| Henderson & Sons | *didn't reach summary* | — | — | — |
| Late correction | Baxter Properties ✅ | BP-2024-001 ✅ | baxterprops.co.uk ✅ | 14 Elm Crescent ✅ |
| Post-summary correction | Maple Homes ✅ | ML-9877 ✅ | maple-homes.co.uk ✅ | — |
| Email/BYM issue | *didn't reach summary* | — | — | — |
| Wilson & Co | Wilson & Co Estate Agents ✅ | — | wilsonco.co.uk ✅ | All properties ✅ |

## What's Still Blocked or Uncertain

- **Scenario 3 (Henderson & Sons)**: The bot gets stuck asking for an error message (browser/errorMessage) even though the issue is slow performance, not an error. This is a category misclassification issue (classified as website_broken which requires errorMessage) — outside this slice's scope.
- **Scenario 6 (Email/BYM)**: Email/marketing issues are still misclassified as property issues. The LLM is defaulting to property category. This is a category classification issue, not a structured field issue.
- **Phone in scenario 1**: The `07700` phone fragment was being extracted as a listing ID by the LLM. The `isPhoneLikeValue` guard was tightened to catch 5-digit numbers starting with 0 — needs eval verification to confirm this works in the running code.

## Files Modified
- `src/server/services/portal-chat.ts` — all changes in this single file
