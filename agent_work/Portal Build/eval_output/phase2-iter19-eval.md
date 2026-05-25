# Phase 2 — Iteration 19 Evaluation
## Extraction Accuracy & Summary Readiness

**Date:** 2026-05-23
**Evaluator:** Eval Agent (behavioural, API-driven)
**Sessions tested:** 531–537 (7 sessions, 6 distinct journey types)

---

## Journeys Tested

| Session | Scenario | Purpose |
|---------|----------|---------|
| 531 | Phone number in property issue | Phone contamination of listing ref |
| 532 | Account name + URL + detail progression | Account carry-through + description quality |
| 533 | Late correction before summary | Detail absorption timing |
| 534 | Phone + listing ID coexistence | Disambiguation accuracy |
| 535 | Non-property email/BYM issue | Conversational continuity + category flexibility |
| 536 | Rich initial message + post-summary correction | Listing ID extraction + correction absorption |
| 537 | Complete upfront message + natural confirmation | Fast-path + confirmation recognition |

---

## Finding 1: Phone Number Contamination — NOT RESOLVED

**Status: Still present**

- **Session 531:** User mentioned phone numbers `01234 5678` (wrong) and `07700 900123` (correct). The system extracted `07700` as the `listingId`. The summary displayed `**Listing ref:** 07700` — a phone number fragment misidentified as a listing reference.
- **Session 534:** User provided both a listing ref `ABC-12345` and two phone numbers. The system:
  - Stripped the listing ref to just `12345` (lost the `ABC-` prefix)
  - Redacted phone numbers in the description as `[REDACTED-PHONE]`, losing critical information the support team needs
  - Showed phone numbers in the conversational response as identifiers: "Website (0161 234 5678, 0161 987 6543)"

**Verdict:** Phone number contamination remains an active issue. Numbers are still being parsed as listing/reference IDs when no real listing ID is present.

---

## Finding 2: Account Name Carry-Through — MOSTLY RESOLVED

**Status: Improved but with edge-case regressions**

- **Session 532:** "Henderson & Sons Lettings" — correctly captured in summary ✅
- **Session 533:** "Baxter Properties" — correctly captured ✅
- **Session 534:** "Greenwood Estates" — captured as `"Greenwood Estates on"` with trailing "on" from the phrase "on their website" ❌
- **Session 535:** "Sunrise Properties" — correctly captured ✅
- **Session 536:** "Maple Homes" — correctly captured as account ✅, but also misidentified as `affectedPersonName` ❌
- **Session 537:** "Wilson & Co Estate Agents" — correctly captured ✅

**Verdict:** Account name extraction is substantially improved (5/6 correct, 1 edge case with trailing word). The `affectedPersonName` field is also picking up company names as person names (sessions 534, 536) — a secondary extraction issue.

---

## Finding 3: Summary Readiness — MIXED

**Status: Partially improved**

### Pre-summary absorption
- **Session 533:** User corrected "Elm Lane" to "Elm Close" in final message before summary. The synthesized description correctly said "14 Elm Close" ✅. However, the `propertyAddress` field kept the old value "14 Oak Lane" ❌.
- **Session 534:** User reiterated listing ref — was captured in description but not in `listingId` field.

### Post-summary correction
- **Session 536:** User corrected URL and listing ref after summary was shown. The URL field updated ✅, but the description was NOT re-synthesized — it still contained the old values ❌. The `listingId` remained null throughout ❌.

**Verdict:** Pre-summary corrections are partially absorbed (description updates, but structured fields may lag). Post-summary corrections update individual fields but do not trigger description re-synthesis.

---

## Finding 4: Raw-Transcript Description Path — PARTIALLY IMPROVED

**Status: Two layers, inconsistent**

The system now has two description representations:
1. **collectedFields.description** — raw concatenated user messages (session 536 showed: `"The photos on our listing aren't loading...\nI already gave you the listing reference..."`)
2. **synthesizedDescription** — clean, readable summary (session 531 showed: `"The property listing for Acme Estates, Southgate branch displays the phone number as 01onal234 5678..."`)

The summary card shown to users displays the **synthesized** version ✅, but the **collectedFields.description** (which would be sent to Jira) still contains raw transcript in multi-turn conversations ❌.

**Additional issue:** In session 533, the conversational response parroted raw transcript: *"You mentioned hi, I need to change a property listing for Baxter Properties"* — the greeting "hi" should be stripped from acknowledgment text.

**Verdict:** The user-facing summary card is improved. The underlying ticket description field remains raw transcript in multi-turn flows.

---

## Finding 5: Earlier Phase 2 Conversational Gains — INTACT

**Status: Preserved ✅**

- **Conversational activation:** All sessions entered conversational mode naturally
- **Hidden routing:** Categories assigned without exposing taxonomy to users
- **Natural clarification:** System asked follow-up questions naturally
- **Non-looping failure:** No infinite question loops observed
- **Natural confirmation recognition:** Session 537 — "that's the badger, go ahead" was recognized as confirmation ✅
- **URL capture:** Session 532 — URL provided mid-conversation was correctly captured
- **KB suggestions:** Not triggered in these test paths (appropriate — none of these were KB-deflectable)
- **Stable failure handling:** Session 537 — when Jira submission failed, system provided a graceful fallback message

No regressions observed in earlier Phase 2 gains.

---

## Additional Issues Observed (Outside Phase 2 Scope)

1. **Listing ID extraction weakness:** Session 536 — `listingId` remained null despite user providing "ML-9876" twice. Session 534 — `ABC-12345` was truncated to `12345`.
2. **Category misclassification:** Session 535 — email/BYM bounce issue categorised as "Property visibility issue" rather than email/marketing.
3. **Redundant re-asking:** Sessions 534 and 536 — system re-asked for information the user had already provided (listing ref, property details).
4. **Person/company confusion:** `affectedPersonName` populated with company names in at least 2 sessions.
5. **Phone redaction in descriptions:** Session 534 — phone numbers redacted as `[REDACTED-PHONE]` in the ticket description, which removes information the support team needs to act on.

---

## Convergence Assessment

| Criterion | Status | Notes |
|-----------|--------|-------|
| Phone contamination of listing/ref fields | ❌ Not converged | `07700` extracted as listingId in session 531 |
| Account name carry-through | ⚠️ Partially converged | 5/6 correct; one edge case with trailing word |
| Late detail absorption before summary | ⚠️ Partially converged | Description absorbs; structured fields lag |
| Post-summary correction absorption | ⚠️ Partially converged | Field-level updates work; description not re-synthesized |
| Raw-transcript description cleanup | ⚠️ Partially converged | Summary card is clean; underlying field is still raw |
| Earlier Phase 2 gains preserved | ✅ Converged | All tested gains remain intact |

### Overall: **Partially converged**

The user-facing experience has improved — summary cards show synthesized descriptions, account names are usually correct, and conversational continuity is solid. However, the underlying data quality (what would go to Jira) still has phone contamination, raw transcript descriptions, and listing ID extraction gaps. These need resolution before the extraction accuracy slice can be considered converged.

---

## Recommended Next Steps

1. **Phone number guard:** Add pattern matching to reject phone-formatted strings from `listingId` field
2. **Description field convergence:** Use `synthesizedDescription` as the canonical description sent to Jira, not `collectedFields.description`
3. **Post-summary re-synthesis:** When user corrects details after summary, re-run description synthesis
4. **Listing ID extraction:** Improve extraction of alphanumeric listing refs (e.g., `ABC-12345`, `ML-9876`) from user messages
5. **Account name trimming:** Strip trailing prepositions ("on", "at", "for") from extracted account names
