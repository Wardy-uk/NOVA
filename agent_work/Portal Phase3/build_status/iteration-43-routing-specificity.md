# Iteration 43 — Routing & Follow-up Specificity Fixes

**Date:** 2026-05-29
**Scope:** Narrow classification / follow-up-selection correction. No plumbing changes.
**File touched:** `src/server/services/portal-chat.ts` (detector functions only)
**Compile:** `tsc -p tsconfig.server.json --noEmit` → 0 errors.

This is **not** a convergence claim. It closes the four remaining Iteration 42
routing/specificity blockers and is ready for an independent retest.

---

## Blocker 1 — Property count mismatch got generic website framing

### Root cause
`detectPropertyFromKeywords` has a *website-context guard* (the `hasExplicitWebsiteContext`
check). When a customer says "…on the website", that guard bails the property detector
**unless** there is portal-listing vocabulary OR "property visibility language". The
visibility-language regex did **not** recognise count-mismatch phrasing
("50 properties in CRM but only 30 showing on the website") — no `missing`/`not showing`/
`mismatch`/`count` token is present in that natural wording. So the guard bailed, property
detection returned `likely:false`, and the LLM's `isWebsiteRelated` won → generic
website-content questioning.

### What changed
- Added `hasCountMismatchLanguage` (two-number "but only" patterns, `only N showing`,
  `N properties … N`, `count/number of properties`, "doesn't match" + property/CRM/feed).
- OR'd it into `hasPropertyVisibilityLanguage` so the website-context guard no longer bails.
- Added an explicit subcategory branch → `property_visibility` (propagation framing).
- The pre-existing property-precedence gate (LLM path) then reroutes `isWebsiteRelated`
  → property, so the follow-up asks property/feed/CRM/portal context.

---

## Blocker 2 — Property wrong-status cases were wording-sensitive

### Root cause
Two compounding issues:
1. Same website-context guard bailed for status phrasings that include "website" but no
   recognised visibility token (e.g. "sold property still showing as available on our site").
2. Subcategory ordering: the generic `wrong|incorrect|outdated|details` branch ran **before**
   the status branch, so "incorrect/wrong status" landed in `property_incorrect_details`
   while "sold still available" (no wrong/incorrect word) reached `property_status` — same
   intent, inconsistent subcategory and follow-up.

### What changed
- Added `hasStatusLanguage` (sold/under-offer/stc/withdrawn/reserved/let-agreed, plus
  available/for-sale/to-let when paired with still/showing/marked/wrong/should-be, plus
  explicit "…status is wrong/incorrect/outdated").
- OR'd into `hasPropertyVisibilityLanguage` (guard no longer bails).
- Moved a `hasStatusLanguage` → `property_status` branch **above** the generic
  incorrect-details branch, so all natural status phrasings route consistently to
  `property_status` and its property-relevant follow-up.

---

## Blocker 3 — CRM/API integration over-captured into email marketing (4/4)

### Root cause (the surviving path)
This was a **detector-precedence** defect, not prompt wording:
- `detectDataFeedsFromKeywords` opened with a negative guard that bailed to email marketing
  whenever `bym|briefyourmarket` (or any email term) appeared — **before** considering that
  the request was integration-framed. So "sync our CRM leads into BYM via the API" bailed
  data-feeds.
- `detectEmailMarketingFromKeywords`'s feed/integration guard only bailed when there was
  *no* compound email term, but `bym` counts as a compound term — so a BYM-destination
  integration request escaped the guard and resolved to `email_campaign`.
- Net: data-feeds (which runs first in every path) handed the case off, and email captured it.

### What changed
- **data-feeds detector:** compute feed/integration signals first, derive `integrationFramed`
  = (integration OR feed signal) AND (integration signal OR data-flow terms). The negative
  guard now bails to email **only when not integration-framed**. A CRM/API/leads/database
  sync naming BYM stays on the data-feeds path → `feeds_integration`.
- **email detector (belt-and-suspenders):** added an integration-frame guard — if a genuine
  integration system/verb (api/integration/connector/crm-sync/Reapit/Alto/etc.) co-occurs
  with data-flow terms (leads/database/contacts/records/data flow), it returns `likely:false`
  so the case cannot resolve to email even if reached.

### Preserved
- Genuine email marketing still bails out of data-feeds: "BYM email campaign won't send to
  my mailing list" and "update my BYM newsletter template" both verified to route to email
  (not integration-framed → data-feeds bails → email wins).

---

## Blocker 4 — URL-less named-page content amendments fell to `other_general`

### Root cause
`detectWebsiteFromKeywords`'s `hasWebsiteSignal` only matched a hard-coded page list
("about page", "team page", …) and URLs. "About Us page", "Meet the Team page", and generic
"<x> page" amendments without a URL matched nothing, so when the LLM didn't positively
classify website, the vague-website fallback (`detectWebsiteFromKeywords`) also returned
false and the message dropped through to `other_general`.

### What changed
- Added `hasNamedPage` (about/about-us/meet-the-team/contact/services/news/blog/fees/
  valuations/etc. + "page") and `hasGenericPageEdit` ("…page" + a content-amendment verb)
  to `hasWebsiteSignal`.
- These now route to `website_content`, whose field config has `url:true`, so the follow-up
  asks "Which page is this on? A URL would be ideal…" (page-location framing, not generic
  support framing).

---

## Iteration 42 fixes preserved (not touched)
Domain repair, optional-enum coercion, prior-contact gating, response de-duplication, and
the named non-email account guards are untouched. All edits are confined to four detector
functions (`detectWebsiteFromKeywords`, `detectPropertyFromKeywords`,
`detectDataFeedsFromKeywords`, `detectEmailMarketingFromKeywords`). No control-flow in the
intake handlers was modified other than via these detectors' return values.

## What remains risky / worth watching in retest
- **Status vs incorrect-details boundary:** "available" is a common word. The status branch
  requires it to be paired with status-mismatch language; a phrasing like "the available
  square footage is wrong" could in theory tip to `property_status`. Low likelihood, but
  worth a glance in the property suite.
- **Generic "<x> page" breadth:** `hasGenericPageEdit` keys off "page" + an edit verb. A
  message like "I can't get past the login page, update needed" could be pulled toward
  website. The account/login guards run earlier in most paths, but verify login/access
  cases still route to account.
- **Count-mismatch numerics:** the two-number patterns are intentionally narrow. Unusual
  phrasings ("loads of properties but hardly any online") have no digits and won't trip the
  count branch — they fall back to existing visibility handling, not a regression but not a
  new win either.
- **Data-flow terms ("leads"/"database") in genuine campaigns:** guarded to require a real
  integration system/verb before diverting from email, but a campaign request that literally
  says "API" + "leads" will now go to data-feeds. Confirm no genuine campaign suite case uses
  that exact framing.

## Readiness
Ready for independent retest of:
1. Property count-mismatch → property visibility/propagation handling.
2. Wrong-status property requests stable across natural phrasings.
3. CRM/API/leads/database integration stays out of email marketing.
4. URL-less named-page amendments → website content + page-URL follow-up.

Re-run the full Iteration 42 regression alongside to confirm no regression in the fixed
plumbing claims and in genuine email marketing / website-with-URL / feed-sync /
blank-summary protection.
