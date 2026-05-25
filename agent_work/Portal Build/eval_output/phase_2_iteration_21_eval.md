# Phase 2 Iteration 21 — Structured-Field Fidelity Evaluation

**Date:** 2026-05-24  
**Evaluator:** Eval Agent (API-level behavioural testing)  
**Server:** localhost:3001, authenticated via codex-test-login (Codex Test Organisation)  
**Sessions tested:** 559, 560, 561, 562, 563, 564, 565, 566

---

## Journeys Tested

Eight conversational intake journeys were executed via the portal chat API:

1. **Session 559 — Website phone update with account + ref upfront:** Account name and number in first message, phone number details in second. Tests account-field capture from initial message.
2. **Session 560 — URL correction then account correction:** Reports problem with wrong URL, corrects URL in second message, corrects account name in third. Tests correction propagation.
3. **Session 561 — Property listing with multi-segment reference ID:** Listing ref `RM-45821-A`, property address, account, and second reference `YH-2024-Q3-117` provided. Tests alphanumeric ID capture.
4. **Session 562 — Three phone numbers + account name:** Content change request with current/desired phone numbers plus personal callback number. Tests phone-number contamination of identifiers.
5. **Session 563 — Vague problem with natural continuity:** Vague initial message, natural account+URL provision, then confirmation attempt. Tests conversational continuity and ticket-creation acceptance.
6. **Session 564 — Rich initial message with early confirmation:** Detailed initial request, then "yes, please create the ticket" immediately. Tests direct confirmation handling.
7. **Session 565 — Alphanumeric listing ID with suffix:** Listing ref `ABC-12345-XZ` in property visibility report. Tests multi-segment alphanumeric capture.
8. **Session 566 — Numeric listing ID + phone number in same message:** Listing `987654` alongside phone `07911 123456`. Tests phone contamination of numeric listing IDs.

---

## Behavioural Findings

### 1. Account Field Reliability — Significantly Improved

| Session | Account provided as | Captured in structured field? | Correct? |
|---------|---------------------|-------------------------------|----------|
| 559 | "The account is Greenfield Lettings" | ✅ `Greenfield Lettings` | Yes |
| 560 | Corrected to "Premier Properties" | ✅ `Premier Properties` | Yes |
| 561 | "The account is Yorkshire Homes" | ✅ `Yorkshire Homes` | Yes |
| 562 | "Our account is Northside Estates" | ✅ `Northside Estates` | Yes |
| 563 | "Premier Properties at premierprops.co.uk" | ✅ `Premier Properties` | Yes |
| 564 | "Account name is Test Account Ltd" | ✅ `Test Account Ltd` | Yes |
| 565 | "Account is Manchester Lettings" | ✅ `Manchester Lettings` | Yes |
| 566 | "The account is Park View Properties" | ✅ `Park View Properties` | Yes |

**8/8 sessions correctly captured the account name** from conversational context. This compares to ~25% reliability observed in iteration 3 (2 sessions ago). The account field is now reliably extracted regardless of how naturally it is phrased.

**Verdict: Converged.**

### 2. Correction Propagation — Working

Session 560 tested both URL and account correction:

- **URL:** Initially provided `https://www.wrongurl.com`, corrected to `https://www.correctsite.co.uk`. The structured `url` field updated to `https://www.correctsite.co.uk`. ✅
- **Account:** Initially no account, corrected to "Premier Properties". The structured `account` field updated to `Premier Properties`. ✅
- **Bot acknowledged corrections naturally:** "Could you please provide the account name associated with https://www.correctsite.co.uk" — showing it understood the URL change.

The system also correctly continued asking for remaining missing fields after processing the corrections, rather than re-asking for already-corrected fields.

**Verdict: Converged.**

### 3. Alphanumeric Listing/Reference ID Capture — Partially Improved

| Session | Reference provided | Captured as `listingId` | Full match? |
|---------|-------------------|------------------------|-------------|
| 561 | `RM-45821-A` | `RM-45821` | ❌ Truncated |
| 564 | `TA-001` | `TA-001` | ✅ |
| 565 | `ABC-12345-XZ` | `ABC-12345` | ❌ Truncated |
| 566 | `987654` | `987654` | ✅ |

**Pattern:** IDs with two segments (e.g., `TA-001`) and purely numeric IDs (e.g., `987654`) are captured correctly. IDs with three or more hyphen-separated segments (e.g., `RM-45821-A`, `ABC-12345-XZ`) are truncated to the first two segments.

