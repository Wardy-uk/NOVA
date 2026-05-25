# Phase 2 — Iteration 20 Evaluation
## Downstream Summary Fidelity

**Date:** 2026-05-23
**Evaluator:** Eval Agent (behavioural, API-driven)
**Sessions tested:** 538–544 (7 sessions, 7 distinct journey types)

---

## Journeys Tested

| Session | Scenario | Purpose |
|---------|----------|---------|
| 538 | Phone number in property issue | Phone contamination of listing ref |
| 539 | Phone + listing ID coexistence | Disambiguation accuracy |
| 540 | Account name + slow website | Account carry-through + categorisation |
| 541 | Late correction before summary | Correction absorption into structured fields |
| 542 | Post-summary correction | Correction propagation through summary state |
| 543 | Non-property email/BYM issue | Category flexibility + conversational continuity |
| 544 | Rich initial message + natural confirmation | Fast-path + confirmation recognition + account extraction |

---

## Finding 1: Phone Number Contamination — MARGINAL IMPROVEMENT

**Status: Partially improved — no longer contaminates listingId, but still misused in responses**

- **Session 538:** Phone numbers `07700 900123` appeared in the bot's acknowledgment parenthetical: "Acme Estates on 42 High Street (07700 900123)". The phone number was treated as an identifier/qualifier rather than issue detail. However, no summary was reached, so listingId contamination could not be tested.
- **Session 539:** Both phone numbers `0161 234 5678` and `0161 987 6543` appeared in the bot's acknowledgment as identifiers: "Greenwood Estates on Website, Property portals (0161 234 5678, 0161 987 6543)". The real listing ref `ABC-12345` was ignored and the bot re-asked for it.
- **Session 542 (reached summary):** The `listingId` field was null despite the user providing `ML-9877` twice. Phone numbers were not present in the summary — but only because this scenario had no phone numbers. The listing ref extraction failure persists.

**Verdict:** Phone numbers are no longer appearing in the `listingId` structured field (improvement over iter-19 where `07700` was extracted as listingId). However, phone numbers are still being used as identifiers in conversational acknowledgments, and listing IDs are still not being captured in the `listingId` field at all.

---

## Finding 2: Account Name Carry-Through — REGRESSED

**Status: Regressed from iter-19**

| Session | Expected Account | Actual Account Field | Result |
|---------|-----------------|---------------------|--------|
| 538 | Acme Estates | *(no summary reached)* | — |
| 539 | Greenwood Estates | *(no summary reached)* | — |
| 540 | Henderson & Sons Lettings | *(no summary reached)* | — |
| 541 | Baxter Properties | "Actually sorry, it should be 14 Elm Crescent" | ❌ Correction text extracted as account |
| 542 | Maple Homes | "on" | ❌ Stray preposition |
| 543 | Sunrise Properties | *(no summary reached)* | — |
| 544 | Wilson & Co Estate Agents | "quite urgent" | ❌ Urgency phrase extracted as account |

Of the 3 sessions that reached summary, **zero** had the correct account name:
- Session 541: The user's correction message was extracted as the account value
- Session 542: The word "on" (from "on their site") was extracted as the account
- Session 544: The phrase "quite urgent" was extracted as the account

In iter-19, account extraction was 5/6 correct. This is a clear regression.

**Additional issue:** `affectedPersonName` is still being populated with company names (Baxter Properties in session 541, Maple Homes in session 542) — unchanged from iter-19.

---

## Finding 3: Downstream Description Fidelity — IMPROVED

**Status: Improved where summaries were reached**

In sessions that reached the summary stage, the synthesized description was noticeably better:

- **Session 541:** Description correctly stated "The correct address should be 14 Elm Crescent" — absorbed the correction ✅
- **Session 542:** Description correctly referenced "ML-9877" and "maple-homes.co.uk" — absorbed both corrections ✅
- **Session 544:** Description was clean and accurate: "The property search page at wilsonco.co.uk is displaying a 502 error" ✅

The description field now consistently uses synthesized prose rather than raw transcript. This is a genuine improvement.

**However:** The description absorbed corrections that the structured fields did not:
- Session 541: Description says "14 Elm Crescent" ✅ but `propertyAddress` says "14 Elm Lane" ❌
- Session 542: Description says "maple-homes.co.uk" ✅ but `url` says "maplehomes.co.uk" ❌

---

## Finding 4: Post-Summary Correction Propagation — PARTIALLY WORKING

**Status: Description absorbs corrections; structured fields do not**

- **Session 542:** User corrected URL from "maplehomes.co.uk" to "maple-homes.co.uk" and listing ref from ML-9876 to ML-9877 after initial messages. The **description** correctly reflected both corrections. The **url** field kept the old value. The **listingId** field remained null throughout.
- **Session 541:** User corrected address to "14 Elm Crescent" before summary. The **description** correctly reflected the correction. The **propertyAddress** field kept the old "14 Elm Lane". The **account** field captured the correction message text itself.

