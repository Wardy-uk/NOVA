# Evaluation Report — Iteration 2: Reopened / Follow-Up Ticket Continuity

**Date:** 2026-05-24  
**Evaluator:** Eval Agent  
**Slice:** Reopened / follow-up ticket continuity  
**Overall Verdict:** NOT CONVERGED — one more small build slice required

---

## Summary

The follow-up continuation path exists and works for some input patterns, but fails to activate for the most common real-world follow-up phrasings. When it does activate, key context-preservation features described in the build status (Jira lookup, ticket summary acknowledgement, follow-up metadata fields, related-ticket line in summary card) are absent at runtime. The path is partially wired but not behaviourally complete.

---

## Checks Passed

| # | Check | Result |
|---|-------|--------|
| 1 | Follow-up category activates for some recognised chase language | PASS — "chasing", "still waiting", "following up" + ticket ref triggers `category: followup`, `subcategory: followup_not_resolved` |
| 2 | Portal moves customer forward (not dead-end status display) | PASS — follow-up path asks for detail, collects account, generates summary, reaches submission stage |
| 3 | No taxonomy leaks to customer | PASS — no internal category names, subcategory codes, confidence language, or routing jargon visible in any response |
| 4 | Normal new-request paths unaffected | PASS — website category intake works as expected without regression |
| 5 | Jira submission failure is environment-wide, not follow-up specific | PASS (neutral) — all Jira ticket creation fails in dev; cannot evaluate Jira linking but this is not a follow-up regression |
| 6 | Conversational tone remains appropriate and customer-safe | PASS — wording is natural, empathetic, forward-moving |

## Checks Failed

| # | Check | Result | Severity |
|---|-------|--------|----------|
| F1 | "still not fixed" + ticket ref does not trigger follow-up path | FAIL | **Blocker** — this is the most likely real-world follow-up phrasing; it consistently drops into frustration-offer instead of follow-up continuity |
| F2 | "marked resolved but it is not" + ticket ref does not trigger follow-up path | FAIL | **Blocker** — explicitly says the ticket was closed prematurely; goes to `other_general` instead of `followup_reopen` |
| F3 | No Jira ticket lookup occurs on any follow-up path | FAIL | **Significant** — build status describes lookup of key, summary, and status; none observed at runtime. Response says "You are chasing NT-18592" with no ticket context |
| F4 | `followUpTicketKey` and `followUpTicketSummary` never populated in session metadata | FAIL | **Significant** — these fields exist in the type definition but are never set at runtime |
| F5 | Summary card shows no "Related ticket" line for follow-ups | FAIL | **Significant** — build status describes this; not observed. Instead shows "Listing ref: NT-18592" (misclassified as listing) |
| F6 | Ticket reference captured as `listingId` rather than follow-up ticket key | FAIL | **Moderate** — NT-18592 is stored in the wrong metadata field, which means it's treated as a property listing reference throughout the flow |
| F7 | Ticket ref + new operational detail routes to website category, not follow-up | FAIL | **Moderate** — when the customer adds detail about what changed, the category detection prioritises the detail over the follow-up intent ("500 error" → `website_broken`) |

---

## Confirmed Behaviours

- The `followup` category and `followup_not_resolved` subcategory DO exist and ARE activated for a subset of chase-language patterns
- The continuation path does collect detail, synthesise a subject/description, and reach the summary stage
- The portal does not leak internal taxonomy at any point tested
- Normal intake flows (website, property) continue to work correctly
- Frustration detection remains active (not regressed), though its interaction with follow-up detection creates a routing conflict

---

## Blockers

1. **Inconsistent follow-up detection (F1, F2):** The two most natural real-world follow-up phrasings — "still not fixed" and "marked resolved but it is not" — do not trigger the follow-up path. The first hits frustration detection; the second falls to `other_general`. A customer who says their issue isn't resolved should be the primary use case for this path, and it fails.

2. **No Jira ticket lookup at runtime (F3, F4):** The build status describes looking up the referenced ticket and acknowledging it by key, summary, and current status. This does not happen — the portal repeats the ticket reference from the customer's own message but adds no context from Jira. The `followUpTicketKey` and `followUpTicketSummary` metadata fields are never populated. Without this, the "reduce unnecessary repetition" outcome is not met.

---

## Non-Blocking Gaps

- **F5/F6 — Listing ID misclassification:** The ticket ref is captured as `listingId`, which causes the summary card to show "Listing ref" instead of "Related ticket". This is cosmetic when the follow-up path activates correctly but creates confusion in the customer-facing summary.

- **F7 — Category priority conflict:** When a follow-up message includes significant new detail (e.g. "500 error"), the category detection sometimes prioritises the new detail over the follow-up intent. This is an edge case that could be addressed in a later iteration.

- **Jira link type:** The build status notes uncertainty about link type ("Relates" vs "Blocks"). Since Jira creation doesn't work in dev, this cannot be evaluated. Logged as a non-blocking follow-on item — the choice of "Relates" for follow-ups is operationally sensible and does not compromise the customer-visible outcome.

- **Pure status check without chase language:** A message like "What's the status of NT-18592?" goes to `other_general` rather than performing a status lookup. This may be pre-existing behaviour outside the scope of this slice.

---

## Recommendation

**One more small build slice required**, focused on:

1. **Fix follow-up detection for "still not fixed" and "marked resolved but not" phrasings** — these must trigger the follow-up path instead of frustration-offer or other_general. This is the primary blocker.

2. **Wire the Jira ticket lookup** so that recognised follow-up references actually fetch and display the ticket summary/status, and populate `followUpTicketKey`/`followUpTicketSummary` in session metadata.

3. **Fix ticket-ref field mapping** — store the ticket reference in the follow-up metadata fields, not in `listingId`.

Items 1 and 2 are required for convergence. Item 3 is strongly recommended but could be deferred if needed.
