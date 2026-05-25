# Phase 2 — Iteration 17 Evaluation
## Conversational Intake: URL Handling & Mixed-Field Extraction

**Date:** 2026-05-23  
**Evaluator:** Automated behavioural eval via API  
**Method:** 6 scenarios run against `/api/portal/chat/sessions` endpoint  
**Auth:** OIDC portal JWT (portal-default-secret)

---

## Scenarios Tested

| # | Scenario | Reached Summary? | URL Captured? | Fields Clean? |
|---|----------|-----------------|---------------|---------------|
| 1 | URL provided upfront | NO | Acknowledged but lost | N/A |
| 2 | URL provided after question | YES | YES | Mostly (account contaminated) |
| 3 | Mixed account + URL single message | YES (1st message!) | YES | YES |
| 4 | Phone number + listing reference | NO | YES (captured) | Partial — looped on portal question |
| 5 | Complex URL with path | NO | YES (captured) | Looped on portal question |
| 6 | Natural greeting regression | YES (4 turns) | YES | YES |

---

## Behavioural Findings

### 1. URL Capture and Reuse

**Improved.** URLs are now consistently acknowledged and captured in the first response. In scenarios 1–5, the system correctly identified and echoed the URL back. Scenario 3 (mixed account+URL) reached summary in a single turn with the URL correctly placed.

**Remaining issue:** In Scenario 1, despite having the URL, the system looped asking for a "property address or reference" even though the issue was about site-wide search functionality, not a specific property. The URL was captured but the system couldn't progress because it got stuck on a property-specific clarification that wasn't relevant.

### 2. Repeated URL Clarification

**Materially improved.** The system no longer re-asks "what's the URL?" once it has been provided. In Scenario 2, after the user provides the URL, the next question is about property details, not the URL itself. This is a clear improvement over the prior "URL loop" behaviour.

**However:** A new loop pattern has appeared — the system now loops on "is this affecting your website, Rightmove, Zoopla, or somewhere else?" (Scenarios 4, 5). When the user tries to confirm/submit, it re-asks this question. This is the same structural problem (loop on unanswered clarification) but shifted from URL to portal/channel clarification.

### 3. Mixed-Field Contamination (Account/URL/Listing)

**Significantly improved.** Scenario 3 demonstrates clean separation:
- Account: "Smith & Jones Estate Agents" ✓
- URL: "https://www.smithjones.co.uk/about" ✓
- Description: Synthesised correctly ✓

**Remaining issue (Scenario 2):** The account field was populated with "URL is" — a partial fragment of the user's message "The URL is https://...". This suggests the field extraction LLM occasionally misreads a sentence fragment as an account name.

### 4. Phone Number Contamination

**Partially improved.** In Scenario 4:
- The system correctly identified "14 High Street" as the property address
- It showed "(01234 555 0456)" in its acknowledgment — it picked up the CORRECT phone number
- However, it never reached summary, so we can't verify whether the final fields would have listing ID correctly separated from phone numbers
- The phone number was NOT used as a listing ID in the acknowledgment text, which is positive

**Not fully verifiable** because the scenario never reached summary due to the portal-channel loop.

### 5. Summary Reachability

**Mixed results:**
- Scenario 3: Reached summary in 1 turn (excellent — rich first message with clear intent)
- Scenario 2: Reached summary in 3 turns (good)
- Scenario 6: Reached summary in 4 turns (acceptable for greeting + vague start)
- Scenarios 1, 4, 5: Never reached summary (looped on clarification)

The system is reaching summary reliably for website content/update issues but struggles with:
- Property-related issues (gets stuck asking for property address even when issue is site-wide)
- Issues requiring portal/channel identification (loops on "website, Rightmove, or Zoopla?")

### 6. Earlier Phase 2 Gains — Regression Check

**Conversational continuity:** PRESERVED ✓
- Natural greeting handled smoothly (Scenario 6)
- No robotic category selection buttons
- Conversational tone maintained throughout
- Hidden routing working (no visible category picker)

**Failure handling:** PRESERVED ✓
- "Would you like me to create a ticket so a team member can assist directly?" — appropriate fallback offer when stuck

**Summary format when reached:** GOOD ✓
- Clean markdown summary with labelled fields
- Description synthesis is natural and complete
- Subject line formatting is consistent

**Ticket creation:** BROKEN (separate issue)
- Both scenarios that reached summary and got confirmation ("Yes submit", "go ahead") failed with: "I'm sorry — I wasn't able to create the ticket right now."
- This appears to be a Jira integration/configuration issue, not a conversational flow issue.

---

## Convergence Assessment

| Dimension | Status |
|-----------|--------|
| URL capture on first mention | ✅ Converged |
| URL not re-asked once known | ✅ Converged |
| Mixed account/URL separation | ⚠️ Mostly converged (occasional fragment leak) |
| Phone number → listing contamination | ⚠️ Cannot fully verify (blocked by loop) |
| Summary reachability | ❌ Not converged — new loop on portal/channel clarification |
| Earlier conversational gains | ✅ Preserved |
| Ticket submission | ❌ Broken (integration issue, out of scope) |

---

## Overall Verdict: PARTIALLY CONVERGED

The URL-specific improvements are solid — URLs are captured reliably and not re-asked. The mixed-field separation is materially better. However, a new looping pattern has emerged around portal/channel clarification ("website, Rightmove, or Zoopla?") that blocks property-related issues from reaching summary. This is the same structural problem (mandatory clarification loop) relocated from URL to a different field.

### Recommended Next Focus
1. **Portal/channel clarification loop** — the system should either:
   - Infer "website" when the user has already provided a website URL
   - Accept a confirmation/submit signal as permission to proceed without this field
   - Limit clarification to 1 attempt before defaulting
2. **Account field fragment leak** — "URL is" being captured as account name (Scenario 2)
3. **Ticket creation failure** — separate investigation needed (Jira integration)

---

## Raw Data
See `phase2_iter17_raw.json` in this directory for full transcript and metadata.
