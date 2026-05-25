# Evaluation Report — Iteration 4: Reopened / Follow-Up Ticket Continuity Final Hardening

**Date:** 2026-05-24  
**Evaluator:** Eval Agent  
**Slice:** Reopened / follow-up ticket continuity  
**Overall Verdict:** CONVERGED

---

## Summary

All blockers from iteration 3 are resolved. The "still not fixed" phrasing (three variants) now correctly routes to `category: followup`, `subcategory: followup_not_resolved`. The `followUpTicketKey` field is populated with the ticket reference from the customer's opening message. The summary card displays "Related ticket: NT-18592" as intended. The portal no longer asks for a ticket reference the customer already provided. No taxonomy leaks, no regressions in protected behaviours.

---

## Checks Passed

| # | Check | Result |
|---|-------|--------|
| 1 | "NT-18592 is still not fixed" triggers follow-up path | **PASS** — routes to followup/followup_not_resolved, followUpTicketKey = "NT-18592" |
| 2 | "Ticket NT-18592 still not fixed" triggers follow-up path | **PASS** — same routing behaviour |
| 3 | "Still not fixed - NT-18592" triggers follow-up path | **PASS** — same routing behaviour |
| 4 | `followUpTicketKey` populated correctly | **PASS** — "NT-18592" in session metadata |
| 5 | Summary card shows "Related ticket: NT-18592" | **PASS** — visible in summary stage output |
| 6 | Portal does not ask for ticket ref already provided | **PASS** — after recognising NT-18592, asks "what still needs attention?" not "what's the ticket reference?" |
| 7 | Previously passing patterns still work: "still waiting", "marked resolved but not" | **PASS** — no regression |
| 8 | Follow-up without ticket ref correctly asks for reference | **PASS** — "Could you let me know the ticket reference or describe the original issue" |
| 9 | Website/property category regression check | **PASS** — "500 error on contact page" → website/website_broken |
| 10 | No taxonomy leaks in any response | **PASS** — no internal category names, subcategory codes, confidence language, or routing jargon |
| 11 | Conversational tone appropriate and customer-safe | **PASS** — natural, empathetic, forward-moving throughout |
| 12 | Domain keywords no longer override follow-up when ticket ref + chase language present | **PASS** — "property photos not uploading + NT-12345 + still broken" → followup |

## Checks Failed

None.

---

## Holdout Scenario Results

| ID | Scenario | Result | Notes |
|----|----------|--------|-------|
| H1 | Valid ticket + "still not fixed" | **PASS** | All three canonical phrasings correctly route to follow-up continuity path |
| H2 | Short chasing question with ticket ref ("still waiting") | **PASS** | Acknowledged ticket, moved journey forward |
| H3 | Ticket ref + new detail changing situation | **PASS** | Domain keywords (photo uploads, dates, agent count) did not override follow-up routing when chase intent present |

## Edge Input Results

| Input | Result |
|-------|--------|
| Ticket ref + "still not fixed" | PASS — followup |
| Ticket ref + "still waiting" | PASS — followup |
| Ticket ref + "marked resolved but it is not" | PASS — followup |
| Ticket ref + domain detail + "still broken" | PASS — followup (improved from iteration 3) |
| Follow-up without ticket ref | PASS — followup, asks for reference |

---

## Confirmed Behaviours

- Follow-up detection now fires BEFORE frustration detection — the `frustrationDetected: false` flag confirms the reordering fix
- `followUpTicketKey` is populated from the ticket reference in the customer's opening message
- The summary card renders "Related ticket: NT-18592" as a distinct line
- The detail-collection stage does not redundantly ask for the ticket reference
- The continuation path remains coherent: greeting acknowledges prior ticket → asks what still needs attention → collects account → presents summary
- Domain-specific keywords no longer override follow-up intent when chase language and a ticket reference are both present
- Normal intake flows (website, property) are unaffected

---

## Non-Blocking Gaps

1. **Dual display of "Related ticket" and "Listing ref":** The summary card shows both "Related ticket: NT-18592" and "Listing ref: 18592" — the latter is a numeric extraction stored in `listingId`. This is cosmetically redundant but does not compromise the continuity model. The "Related ticket" line correctly shows the full key.

2. **Account parsing edge case:** Not retested this iteration, but the "is Codex" prefix artefact from iteration 3 (F5) was not observed — account was cleanly captured as "Codex Property Solutions" when provided directly.

3. **Jira hydration / summary enrichment:** `followUpTicketSummary` was not populated (likely because `jira_issue_cache` doesn't contain test ticket NT-18592 in dev). The ticket key is preserved and shown correctly. Per spec guidance, cache misses do not block convergence when the key is preserved and the journey is coherent.

---

## Iteration 3 → Iteration 4 Progress

| Issue | Iteration 3 | Iteration 4 | Delta |
|-------|-------------|-------------|-------|
| F1: "still not fixed" intercepted by frustration | FAIL (Blocker) | **PASS** | Fixed — follow-up now fires first |
| F2: followUpTicketKey never populated | FAIL | **PASS** | Fixed — populated from opening message |
| F3: Summary shows "Listing ref" not "Related ticket" | FAIL | **PASS** | Fixed — "Related ticket" line visible |
| F4: Redundant ticket-ref prompt | FAIL | **PASS** | Fixed — asks "what still needs attention?" |
| F5: Account parsing "is Codex" | Minor | Not observed | Likely fixed or not triggered |

---

## Recommendation

**CONVERGED for this slice.**

All convergence criteria are met:
- ✓ The "still not fixed" referenced-ticket phrasing triggers the follow-up path
- ✓ The known ticket key flows through `followUpTicketKey` and appears as "Related ticket" in the summary
- ✓ The portal does not ask again for a ticket reference it already recognised
- ✓ No internal taxonomy leaks to the customer
- ✓ Previously protected portal behaviour remains stable
- ✓ Holdout scenarios pass

The remaining non-blocking gaps (dual listing ref display, Jira hydration in dev) are polish items for future work, not continuity model defects.