Notably, the **description field** preserves the full reference in all cases. The truncation only affects the structured `listingId` field, suggesting the extraction prompt or post-processing normalises references to a two-segment format.

The secondary reference `YH-2024-Q3-117` provided in session 561 was preserved in the description but not captured in any structured field — there is no field for secondary references.

**Verdict: Not yet converged.** Two-segment and numeric IDs work, but multi-segment alphanumeric IDs are systematically truncated in the structured field.

### 4. Phone Number Contamination — Largely Resolved

| Session | Phone numbers present | `listingId` contaminated? | `contactPreference` |
|---------|----------------------|---------------------------|---------------------|
| 562 | 3 phone numbers (current, desired, callback) | N/A (no listing) ✅ | `phone` (inferred from "Call me") ✅ |
| 566 | 1 phone number ("07911 123456") + listing 987654 | No ✅ (`987654` correctly captured) | `phone` ✅ |

Phone numbers are no longer being captured as listing IDs. The system correctly distinguishes between phone numbers and reference IDs in the structured fields.

**Minor cosmetic issue:** In session 566, the bot's response text reads "Thanks for those details about 5 Park Road on OnTheMarket (07911 123456)" — the phone number appears parenthetically in the response text as if it's part of the portal reference. This does not affect structured fields but is a confusing user experience.

**Verdict: Converged** for structured fields. Minor cosmetic response-text issue remains.

### 5. Conversational Continuity — Intact with Minor Gaps

| Earlier Gain | Status |
|---|---|
| Free-text conversational activation | ✅ **Intact** — all 8 sessions activated conversationally |
| Intent classification (change/problem) | ✅ **Intact** — correctly classified in all sessions |
| Category/subcategory derivation | ✅ **Intact** — website_content, website_broken, property_visibility all derived correctly |
| Natural clarification questions | ✅ **Intact** — questions feel conversational, not robotic |
| Phone number redaction in summaries | ✅ **Intact** — `[REDACTED-PHONE]` in summary descriptions |
| Summary generation | ✅ **Intact** — sessions 561, 562, 563, 564, 565 all reached summary stage |
| Synthesized subject/description | ✅ **Intact** — summaries are well-written and customer-appropriate |
| Ticket creation acceptance | ⚠️ **Improved but inconsistent** — see below |

**Ticket creation acceptance details:**

- Session 563: "Yes, that sounds right. Please go ahead and log it" was treated as insufficient detail → bot asked for more specifics rather than generating summary. Required a second attempt with additional context to progress. This is because the system interpreted the user's agreement as needing elaboration on the problem details.
- Session 564: "Yes, please create the ticket" after one clarification → bot asked for error messages instead of progressing. Required a second attempt with "Yes, create the ticket" after being offered ticket creation to finally reach summary.
- Sessions 561, 562, 565: Reached summary naturally after sufficient detail was provided — no acceptance issue.

The ticket creation acceptance path works when either (a) the user provides additional detail alongside their acceptance, or (b) the `offeredTicketCreation` flag is set and the user gives a clean "yes". But the system sometimes asks unnecessary follow-up questions before offering, and the initial "yes" isn't always recognised.

---

## Summary Assessment

| Criterion | Status | Notes |
|---|---|---|
| Account fields cleaner and more reliable | ✅ **Converged** | 8/8 sessions captured correctly (was ~25% in iter 3) |
| Corrected details propagate to structured fields | ✅ **Converged** | URL and account corrections both propagated |
| Alphanumeric listing/reference IDs captured reliably | ⚠️ **Partially converged** | Two-segment IDs work; three-segment IDs truncated |
| Phone numbers not contaminating identifiers | ✅ **Converged** | Clean separation in all tested scenarios |
| Earlier Phase 2 conversational gains intact | ✅ **Intact** | All previously converged behaviours preserved |

### Overall Convergence: **Partially Converged**

The major structured-field fidelity issues from previous iterations are largely resolved. Account fields, correction propagation, and phone-number contamination are all converged. The remaining gap is **multi-segment alphanumeric listing ID truncation** — the structured `listingId` field drops segments after the second hyphen while the description preserves the full reference.

### Remaining Issues (Priority Order)

1. **Medium:** Multi-segment listing IDs (e.g., `RM-45821-A`, `ABC-12345-XZ`) are truncated to two segments in the `listingId` structured field
2. **Low:** Bot response text sometimes includes phone numbers parenthetically in unexpected places (session 566 cosmetic issue)
3. **Low:** Initial "yes, create the ticket" not always recognised as acceptance without additional context — sometimes needs a second affirmative after the explicit `offeredTicketCreation` prompt
