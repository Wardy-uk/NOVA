# Iteration 9 — Edge-Case Routing Sensitivity Hardening Eval

**Date:** 2026-05-25
**Slice:** Edge-case routing sensitivity hardening
**Verdict:** NOT CONVERGED

## Summary

Two named misses were targeted: (1) mixed letters/website requests routing correctly based on primary intent, and (2) `NT-XXXXX is not fixed` (without "still") entering the follow-up path. Neither miss is closed. Additionally, two protected control cases regressed: pure website requests misroute to `property`, and multi-incident complaint phrasing fails to resolve category.

---

## Checks Passed (8/14)

| ID | Scenario | Category | Result |
|----|----------|----------|--------|
| P1-LETTERS-WEBSITE-MIX | Letters request with incidental website mention | letters (letters_market_appraisal) | **PASS** |
| CTRL-STILL-NOT-FIXED | Canonical `NT-99999 is still not fixed` | followup (followup_not_resolved) | **PASS** |
| CTRL-COMPLAINT | Pure formal complaint | complaint (complaint_response) | **PASS** |
| CTRL-PROPERTY | Pure property missing from listings | property (property_missing_listing) | **PASS** |
| CTRL-LETTERS | Pure mailshot request | letters (letters_mailshot) | **PASS** |
| H1-LETTERS-PRIMARY | Letters primary with website context (holdout) | letters (letters_market_appraisal) | **PASS** |
| H2-FOLLOWUP-77777 | NT-77777 is not fixed (holdout) | followup (followup_not_resolved) | **PASS** |
| VOCAB-FIREWALL | No internal routing jargon in responses | letters (letters_general) | **PASS** |

### Positive observations

- Letters precedence works correctly when letters is the clear primary intent — even with website mentioned as context (P1, H1).
- Canonical `still not fixed` follow-up works reliably (CTRL-STILL-NOT-FIXED).
- Holdout H2 (`NT-77777 is not fixed`) **passes** — suggesting the follow-up keyword detection works for *some* ticket numbers but not all. This is inconsistent.
- Vocabulary firewall is clean — no internal routing jargon leaked to customer.
- Pure complaint, property, and letters controls all pass.

---

## Checks Failed (6/14)

### BLOCKER 1: `NT-XXXXX is not fixed` follow-up — inconsistent (3 failures, 1 pass)

| ID | Input | Expected | Got | Confirmed on retest |
|----|-------|----------|-----|---------------------|
| P2-FOLLOWUP-55555 | `NT-55555 is not fixed` | followup | **property** (property_missing_listing) | Yes — consistent |
| P2B-FOLLOWUP-20001 | `NT-20001 is not fixed` | followup | **other** (other_general) | Yes — consistent |
| P2C-FOLLOWUP-VARIANT | `NT-12345 is not fixed yet` | followup | **other** (other_general) | Yes — consistent |
| H2-FOLLOWUP-77777 | `NT-77777 is not fixed` | followup | **followup** (followup_not_resolved) | Pass |

The follow-up detection for `is not fixed` (without `still`) is **not reliably closed**. It works for NT-77777 but fails for NT-55555, NT-20001, and NT-12345. The keyword detection appears to depend on the ticket number or some other non-deterministic factor. The reply for NT-55555 even mentions "is this affecting your website, property portals like Rightmove or Zoopla" — the system misinterprets the ticket reference as a property listing issue.

**This is a named miss that remains open.**

### BLOCKER 2: Website request with incidental letters mention — overcorrected

| ID | Input | Expected | Got | Confirmed on retest |
|----|-------|----------|-----|---------------------|
| P1B-WEBSITE-LETTERS-MIX | Website primary + letters incidental | website | **letters** (letters_general) | Yes — consistent |

The letters precedence fix has overcorrected: when a customer says their website phone number is wrong but incidentally mentions they "also do letters through you", the system routes to `letters` instead of `website`. The reply even acknowledges the website issue but categorises as letters.

**This is the regression trap H1 warned about — letters precedence stealing genuine website requests.**

### REGRESSION: Pure website control misroutes to property

| ID | Input | Expected | Got | Confirmed on retest |
|----|-------|----------|-----|---------------------|
| CTRL-WEBSITE | "The property images on my website are not loading properly" | website | **property** (property_visibility) | Yes — consistent |

This is a protected control case. A request about website image loading (a website_broken issue) is misrouted to `property` because the word "property" appears in the sentence. The user means "images of properties on my website", not "a property listing issue". This is a pre-existing issue but constitutes a regression if the hardening changes touched website/property disambiguation.

### NON-BLOCKING: Complaint holdout H3 — null category

| ID | Input | Expected | Got | Confirmed on retest |
|----|-------|----------|-----|---------------------|
| H3-COMPLAINT-POST-HARDENING | Multi-incident formal complaint | complaint | **null** | Yes — consistent |

The multi-incident complaint phrasing ("raised this issue three times... want to make an official complaint") fails to resolve a category (stays at `intent` stage with null category). However, the reply is complaint-appropriate ("I can see this is frustrating... Would you like me to create a ticket"). The system behaviourally handles it correctly despite the metadata not reflecting complaint classification. This is non-blocking for the current slice since the canonical complaint control passes.

---

## Decision Analysis

### Named Miss 1 (letters+website mixed intent): PARTIALLY CLOSED
- Letters-primary with incidental website detail → **PASS** (P1, H1)
- Website-primary with incidental letters mention → **FAIL** — letters steals the request
- The fix works in one direction but overcorrects in the other

### Named Miss 2 (NT-XXXXX is not fixed): NOT CLOSED
- Works for `still not fixed` (canonical) → **PASS**
- Works for some `is not fixed` cases (NT-77777) → **PASS**
- Fails for other `is not fixed` cases (NT-55555, NT-20001, NT-12345) → **FAIL**
- The fix is inconsistent across ticket numbers

### Protected behaviour stability: ONE REGRESSION
- Complaint (canonical): stable ✓
- Property: stable ✓
- Letters: stable ✓
- Follow-up (canonical): stable ✓
- Website: **REGRESSED** — pure website with "property" in text misroutes to property ✗
- Vocabulary firewall: stable ✓

---

## Blockers

1. **`is not fixed` follow-up path is unreliable** — works for some ticket numbers, fails for others. The keyword detection likely has a pattern matching gap or is being overridden by LLM classification for certain numeric patterns.
2. **Letters precedence overcorrects** — steals website-primary requests when letters are mentioned incidentally.
3. **Pure website "property images" misroutes to property** — word "property" in a website context triggers property classification.

## Non-Blocking Gaps

1. H3 complaint holdout fails to set category metadata despite correct behavioural response — the user experience is correct but the data pipeline may miss the complaint classification.

## Recommendation

**Another small build slice is required.** The two named misses are not both closed, and one protected control case has regressed. Specific fixes needed:

1. **Follow-up `is not fixed` detection**: The keyword/pattern matcher needs to reliably catch `NT-XXXXX is not fixed` regardless of ticket number. Currently inconsistent — likely an issue with the keyword detection function not matching or being overridden by LLM classification.
2. **Letters precedence guard**: The letters keyword detector needs a guard so it doesn't fire when the primary request is clearly about website content. The customer's explicit dismissal of letters ("that's fine", "not important") should be respected.
3. **Website vs property disambiguation**: When "property" appears as a descriptor in a website context ("property images on my website"), the website classification should take priority over property.
