# Phase 2 Iteration 6 — Behavioural Evaluation

**Date:** 2026-05-22  
**Evaluator:** Eval Agent  
**Slice:** Conversational Intake Continuity — Multi-turn progression through to ticket creation

---

## Journeys Tested

| # | Scenario | Turns | Reached Summary? | Ticket Created? |
|---|----------|-------|-------------------|-----------------|
| 1 | Multi-turn website issue, details spread across turns | 5 | No (stuck in detail) | No |
| 2 | Rich opening message with all details upfront | 4 | No (stuck in detail) | No |
| 3 | Account access / email login issue | 3 | Yes (turn 2) | No — confirm fails with 500 |
| 4 | Email campaign delivery problem | 3 | Yes (turn 2) | No — confirm fails with 500 |
| 5 | Conversational activation, vague opening, gradual detail | 4 | No (stuck in detail) | No |

Additionally tested the **direct confirm endpoint** (`POST /sessions/{id}/confirm`) on sessions 401 and 402 — both returned HTTP 500: *"We couldn't create your ticket right now."*

---

## Findings by Evaluation Question

### 1. Do longer multi-turn journeys escape the repetitive clarification trap and reach summary?

**Partially.** Journeys 3 and 4 reached summary after 2 turns each — these were relatively straightforward paths. However, Journeys 1, 2, and 5 stalled in the detail stage. The common failure pattern:

- **Website/Listings category** triggers property-specific questions (property address, listing ID) that the system refuses to abandon even when the customer explicitly says no specific property is involved.
- Journey 5: customer said "It's not one specific property" and "the search function on our whole site isn't working" — the system responded by asking for "specific property addresses or references" a third time.
- Journey 2: customer described a contact page 500 error (not property-related) but the system still asked about "which property is affected."

The repetitive clarification trap remains active for the Website/Listings category when the issue is site-wide rather than property-specific.

### 2. When the system offers to create a ticket before summary, does acceptance progress the journey?

**No.** This is a consistent blocker. Across Journeys 1, 2, and 5, the system offered "Would you like me to create a ticket so a team member can assist directly?" during detail stage. When the customer accepted:
- Journey 1 Turn 4: "Yes please, go ahead and create a ticket" → "I'm having trouble processing your request right now"
- Journey 2 Turn 4: "Yes, please create a ticket" → same fallback
- Journey 5 Turn 4: "Yes, create a ticket please" → same fallback

Every detail-stage ticket-offer acceptance resulted in the generic error fallback. The session stage remained `detail` after each attempt — the acceptance was not recognised as a progression trigger.

### 3. Once summary is reached, can the system successfully create the ticket?

**No.** This is the most critical remaining blocker. Both paths to ticket creation fail:

- **Chat confirmation:** Journey 3 confirmed with "Yes, that looks correct. Please submit it." and Journey 4 with "Yes, that's correct. Please submit." — both returned the "I'm having trouble processing" fallback. Session stage remained `summary`.
- **Direct confirm endpoint:** `POST /sessions/{id}/confirm` with explicit fields returned HTTP 500: `"We couldn't create your ticket right now. Please try again, or contact us directly at support@nurtur.tech."`

The Jira ticket creation path is broken regardless of how it's triggered. The portal settings show only `portal_enabled` and `portal_codex_test_user_enabled` — no portal-specific Jira project configuration was found, though the main `jira_sd_project=NT` setting exists.

### 4. Were earlier Phase 2 conversational gains lost?

**Mostly preserved.** The following Phase 2 behaviours remain intact:
- **Conversational activation:** Vague openings ("hey, something's not working right") are handled naturally without forcing category selection (Journey 5).
- **Hidden routing:** Categories are assigned silently without presenting picker UI (all journeys showed category assignment in metadata without exposing it to the customer).
- **Natural clarification:** The system asks follow-up questions conversationally rather than presenting forms.
- **Summary wording:** Summaries use clear formatting with bold labels (Journeys 3, 4).

One regression observed:
- **Account field extraction** is inconsistent. Journey 4 correctly extracted "Premier Homes" from "the account 'Premier Homes'", but Journey 3 failed to extract "Jones Lettings" from "My account is Jones Lettings", and Journey 5 failed to extract "Greenfield Realty" from "We're Greenfield Realty."

### 5. Field extraction from customer messages

**Weak.** Journey 2 provided account, URL, error message, browser, and OS in a single message — none were extracted into structured fields except `description` (raw text) and `affectedPortals` ("Website"). The extraction pipeline does not reliably parse structured data from natural language.

Journey 3's account field was corrupted: "Jones Lettings and I'm getting 'invalid" — the parser grabbed text past the actual account name.

---

## Additional Observations

- **Vocabulary quality:** The system never used technical jargon (no "API", "integration", "feed" etc.) — the vocabulary firewall appears effective.
- **Session metadata:** The `metadata` field on individual message responses is consistently empty/null, though session-level metadata is populated correctly. This may affect client-side rendering.
- **Category-inappropriate questions:** The Website category's detail-stage prompt appears to always ask about property addresses, even for issues clearly unrelated to specific properties (contact page errors, search functionality). This creates the repetitive loop.

---

## Convergence Assessment

**Not yet converged.**

Three blockers remain before this slice can be considered converged:

1. **Ticket creation fails 100% of the time** — both via chat confirmation at summary stage and via the direct `/confirm` endpoint. This is the highest-priority blocker. The error suggests a downstream Jira integration failure rather than a conversation flow issue.

2. **Detail-stage ticket-offer acceptance is ignored** — when the system offers "Would you like me to create a ticket?" and the customer accepts, the system hits the same processing error. Even if this is the same root cause as (1), the acceptance should at minimum progress to summary before attempting creation.

3. **Repetitive clarification in Website/Listings category** — the detail stage asks about property addresses even when the customer has explicitly stated the issue is site-wide. The system does not accept "no specific property" as a valid answer and re-asks.

Field extraction quality (account names, error messages, URLs from natural language) is a secondary concern — it doesn't block progression but does degrade the summary quality when it works.

---

## Recommended Priority for Next Iteration

1. Fix Jira ticket creation (likely missing portal-specific Jira config or a service-layer error)
2. Make detail-stage ticket-offer acceptance progress to summary or direct creation
3. Allow Website/Listings detail collection to proceed without mandatory property-specific fields
4. Improve field extraction from multi-turn conversation context
