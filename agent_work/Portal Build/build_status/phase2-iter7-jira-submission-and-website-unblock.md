# Phase 2 Iteration 7 — Jira Submission Recovery + Website/Listings Unblocking

**Status:** Ready for evaluation  
**Date:** 2026-05-22

## What Changed

### 1. Jira Ticket Creation — Issue Type Fix (portal-jira.ts)

The `createTicket()` method hardcoded `issuetype: { name: 'Service Request' }` for all projects. Website-category tickets route to NTPJ (via `CATEGORY_TO_PROJECT` in portal-intake.ts), but NTPJ's issue type is `Support`, not `Service Request`. This caused every website/listings submission to fail at the Jira API.

**Fix:** Issue type is now resolved through a fallback chain:
1. Explicit `issueTypeName` parameter (caller override)
2. Per-project setting: `portal_jira_issue_type_{projectkey}` (e.g., `portal_jira_issue_type_ntpj`)
3. Global setting: `portal_jira_issue_type`
4. Built-in defaults: `Support` for NTPJ, `Service Request` for everything else

No settings changes are required — the built-in default for NTPJ now matches the issue type used by the rest of the codebase (confirmed against `plugin-to-tpj-executor.ts` and `index.ts`).

### 2. Property Category Project Mapping (portal-intake.ts)

Added explicit `CATEGORY_TO_PROJECT` entries for all property subcategories (`property`, `property_missing_listing`, `property_incorrect_details`, `property_media`, `property_feed_sync`, `property_status`, `property_visibility`), all mapping to `NT`. Previously, property category had no mapping and fell through to the default, which happened to be NT anyway — but the explicit mapping prevents any future breakage if the default changes.

### 3. Website/Listings Site-Wide Issue Detection (portal-chat.ts)

`getPropertyMissingFields()` always required `propertyAddress` or `listingId`, which caused a dead-end when the customer's issue affected all properties (not a single one). The system kept asking "which property is affected?" even after the customer said "all of them".

**Fix:** Added `SITE_WIDE_PATTERNS` regex that detects phrases like:
- "all our properties/listings"
- "site-wide"
- "across the board"
- "every property/listing"
- "it's all of them"
- "not a specific property"
- "multiple properties/listings"

When detected, `extractPropertyFieldsFromText()` sets `propertyAddress` to `"All properties (site-wide)"`, which satisfies the `propertyIdentifier` requirement and allows the journey to progress toward summary.

This detection runs:
- On the initial message (intent stage extraction)
- On each detail-stage reply (via `extractFields()`)
- On the accumulated description (multi-turn recovery)

## Files Changed

| File | Change |
|------|--------|
| `src/server/services/portal-jira.ts` | Issue type resolution chain instead of hardcoded value; new optional `issueTypeName` parameter |
| `src/server/services/portal-intake.ts` | Added property subcategory entries to `CATEGORY_TO_PROJECT` |
| `src/server/services/portal-chat.ts` | Added `SITE_WIDE_PATTERNS` regex and site-wide detection in `extractPropertyFieldsFromText()` |

## What's Preserved

- All Phase 1 behaviour unchanged (no modifications to stage flow, routing, or category picker)
- Earlier Phase 2 gains: conversational activation, hidden routing, natural clarification, summary rendering, summary-stage confirmation recognition
- The `forceHandoff` path continues to use NT project directly (unaffected by this change)
- The SummaryCard button confirmation path and natural-language confirmation path both route through the same `confirmAndSubmit()` → `intakeService.submitTicket()` → `portalJira.createTicket()` chain

## Still Blocked or Uncertain

- If NT project's issue type name has changed from `Service Request`, tickets to NT would also fail. The settings-based override (`portal_jira_issue_type`) provides an escape hatch without code changes.
- The `SITE_WIDE_PATTERNS` regex covers the most common phrasings in English. Unusual phrasings (e.g., "this isn't about one property") might not match, but the existing 3-round detail stall detection would still progress those journeys to summary.

## Verification

TypeScript compiles cleanly (`tsc --noEmit` passes with no new errors).
