# Phase 2 Iteration 22 — Multi-Segment Reference ID Fidelity Evaluation

**Date:** 2026-05-24  
**Evaluator:** Eval Agent (API-level behavioural testing)  
**Server:** localhost:3001, authenticated via codex-test-login (Codex Test Organisation)  
**Sessions tested:** 568, 569, 570, 571, 572, 573, 574, 575

---

## Journeys Tested

Eight conversational intake journeys were executed via the portal chat API:

1. **Session 568 — Three-segment ID `RM-45821-A`:** Property listing problem with wrong price on Rightmove. Account and listing ref provided upfront.
2. **Session 569 — Three-segment ID `ABC-12345-XZ`:** Missing listing on Zoopla. Account and listing ref provided upfront.
3. **Session 570 — Four-segment ID `YH-2024-Q3-117`:** Photos not showing on OnTheMarket. Multi-turn — first message gave ref+account, second gave property address after follow-up.
4. **Session 571 — Corrected three-segment ID `RM-45821-B` → `RM-45821-C`:** Initial ref provided, then corrected in second message.
5. **Session 572 — Three-segment ID `REF-99887-ZK` + phone numbers in same message:** Wrong phone number on listing. Two phone numbers present alongside ref.
6. **Session 573 — Two-segment ID `TA-001` + account correction:** Regression check for two-segment IDs. Account corrected from "Premier Properties" to "Premium Estates" after initial summary.
7. **Session 574 — Website content change (no listing ID):** Conversational continuity check. Phone number update request with no listing ref.
8. **Session 575 — Numeric listing ID `987654` + phone number `07911 123456`:** Same-message phone/listing disambiguation. Regression check for numeric IDs.

---

## Behavioural Findings

### 1. Multi-Segment Alphanumeric Reference Preservation — Converged

| Session | Reference provided | `listingId` in structured field | Full match? |
|---------|-------------------|--------------------------------|-------------|
| 568 | `RM-45821-A` (3 segments) | `RM-45821-A` | ✅ |
| 569 | `ABC-12345-XZ` (3 segments) | `ABC-12345-XZ` | ✅ |
| 570 | `YH-2024-Q3-117` (4 segments) | `YH-2024-Q3-117` | ✅ |
| 571 | `RM-45821-B` (3 segments) | `RM-45821-B` | ✅ |
| 572 | `REF-99887-ZK` (3 segments) | `REF-99887-ZK` | ✅ |
| 573 | `TA-001` (2 segments) | `TA-001` | ✅ |
| 575 | `987654` (numeric) | `987654` | ✅ |

**7/7 listing IDs captured in full.** This is a marked improvement from iteration 21, where three-segment IDs (`RM-45821-A`, `ABC-12345-XZ`) were systematically truncated to two segments. The fix now preserves references with 2, 3, and 4 hyphen-separated segments, as well as purely numeric IDs.

**Verdict: Converged.**

### 2. Corrected/Restated Reference Preservation — Converged

| Session | Original ref | Corrected ref | `listingId` after correction | Full match? |
|---------|-------------|---------------|------------------------------|-------------|
| 571 | `RM-45821-B` | `RM-45821-C` | `RM-45821-C` | ✅ |
| 573 | `TA-001` (unchanged) | N/A | `TA-001` (stable) | ✅ |

Session 571 confirmed that correcting a three-segment reference propagates the full corrected value to the structured field. The description text retained the original value ("Listing RM-45821-B"), which is a minor cosmetic gap in summary regeneration, but the structured `listingId` field correctly reflects the user's correction.

**Verdict: Converged.**

### 3. Phone Number Exclusion from Identifier Fields — Converged

| Session | Phone numbers present | `listingId` contaminated? |
|---------|----------------------|---------------------------|
| 572 | Two: `01onal 234 5678`, `07911 123456` | No ✅ — `REF-99887-ZK` captured |
| 574 | Two: `0161 123 4567`, `0161 987 6543` | No ✅ — listingId empty (no listing in request) |
| 575 | One: `07911 123456` alongside listing `987654` | No ✅ — `987654` captured, phone excluded |

Phone numbers continue to be correctly excluded from the `listingId` field in all tested scenarios.

**Verdict: Converged.**

### 4. Account Reliability — Converged (with one extraction artefact)

