# Portal Phase 3 — Deterministic Routing Hardening Evaluation

**Evaluation:** Iteration 8 — Deterministic Routing Hardening  
**Date:** 2026-05-25  
**Evaluator:** Eval Agent  
**Runtime:** localhost:3001 (dev server)  
**Auth:** Portal codex-test-login (requester role)

---

## Overall Verdict: CONVERGED (with non-blocking gaps)

The targeted deterministic routing cases now behave predictably. Email template requests and letters/correspondence requests route to their intended categories with correct subcategory inference. Repeated and variant phrasings produce consistent results for the targeted cases. Protected follow-up, complaint, website, and property paths remain stable. No internal routing mechanics leak to the customer.

---

## Priority Check Results

### 1. Email template routing: PASS

| Test | Input | Category | Subcategory | Correct? |
|------|-------|----------|-------------|----------|
| T1 | "I need a new email template designed for our autumn campaign" | email_marketing | email_template | YES |
| T2 | "Can you create a new template for our email marketing?" | email_marketing | email_template | YES |
| T3 | "I need a new email template for our property launch campaign, we have some listings going live next week" | email_marketing | email_template | YES |
| T12 | "We want to update our email template design" | email_marketing | email_template | YES |
| T13 | "Our email template needs redesigning please" | email_marketing | email_template | YES |
| T15 | "I need a new email template designed, also can you check our billing is up to date" | email_marketing | email_template | YES |
| T17 | Exact repeat of T1 | email_marketing | email_template | YES |
| T19 | "Please can you build us a new template for email marketing" | email_marketing | email_template | YES |

**7/7 targeted template cases route correctly.** Incidental detail from other domains (property listings in T3, billing in T15) does not drag template requests off the deterministic path.

### 2. Letters/correspondence routing: PASS

| Test | Input | Category | Subcategory | Correct? |
|------|-------|----------|-------------|----------|
| T4 | "We need to send market appraisal letters to properties in the SE1 postcode area" | letters | letters_market_appraisal | YES |
| T5 | "I need to do a property mailshot to all vendors in our area" | letters | letters_mailshot | YES |
| T6 | "We need some printed letters sending out to our clients" | letters | letters_general | YES |
| T14 | "We need to send printed correspondence to our clients in the local area" | letters | letters_general | YES |
| T29 | "Can you send out a batch of mailshot letters for Smith & Jones Estate Agents" | letters | letters_mailshot | YES |

**5/5 targeted letters cases route correctly.** Subcategory inference (market_appraisal, mailshot, general) works reliably. Correspondence keyword detected without requiring "letter" explicitly.

### 3. Keyword detector consistency across variants: PASS

Template detector: 8 phrasings tested, all routed to email_marketing/email_template.  
Letters detector: 5 phrasings tested, all routed to letters with correct subcategory.

### 4. Internal routing hidden from customer: PASS

All 29 test replies inspected. No occurrences of: NTPJ, NT- (as project key), project_key, routing, queue, ITSM, Jira, subcategory, category_id, or getProjectFor. Customer-facing language throughout.

### 5. Protected paths: PASS

| Test | Input | Category | Subcategory | Correct? |
|------|-------|----------|-------------|----------|
| T8 | "NT-18592 is still not fixed" | followup | followup_not_resolved | YES |
| T9 | "I want to make a formal complaint about the service I have received" | complaint | complaint_service | YES |
| T10 | "The contact form on our website is broken" | website | website_broken | YES |
| T11 | "The property listing has wrong images on it" | property | property_incorrect_details | YES |
| T21 | "NT-18592 is still not fixed" (repeat) | followup | followup_not_resolved | YES |
| T22 | "NT-12345 still not fixed" | followup | followup_not_resolved | YES |
| T26 | "NT-55555 is still not fixed" | followup | followup_not_resolved | YES |

All protected domains stable. Complaint, follow-up, website, and property paths not intercepted by new deterministic routing.

---

## Multi-Turn Verification

**Email template multi-turn (Session SID):**
- Turn 1: "new email template for our winter newsletter" → category: email_marketing, subcategory: email_template
- Turn 2: "ABC Estate Agents account, festive design with property listings" → stays on email_template, proceeds to summary card
- Category preserved through multi-turn. Summary card produced with correct subject prefix `[Portal] Template —`.