**Verdict:** The LLM synthesis layer is absorbing corrections into the description. The structured field extraction layer is not re-running after corrections, leaving stale values in individual fields.

---

## Finding 5: Earlier Phase 2 Conversational Gains — MOSTLY INTACT WITH SOME ISSUES

**Status: Core gains preserved; some edge regressions**

### Preserved ✅
- **Conversational activation:** All 7 sessions entered conversational mode naturally
- **Hidden routing:** Categories assigned without exposing taxonomy
- **Natural confirmation recognition:** Session 544 — "that's the badger, go ahead and raise it" was correctly recognized ✅
- **URL capture:** URLs provided mid-conversation were captured in the summary
- **Urgency detection:** Session 544 — "quite urgent" correctly elevated urgency to High ✅

### Concerns ⚠️
- **Bot parroting raw input:** Session 538 — "You mentioned hi, I'm having a problem with a property listing for Acme Estates" includes the greeting "hi" verbatim. Session 541 — "You mentioned I need to update a property listing for Baxter Properties" parrots the request framing. This was noted in iter-19 and persists.
- **Redundant re-asking:** Sessions 538, 539, 540 — the bot asked for account names that were already provided in the initial message (Acme Estates, Greenwood Estates, Henderson & Sons Lettings). This caused 3 of 7 sessions to stall without reaching summary.
- **Category rigidity:** Session 543 — an email/BriefYourMarket bounce issue was treated as a property problem. The bot kept asking "which property is affected" for an issue that has nothing to do with properties. This was also noted in iter-19 and persists.
- **Non-looping failure with early handoff offer:** Sessions 538, 539, 540, 543 — when stuck, the bot offered "Would you like me to create a ticket so a team member can assist directly?" This is a reasonable fallback, though the stalling itself is the concern.

---

## Finding 6: Listing ID Extraction — NOT WORKING

**Status: Not converged (unchanged from iter-19)**

| Session | Listing ID Provided | listingId Field |
|---------|--------------------|-----------------| 
| 539 | ABC-12345 | *(no summary)* |
| 541 | BP-2024-001 | null |
| 542 | ML-9877 (corrected) | null |

Despite users providing alphanumeric listing references in clear context, the `listingId` structured field was null in every summary reached. The description text correctly mentions the listing refs, so the LLM understands them — but the extraction pipeline doesn't route them to the structured field.

---

## Additional Issues Observed (Outside Phase 2 Scope)

1. **Session metadata storage:** `getSession()` returned undefined for `stage` and `collectedFields` in all sessions. The session metadata appears not to be persisted to the database — only the per-message metadata (summary card) contains the structured data. This is a data-layer concern, not a UX issue.
2. **Ticket creation failure:** Session 541 — after user confirmed the summary, ticket creation failed silently with a graceful fallback message directing user to email support@nurtur.tech. This is likely a Jira connectivity issue in the test environment, not a code bug.
3. **Category misclassification persists:** Email/marketing issues (session 543) are still forced into property categories.

---

## Convergence Assessment

| Criterion | Iter-19 | Iter-20 | Delta |
|-----------|---------|---------|-------|
| Phone contamination of listing/ref fields | ❌ `07700` as listingId | ⚠️ No longer in listingId, but used in responses | Improved |
| Account name carry-through | ⚠️ 5/6 correct | ❌ 0/3 correct (regression) | Regressed |
| Downstream description fidelity | ⚠️ Two layers, inconsistent | ✅ Synthesized description is clean | Improved |
| Post-summary correction propagation | ⚠️ Field-level only | ⚠️ Description absorbs; fields don't | Sideways |
| Listing ID extraction | ❌ Not working | ❌ Not working | No change |
| Earlier Phase 2 gains preserved | ✅ | ⚠️ Mostly, but re-asking and category rigidity persist | Slight regression |

### Overall: **Partially converged — description quality improved, account extraction regressed**

The synthesized description is now genuinely good — clean prose that absorbs corrections. This is a real improvement. However, account name extraction has regressed badly (from 5/6 to 0/3), and the structured fields (propertyAddress, url, listingId) still don't update when corrections are made. The gap between "good description" and "correct structured fields" has widened.

---

## Recommended Next Steps

1. **Account extraction regression:** Investigate why account names provided in the initial message (e.g. "Wilson & Co Estate Agents", "Baxter Properties") are being replaced by unrelated text fragments ("quite urgent", "Actually sorry, it should be 14 Elm Crescent", "on")
2. **Structured field re-extraction:** When the description is re-synthesized after a correction, also re-extract structured fields (propertyAddress, url, listingId) from the updated context
3. **Listing ID extraction:** Route alphanumeric listing refs (ABC-12345, BP-2024-001, ML-9877) from the conversation to the `listingId` field — the LLM already understands them (they appear in descriptions)
4. **Category flexibility:** Allow non-property categories (email/marketing, account settings, etc.) to flow through without being forced into property subcategories
5. **Greeting stripping:** Remove conversational greetings ("hi", "hello") from acknowledgment text
