# Evaluation Report — Iteration 3: Reopened / Follow-Up Ticket Continuity Hardening

**Date:** 2026-05-24  
**Evaluator:** Eval Agent  
**Slice:** Reopened / follow-up ticket continuity  
**Overall Verdict:** NOT CONVERGED — one primary blocker remains

---

## Summary

Iteration 3 expanded follow-up detection patterns and several new phrasings now correctly trigger the follow-up continuity path ("marked resolved but not", "not actually fixed", "same issue again", "problem is back"). However, **"still not fixed"** — the single most common real-world follow-up phrasing — continues to be intercepted by the frustration-offer path before reaching follow-up detection. Jira ticket hydration does not populate `followUpTicketKey`/`followUpTicketSummary` at runtime, and the ticket reference is stored in `listingId` causing the summary card to display "Listing ref" instead of "Related ticket".

---

## Checks Passed

| # | Check | Result |
|---|-------|--------|
| 1 | "marked resolved but it is not" + ticket ref triggers follow-up path | PASS — previously blocker F2, now correctly routes to `category: followup`, `subcategory: followup_not_resolved` |
| 2 | New patterns activate correctly: "not actually fixed", "same issue again", "problem is back" | PASS — all three new pattern families route to followup |
| 3 | Previously passing patterns still work: "chasing", "following up", "still waiting" | PASS — no regression from iteration 2 |
| 4 | Follow-up path collects detail, builds summary, reaches submission stage | PASS — coherent multi-turn journey through detail → summary |
| 5 | No taxonomy leaks to customer | PASS — no internal category names, subcategory codes, confidence language, or routing jargon visible in any response |
| 6 | Normal new-request paths unaffected | PASS — website/property category intake works correctly ("500 error on contact page" → `website_broken`) |
| 7 | Conversational tone remains appropriate and customer-safe | PASS — wording is natural, empathetic, forward-moving ("I can see you've been in touch about this before — sorry it's not been resolved yet") |
| 8 | Follow-up without ticket ref in first message correctly detected | PASS — "I'm following up on an issue that was supposed to be fixed" → `category: followup` |
| 9 | Summary subject reflects follow-up context | PASS — subject includes "[Portal] Issue not fully resolved — ..." |
| 10 | Request type label is customer-appropriate | PASS — shows "Issue not fully resolved" rather than internal subcategory |

## Checks Failed

| # | Check | Result | Severity |
|---|-------|--------|----------|
| F1 | "still not fixed" + ticket ref does not trigger follow-up path | FAIL | **Blocker** — tested 3 variants ("NT-18592 is still not fixed", "Ticket NT-18592 still not fixed", "Still not fixed - NT-18592"); all consistently route to frustration-offer with `category: null`, `offeredTicketCreation: true`. Build status claims this "already matched" but frustration detection intercepts it before follow-up patterns can fire. |
| F2 | `followUpTicketKey` and `followUpTicketSummary` never populated | FAIL | **Significant** — tested across multiple sessions including full journey to summary stage. Both fields remain empty. Ticket reference stored in `listingId` instead. |
| F3 | Summary card shows "Listing ref" instead of "Related ticket" | FAIL | **Moderate** — follows from F2. The client-side "Related ticket" row (described in build status) is not visible because `followUpTicketKey` is never populated. |
| F4 | Portal asks for ticket reference that customer already provided | FAIL | **Moderate** — when follow-up path activates with a ticket ref in the message (e.g., "Following up on NT-18592"), the response asks "Could you let me know the ticket reference?" — redundant and erodes trust. |
| F5 | Account field includes parsing artefact | FAIL | **Minor** — account captured as "is Codex Property Solutions" instead of "Codex Property Solutions" (leading "is " from sentence parsing). |

---

## Confirmed Behaviours

- The `followup` category and `followup_not_resolved` subcategory exist and activate for an expanded (but still incomplete) set of chase-language patterns
- The continuation path successfully collects detail, synthesises subject/description, and reaches the summary stage with appropriate follow-up framing
- No internal taxonomy, confidence language, or routing jargon is visible to the customer at any point
- Normal intake flows (website, property) continue to work without regression
- Frustration detection remains active and its interaction with follow-up detection is the root cause of F1

---

## Blockers

1. **"Still not fixed" does not trigger follow-up (F1):** The exact phrasing "still not fixed" plus ticket reference — the most natural, most likely real-world follow-up — consistently hits the frustration-offer path. All three variants tested produce identical results: `category: null`, `offeredTicketCreation: true`, response starting "I understand this is frustrating...". The build status states this "already matched" the chase patterns, suggesting the pattern exists but is evaluated AFTER frustration detection intercepts the message. The iteration 3 reordering fix (F5 above H2) moved follow-up detection above domain-signal handlers but apparently NOT above frustration detection.