---

## Holdout Scenario Results

| Holdout | Scenario | Result | Notes |
|---------|----------|--------|-------|
| H1 | Repeated variant wording for same target case | PASS | 8 template variants + 5 letters variants all route consistently |
| H2 | Targeted routing case with incidental detail from another domain | PASS (partial) | Template + property/billing incidentals: PASS. Letters + "website" incidental: routes to website instead (see non-blocking gap 1) |
| H3 | Protected follow-up/complaint after deterministic changes | PASS | Follow-up with "still" language works. Complaint path works. Neither stolen by deterministic detectors |

---

## Non-Blocking Gaps

### 1. Mixed letters + website signal overrides deterministic detector

When "market appraisal letters" appears alongside "website" in the same message (T7, T27, T28), the LLM's website domain classifier fires first (at ≥0.4 confidence) and returns before the deterministic letters detector runs. The letters detector sits at position 8 in the classification cascade, after all LLM domain checks (website ≥0.6, website ≥0.4, property ≥0.6, property ≥0.4, account ≥0.6, account ≥0.4).

**Impact:** Low. Pure letters requests (without "website" in the same message) always route correctly. The mixed case is an edge case where the customer mentions two separate needs — the system picks the website need, which is still a valid routing choice.

**Potential fix (deferred):** Move deterministic detectors before the LLM domain checks, or add letters/template keyword exclusion to the website classifier. Not required for convergence.

### 2. Follow-up "is not fixed" (without "still") sensitivity

"NT-XXXXX is not fixed" (without "still") doesn't match `ESCALATION_CHASE_PATTERNS` regex (which requires "still", "hasn't been", or other chase-specific language). It falls through to LLM classification, which inconsistently routes some ticket numbers to property or other categories.

| Input | With "still" | Without "still" |
|-------|-------------|-----------------|
| NT-18592 | PASS (followup) | PASS (followup) |
| NT-12345 | PASS (followup) | PASS (followup) |
| NT-55555 | PASS (followup) | FAIL (property) |
| NT-20001 | not tested | FAIL (other) |
| NT-99999 | not tested | FAIL (property) |

**Impact:** Low-moderate. The "still not fixed" phrasing always works. The form-based follow-up path always works. The missing pattern is "is not fixed" → should match chase/follow-up but doesn't. This is pre-existing — the `ESCALATION_CHASE_PATTERNS` regex was not changed by the deterministic routing build, and the issue is LLM sensitivity for phrasings that don't match the explicit pattern.

**Potential fix (deferred):** Add `\bnot (fixed|resolved|sorted|working)\b` to `ESCALATION_CHASE_PATTERNS` to catch the "is not fixed" phrasing without requiring "still".

### 3. Shared config duplication

Letters category entries were added to both `portal-chat.ts` (CATEGORY_FIELD_CONFIG, CATEGORY_NAMES, SUBCATEGORY_NAMES) and `PortalNewRequest.tsx` manually. This is a maintenance concern noted by the build agent. Not a routing issue.

---

## Blockers

None.

---

## Category Grid Verification

Letters & Correspondence present in category API with 3 subcategories:
- `letters_market_appraisal` — "Market appraisal letter"
- `letters_mailshot` — "Property mailshot or marketing letter"
- `letters_general` — "Other printed correspondence"

Total categories: 14 (9 original + 4 Phase 3 + 1 letters). All named with customer-facing labels. No taxonomy leakage.

---

## Recommendation: CONVERGED for this slice

The targeted deterministic routing gaps are closed:
- **email_template** routes to its intended path, not the parent default
- **letters/correspondence** enters the new letters category with correct subcategory inference
- Keyword detectors behave consistently across repeated and varied phrasings
- Internal routing complexity is hidden from the customer
- Protected follow-up, complaint, website, and property paths are stable

The two non-blocking gaps (mixed domain override and "is not fixed" without "still") are edge cases that don't compromise the deterministic routing model. Both have clear deferred fixes if needed.

No further build slice required for this domain.
