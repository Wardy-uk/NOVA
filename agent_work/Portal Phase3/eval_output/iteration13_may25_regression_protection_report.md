# Portal Phase3 Iteration 13 — May 25 Regression Protection Bundle Report

**Evaluation:** Iteration 13 — May 25 regression protection bundle  
**Date:** 2026-05-25  
**Evaluator:** Eval Agent  
**Runtime:** localhost:3001 (dev server)  
**Auth:** Portal codex-test-login (requester role)

---

## Overall Verdict: REGRESSION PROTECTED

All three target domains hold through the real runtime path. No critical behavioural blockers. No material regression across domains or against earlier protected behaviours. Customer-visible coherence and taxonomy protection are intact.

---

## Per-Domain Verdicts

### Deterministic Routing Hardening: REGRESSION PROTECTED

**Checks passed: 7/7**

| Test | Input | Session Category | Verdict |
|------|-------|-----------------|---------|
| DET-1 | Email template canonical (autumn campaign) | email_marketing | PASS |
| DET-2 | Email template variant wording (H1) | email_marketing | PASS |
| DET-3 | Email template + property incidental | email_marketing | PASS |
| DET-4 | Letters market appraisal (SE1) | letters | PASS |
| DET-5 | Letters mailshot (vendors) | letters | PASS |
| DET-6 | Letters general variant — printed correspondence (H1) | letters | PASS |
| DET-7 | Email template redesign | email_marketing | PASS |

**Confirmed protected behaviours:**
- Email template requests route to `email_marketing` consistently across canonical and variant phrasings
- Letters/correspondence requests route to `letters` with correct subcategory inference
- Incidental domain mentions (property in template requests) do not drag routing off the deterministic path
- All replies use customer-facing language — no internal routing mechanics visible

### Edge-Case Routing Sensitivity Hardening: REGRESSION PROTECTED

**Checks passed: 6/6**

| Test | Input | Session Category | Verdict |
|------|-------|-----------------|---------|
| EDGE-1 | NT-55555 is not fixed | followup | PASS |
| EDGE-2 | NT-20001 is not fixed | followup | PASS |
| EDGE-3 | NT-99999 is not resolved | followup | PASS |
| EDGE-4 | NT-77777 is not working (H2) | followup | PASS |
| EDGE-5 | Website-primary + letters incidental | website | PASS |
| EDGE-6 | Property images on my website | website | PASS |

**Confirmed protected behaviours:**
- `is not fixed` / `is not resolved` / `is not working` patterns route consistently to followup across multiple ticket numbers
- Website-primary requests with incidental letters mention stay as website
- "Property images on my website" correctly routes to website, not property
- Follow-up replies reference the ticket number in bold and acknowledge the unresolved state
- All replies use customer-facing language

### Single Shared Config Protection: REGRESSION PROTECTED

**Structural checks passed: 3/3**

| Check | Result |
|-------|--------|
| Shared config file exists at `src/shared/portal-category-field-config.ts` | PASS |
| Client (`PortalNewRequest.tsx`) imports from shared config | PASS |
| Server (`portal-chat.ts`) imports from shared config | PASS |

**Taxonomy checks passed: 7/7**

| Subcategory | Present in API | Verdict |
|-------------|---------------|---------|
| website_broken | Yes | PASS |
| website_content | Yes | PASS |
| account_login | Yes | PASS |
| followup_reopen | Yes | PASS |
| complaint_service | Yes | PASS |
| letters_general | Yes | PASS |
| other_general | Yes | PASS |

**Runtime path checks:**
- Total categories returned by API: 14 (all with customer-facing labels)
- No stale local field-config definitions found outside shared config
- Chat sessions created and responded correctly for all representative subcategories tested via routing checks

---

## Protected Behaviour Regression Checks (H4)

| Test | Input | Session Category | Verdict |
|------|-------|-----------------|---------|
| PROT-1 | Formal complaint (terrible service) | complaint | PASS |
| PROT-2 | NT-18592 still not fixed | followup | PASS |
| PROT-3 | Phone number on website wrong | website | PASS |
| PROT-4 | Rightmove listing missing floor plan | property | PASS |
| PROT-5 | Market appraisal letters to vendors | letters | PASS |

**All 5 protected paths stable.** No regression from the three converged domains.

---

## Taxonomy Leak Check

All 18 routing test replies inspected for internal jargon. No occurrences of: subcategory identifiers, routing terminology, project keys, queue names, Jira terms, category_id, getProjectFor, NTPJ, classification, or intake. All replies use natural customer-facing language.

---

## Holdout Scenario Results

| Holdout | Scenario | Result |
|---------|----------|--------|
| H1 | Variant wording for email template and letters (DET-2, DET-6) | PASS — routes consistently |
| H2 | Named edge-case routing fixes re-run (EDGE-1 through EDGE-6) | PASS — all defects remain closed |
| H3 | Representative shared-config-driven paths (taxonomy + structural) | PASS — clean alignment |
| H4 | Protected follow-up, complaint, website, property, letters controls | PASS — all stable |

---

## Checks Summary

| Area | Passed | Total |
|------|--------|-------|
| Deterministic routing | 7 | 7 |
| Edge-case routing | 6 | 6 |
| Shared config (structural) | 3 | 3 |
| Shared config (taxonomy) | 7 | 7 |
| Protected behaviours | 5 | 5 |
| Taxonomy leak check | 18 | 18 |
| Holdout scenarios | 4 | 4 |
| **Total** | **50** | **50** |

---

## Blockers

None.

---

## Non-Blocking Gaps

1. **Letters precedence when "website" appears as incidental context** — pre-existing limitation from iteration 10. The letters precedence gate defers when "website" appears anywhere in the message. Pure letters requests (without "website") always route correctly. Not a regression.

2. **`property_*` subcategories not in DEFAULT_CATEGORIES** — pre-existing condition noted in iteration 11. Property routing uses `listings_*` and `feeds_property` IDs in the taxonomy. Does not affect runtime behaviour.

3. **Chat session `status` returns undefined for new sessions** — pre-existing observability gap noted in iteration 11. Does not affect field-config-driven behaviour.

---

## Archive Recommendation

All three domains can be archived as protected convergence:

- **Deterministic routing hardening:** Email template and letters/correspondence routes are stable across canonical and variant phrasings. Holdout H1 confirms consistency under variant wording.
- **Edge-case routing sensitivity hardening:** All three named defects (is not fixed, website-primary + letters, property images on website) remain closed. Holdout H2 confirms stability across novel ticket numbers and verb forms.
- **Single shared config protection:** Single canonical source confirmed structurally and through runtime. No stale copies. Taxonomy alignment clean for all required subcategories.

The regression protection bundle holds. No domain materially regresses another. Customer-visible coherence and taxonomy protection are intact. No further build work is required.