---

## Non-Blocking Gaps

- **F2/F3 — Jira hydration and "Related ticket" display:** `followUpTicketKey` and `followUpTicketSummary` are never populated at runtime. This may be partially environmental (the dev `jira_issue_cache` may not contain test ticket NT-18592), but even structurally the ticket reference flows into `listingId` rather than the follow-up metadata fields. When/if hydration does find a match, the summary card would need to render "Related ticket" from these fields, not "Listing ref" from `listingId`. This is significant but does not independently block convergence if F1 is fixed — the follow-up path is still coherent without hydrated context, just less efficient.

- **F4 — Redundant ticket-ref prompt:** The portal asks "Could you let me know the ticket reference?" even when the customer's message already contains "NT-18592". This creates unnecessary friction but is a UX polish issue, not a convergence blocker.

- **F5 — Account parsing:** "is Codex Property Solutions" instead of "Codex Property Solutions". Minor LLM extraction artefact.

- **H2 holdout — "Any update on NT-18592?":** Routes to `other_general`. A pure status check without chase language is arguably outside this slice's scope (the eval standard focuses on continuation/action follow-ups, not passive status lookups).

- **Category priority conflict with operational detail:** "Chasing NT-18592, the issue came back on 20th May and 3 of our agents can't upload photos now" routes to `property/property_media` instead of `followup`. Domain-specific keywords in the detail override follow-up intent. Same as iteration 2 F7 — edge case for later.

- **Jira link-type selection:** Cannot be evaluated in dev (Jira ticket creation fails environment-wide). Logged as a non-blocking follow-on item per manager handoff guidance.

---

## Holdout Scenario Results

| ID | Scenario | Result | Notes |
|----|----------|--------|-------|
| H1 | Valid ticket + "still not fixed" | **FAIL** | Goes to frustration-offer, not follow-up |
| H2 | Short chasing question ("Any update?") | **FAIL** (not required for convergence) | Routes to `other_general` — outside primary slice scope |
| H3 | Ticket ref + new detail changing situation | **PARTIAL PASS** | Works when follow-up keywords present ("Following up on NT-18592 - images issue also affecting floor plans"); fails when detail keywords dominate ("agents can't upload photos") |

## Edge Input Results

| Input | Result |
|-------|--------|
| Ticket ref + "still waiting" | PASS — followup |
| Ticket ref + "marked resolved but not" | PASS — followup |
| Ticket ref + fresh operational detail (dates, affected page) with "chasing" | FAIL — property_media overrides followup |
| Ticket ref + fresh operational detail with "following up" | PASS — followup |

---

## Iteration 2 → Iteration 3 Progress

| Issue | Iteration 2 | Iteration 3 | Delta |
|-------|-------------|-------------|-------|
| F1: "still not fixed" | FAIL | FAIL | **No change** — still intercepted by frustration path |
| F2: "marked resolved but not" | FAIL | PASS | **Fixed** |
| F3: Jira ticket lookup | FAIL | FAIL | No change — followUpTicketKey never populated |
| F4: followUpTicketKey/Summary fields | FAIL | FAIL | No change |
| F5: Summary "Related ticket" line | FAIL | FAIL | Client code reportedly added but never triggered |
| F6: Ticket ref in listingId | FAIL | FAIL | No change |
| F7: Category priority conflict | FAIL | Mixed | Some variants now pass when explicit follow-up keywords present |

---

## Recommendation

**One more small build slice required**, focused narrowly on:

1. **Move follow-up/chase pattern detection ABOVE frustration detection** (or exempt messages matching chase patterns from frustration-offer). This is the single remaining blocker. The pattern "still not fixed" exists in `ESCALATION_CHASE_PATTERNS` but the frustration handler fires first and intercepts the message. The iteration 3 fix reordered F5 above H2 (domain handlers) but not above the frustration handler.

2. **Populate `followUpTicketKey` from the ticket reference extracted in the opening message.** Even if `jira_issue_cache` doesn't contain the ticket, the key itself should flow into `followUpTicketKey` (not `listingId`) so the summary card displays "Related ticket: NT-18592" rather than "Listing ref: NT-18592". The summary hydration would be a bonus if cache data exists, but the field mapping is the core fix.

3. **Suppress the redundant ticket-ref prompt** when a ticket reference was already provided in the customer's message. This is polish but directly supports the "reduce unnecessary repetition" outcome.

Item 1 is required for convergence. Items 2 and 3 are strongly recommended.