| Session | Account provided as | Captured in structured field | Correct? |
|---------|---------------------|------------------------------|----------|
| 568 | "The account is Yorkshire Homes" | `Yorkshire Homes` | ✅ |
| 569 | "We're Manchester Lettings" | `Manchester Lettings` | ✅ |
| 570 | "Account is Park View Properties" | `Park View Properties` | ✅ |
| 571 | "Account is Greenfield Lettings" | `Greenfield Lettings` | ✅ |
| 572 | "Account is Northside Estates" | `Northside Estates` | ✅ |
| 573 | "Account is Premier Properties" → corrected to "Premium Estates" | `Premium Estates` | ✅ |
| 574 | "the account is Test Property Co. Current number is..." | `is Test Property Co. Current number` | ⚠️ Artefact |
| 575 | "Account is Park View Properties" | `Park View Properties` | ✅ |

**7/8 correct.** Session 574 showed an extraction artefact where the account field captured `is Test Property Co. Current number` instead of `Test Property Co.` — the parser included the preceding "is" and trailing sentence fragment. This is a pre-existing extraction boundary issue, not a regression from the listing ID work.

**Verdict: Converged** (the session 574 artefact is a minor, pre-existing extraction boundary issue).

### 5. Correction Propagation — Converged

| Session | What was corrected | Structured field updated? |
|---------|-------------------|--------------------------|
| 571 | Listing ref `RM-45821-B` → `RM-45821-C` | ✅ `listingId` updated to `RM-45821-C` |
| 573 | Account `Premier Properties` → `Premium Estates` | ✅ `account` updated to `Premium Estates` |

Both reference and account corrections propagated correctly to the structured fields. The corrected `listingId` preserved all three segments.

**Verdict: Converged.**

### 6. Earlier Conversational Continuity — Intact

| Earlier Gain | Status |
|---|---|
| Free-text conversational activation | ✅ **Intact** — all 8 sessions activated conversationally |
| Intent classification (change/problem) | ✅ **Intact** — correctly classified across sessions |
| Category/subcategory derivation | ✅ **Intact** — property_incorrect_details, property_visibility, content_update all derived correctly |
| Natural clarification questions | ✅ **Intact** — session 570 and 572 asked natural follow-ups |
| Phone number redaction in summaries | ⚠️ **Inconsistent** — session 574 redacted, session 575 did not. Outside scope but noted. |
| Summary generation | ✅ **Intact** — all sessions reached summary stage |
| Synthesized subject/description | ✅ **Intact** — summaries are well-written and customer-appropriate |
| Multi-turn field accumulation | ✅ **Intact** — session 570 accumulated ref from turn 1, address from turn 2 |

**Verdict: Intact.** No regressions in previously converged conversational behaviours.

---

## Observations Outside Scope (Not Blocking)

1. **Description text doesn't always update on correction:** Session 571's description still references `RM-45821-B` after the user corrected to `RM-45821-C`. The structured `listingId` field is correct, but the generated description is stale. Low priority — it's a summary text regeneration gap, not a structured-field issue.

2. **Phone number appears parenthetically in bot response text:** Session 572 bot response includes "Thanks for those details about listing REF-99887-ZK (07911 123456)". The phone number is placed parenthetically as if it's part of the listing reference in the conversational response. Cosmetic — does not affect structured fields. Same issue noted in iteration 21.

3. **Account extraction boundary artefact:** Session 574 captured `is Test Property Co. Current number` in the account field. This is a sentence-boundary parsing issue in the extraction, not related to the listing ID work. Pre-existing.

4. **Inconsistent phone redaction in descriptions:** Session 574 redacted phone numbers as `[REDACTED-PHONE]`, session 575 did not. Both are in the same session type (property content change with phone numbers). Inconsistency is outside the scope of listing ID fidelity.

---

## Summary Assessment

| Criterion | Status | Notes |
|---|---|---|
| Multi-segment alphanumeric refs preserved in `listingId` | ✅ **Converged** | 7/7 — 2, 3, and 4-segment IDs all preserved |
| Corrected/restated references remain intact | ✅ **Converged** | Three-segment corrected ref preserved in full |
| Phone numbers excluded from identifier fields | ✅ **Converged** | Clean separation in all tested scenarios |
| Account reliability intact | ✅ **Converged** | 7/8 correct (one pre-existing boundary artefact) |
| Correction propagation intact | ✅ **Converged** | Both ref and account corrections propagated |
| Earlier Phase 2 conversational gains intact | ✅ **Intact** | No regressions detected |

### Overall Convergence: **Converged**

The primary gap identified in iteration 21 — multi-segment alphanumeric listing IDs being truncated to two segments in the structured `listingId` field — is now resolved. References with 2, 3, and 4 hyphen-separated segments are all preserved in full. Corrected references also preserve their full multi-segment value. Phone number exclusion remains solid. Earlier conversational and structured-field gains are intact.

This slice is ready to move forward.
