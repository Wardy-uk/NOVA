# Property / Listing Issues — Iteration 1 Complete

## Date
2026-05-19

## Summary
First conversational intake iteration for property/listing-related requests. Follows the validated Website Design convergence methodology — property requests now enter conversational intake rather than falling to the category picker.

---

## Behavioural Changes Implemented

### 1. Property Intent Detection (LLM Path)
- Extended `ConversationalIntakeSchema` with `isPropertyRelated`, `propertySubcategory`, `propertyAddress`, `listingId`, `affectedPortals`
- LLM prompt now explicitly classifies property/listing issues separately from website issues
- Property classification includes 6 internal subcategories: `property_missing_listing`, `property_incorrect_details`, `property_media`, `property_feed_sync`, `property_status`, `property_visibility`
- Internal subcategories are NEVER exposed to the customer — customer-friendly labels used in summary

### 2. Property Intent Detection (No-LLM Fallback)
- `detectPropertyFromKeywords()` recognises property signals: portal names (Rightmove, Zoopla, OnTheMarket), property terminology, feed language, listing status terms
- Routes to appropriate subcategory based on keyword patterns
- Falls through to category picker only if neither website nor property detected

### 3. Conversational Follow-Up Logic
- `getPropertyMissingFields()` — property-specific required field detection: description, property identifier (address OR listing ID), affected portals, account
- `buildPropertyFollowUp()` — template-based follow-up questions per subcategory
- `buildPropertyConversationalFollowUp()` — LLM-enhanced contextual follow-ups (with template fallback) that explicitly prohibit technical jargon

### 4. Property Field Extraction
- `extractPropertyFieldsFromText()` — regex extraction for: property addresses (street patterns), listing IDs (numeric refs), affected portals (Rightmove/Zoopla/OnTheMarket/PrimeLocation), property status mentions (sold/STC/under offer etc.)
- Runs on opening message AND on follow-up messages during detail stage
- LLM also extracts these fields from its structured response

### 5. Website vs Portal Ambiguity
- LLM prompt includes disambiguation rules: "property isn't showing" without context → property (not website); mentions of portals + website → property
- Moderate confidence (0.4–0.6) routes conversationally rather than to category picker
- No category picker cliff for ambiguous property/website requests

### 6. Operational Detail Preservation
- Property address, listing ID, affected portals, and property status all survive into the Request Summary
- Summary card shows property-specific fields: **Property**, **Listing ref**, **Affected**, **Status issue**
- Raw customer message preserved as canonical description (not replaced by LLM rewrite)

### 7. Taxonomy Protection
- Customer-facing subcategory names: "Missing listing", "Incorrect property details", "Property photos / media", "Property update issue", "Property status issue", "Property visibility issue"
- No feed/syndication/API/CRM/integration terminology in acknowledgments or questions
- LLM prompt explicitly bans technical echoing in acknowledgments

---

## Files Changed

| File | Change |
|------|--------|
| `src/shared/portal-types.ts` | Added `propertyAddress`, `listingId`, `affectedPortals`, `propertyStatus` to `IntakeCollectedFields` |
| `src/server/services/portal-chat.ts` | Extended LLM schema, added property detection (LLM + regex), property conversational intake path, property follow-up logic, property field extraction, summary card updates, category mapping |

---

## Protected Behaviours Preserved

| Behaviour | Status | Notes |
|-----------|--------|-------|
| Website conversational intake | PRESERVED | Existing website path unchanged; property branch is parallel |
| Opening message preservation | PRESERVED | `openingMessage` capture unchanged |
| Hidden taxonomy | PRESERVED | Property subcategories are internal only |
| Conversational continuity | PRESERVED | Property follow-ups reference prior context |
| Attachment awareness | PRESERVED | Same attachment detection + file-upload note |
| Frustration/escalation handling | PRESERVED | Frustration patterns and handoff logic unchanged |
| Category picker for non-matched domains | PRESERVED | Unrecognised requests still fall to picker |
| KB deflection | PRESERVED | Property requests go through same KB check path |
| Summary card | PRESERVED | Extended with property fields, not replaced |
| Raw customer input as canonical record | PRESERVED | Description accumulation logic unchanged |

---

## Build Validation

- **TypeScript typecheck**: PASS (only pre-existing error in agent-loop.ts:1193, unrelated)
- **Vite build**: PASS (built in 4.03s)
- **No new errors introduced**

---

## Known Gaps / Assumptions

### Non-Blocking
1. **Attachment upload for property media** — customers can mention attachments and they're noted, but actual screenshot/floorplan upload happens at summary stage (same as website). No property-specific media upload flow.
2. **Multi-portal detail splitting** — when a customer reports different issues on different portals (e.g. "Rightmove has old photos, Zoopla missing EPC"), the description captures this verbatim but doesn't split into separate per-portal records. Support agent sees the full context.
3. **Property address extraction** — regex-based, catches common UK street patterns. Unusual formats (flat numbers, building names without street type) may not be auto-extracted but are preserved in the description.
4. **Chronology extraction** — timestamps mentioned by customers ("updated yesterday at 3pm") are preserved in description text but not parsed into structured fields.

### Assumptions
1. Property requests use `category: 'property'` internally (parallel to `'website'`), not the existing `'listings'` or `'data_feeds'` categories. This avoids confusion with the existing category picker options.
2. The LLM disambiguation rule (property > website when ambiguous) is appropriate for Nurtur's customer base (estate agents whose primary concern is listing visibility).
3. Property field configs don't require `url` or `browser` as mandatory — these are rarely relevant for property/feed issues.
