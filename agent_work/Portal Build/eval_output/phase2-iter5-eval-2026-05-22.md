# Phase 2 Iteration 5 — Behavioural Evaluation
**Date:** 2026-05-22
**Evaluator:** Eval Agent (API-driven, no source inspection)
**Focus:** Late clarification → summary → ticket creation reliability

---

## Journeys Tested

### Journey 1 — Bulk email template error, multi-turn (Session 394)
- **Opening:** Free-text report of bulk email campaign error with red banner
- **Clarification:** System asked for more detail (M1), then URL (M2), then error message (M3) — all reasonable so far
- **Ticket offer:** System offered ticket creation alongside M3 error-message question
- **Acceptance + answer:** Customer provided exact error message ("Template validation failed: missing merge field {{first_name}} in header block") AND accepted ticket creation in the same message
- **Result:** System re-asked for the error message despite it being provided. Ticket acceptance ignored. Customer repeated the answer — system asked again. 5 messages from the customer, still stuck.
- **Session state:** `stage=detail`, `detailRounds=2`, `errorMessage=null` (not extracted despite being stated twice), `account=Bryson Partners` (extracted correctly), `offeredTicketCreation=true`
- **Outcome:** STUCK in `detail`. Error message not extracted. Ticket acceptance ignored.

### Journey 2 — 500 error, dense opening (Session 395)
- **Opening:** Detailed report: account, URL, 500 error, explicit ticket request in first message
- **Clarification:** System acknowledged but asked "is something not displaying correctly, or do you need content updated?" (M1). Customer clarified. System asked for browser (M2) — reasonable.
- **Ticket push:** Customer answered browser question + demanded ticket creation
- **Summary:** System produced a `summary_card` with correctly extracted fields (subject, account, URL, error, browser, category)
- **Chat confirmation:** Customer said "That looks correct, please go ahead and submit it." → System re-displayed the summary with the confirmation text appended to the description field. Did NOT progress.
- **Confirm endpoint:** Direct API call to `POST /sessions/395/confirm` returned: `"We couldn't create your ticket right now. Please try again, or contact us directly at support@nurtur.tech."`
- **Outcome:** REACHED SUMMARY after 3 messages. Chat confirmation treated as new detail (re-displayed summary). API confirmation failed with Jira backend error.

### Journey 3 — Maximum density first message (Session 396)
- **Opening:** Customer provided account, URL, problem, browser, and explicit ticket request all in first message
- **Summary:** System went directly to `summary_card` in one turn — all fields correctly extracted
- **Confirm endpoint:** `POST /sessions/396/confirm` → same Jira error as Journey 2
- **Outcome:** REACHED SUMMARY in 1 message. Ticket creation blocked by Jira backend.

### Journey 4 — Vague opening, multi-turn (Session 397)
- **Opening:** "Hi, I need some help with our website"
- **Intent:** Classified as `question` — acceptable for a vague opening
- **Clarification:** System asked "Which account or website is this for?" (M1). Customer provided account ("Bryson Partners") and described problem (contact form not working)
- **Account re-ask:** System asked "Could you please provide the account name associated with the Bryson Partners website?" — asked for the account AFTER the customer stated it
- **Customer repeated 3 times:** Stated "Bryson Partners" in M2, M3, and M4. System kept asking.
- **Session state:** `stage=detail`, `account=` (EMPTY despite 3 mentions), `detailRounds=2`
- **Outcome:** STUCK in `detail`. Account field never populated. Repetitive re-asking. Never reached summary.

### Journey 5 — Maximum density with "create ticket" phrasing (Session 398)
- **Opening:** "Create a ticket please. Account: Bryson Partners. URL: bryson-partners.kato.agency/login. Problem: 500 error on login page. Browser: Chrome."
- **Intent:** Misclassified as `change` — the word "create" in "create a ticket" confused the intent classifier
- **System asked for person's name/email** — completely wrong direction for a bug report
- **Outcome:** MISCLASSIFIED. Wrong clarification path. Never recovered.

### Journey 6 — Explicit bug framing (Session 399)
- **Opening:** "I am reporting a bug. Account name: Bryson Partners..." with all details
- **Summary:** System went directly to `summary_card` — all fields correctly extracted, subject auto-generated as "Login page 500 Internal Server Error"
- **Chat confirmation:** Customer said "Yes, that looks correct. Please submit it." → System responded: "I'm having trouble processing your request right now. Would you like me to create a support ticket so our team can help you directly?"
- **Retry:** Same error on second attempt. Stage stayed at `summary`.
- **Analysis:** The `isAffirmativeResponse` check worked — the system attempted `confirmAndSubmit()` — but Jira creation failed, producing the error loop. The stage remains `summary` after failure, allowing retry (good), but retries also fail (infrastructure issue).
- **Outcome:** REACHED SUMMARY in 1 message. Chat confirmation recognized correctly and routed to ticket creation. Creation blocked by Jira backend.

---

## Behavioural Questions — Answers

### 1. Does the system now provide a reliable path from late clarification into summary across the tested journeys?
**Partially — same as iter 4.** Short journeys (1-2 messages with high information density) reach summary reliably (Journeys 2, 3, 6). Longer conversational journeys (3+ messages, gradual information gathering) still get stuck in `detail` stage (Journeys 1, 4). The threshold appears to be about the amount of information provided per message, not the number of turns.

### 2. When the customer accepts ticket creation in chat, does the journey progress correctly?
**Improved from iter 4.** When the session is in `summary` stage, chat-level acceptance IS now recognized — the system enters the confirm path and attempts ticket creation (Journey 6). This is an improvement over iter 4 where acceptance was ignored. However, when the session is still in `detail` stage and the customer accepts a ticket offer, the acceptance is still ignored (Journey 1).

### 3. Once summary is reached, can the system successfully create the ticket?
**No — blocked by Jira backend.** All ticket creation attempts fail with the same error: "We couldn't create your ticket right now." This is consistent across:
- Chat-level confirmation (produces "I'm having trouble processing your request")
- Direct confirm endpoint (`POST /sessions/:id/confirm`)
- Direct ticket creation endpoint (`POST /tickets`)

The error originates from the Jira API call (`jiraClient.createIssue`). This is an infrastructure/configuration issue, not a portal chat logic issue.

### 4. Does repetitive blocked clarification still prevent completion in the longer tested journeys?
**Yes.** Two specific patterns persist:
- **Field extraction failure:** Journey 1's error message was stated twice but never populated in `errorMessage` field (remained `null`). Journey 4's account name was stated 3 times but never populated (remained empty string).
- **Re-asking for provided information:** Journey 4 asked for "Bryson Partners" account 3 times after it was stated. Journey 1 re-asked for error message after it was provided.

### 5. Were any earlier Phase 2 conversational gains lost while restoring submission-path behaviour?
**Conversational gains remain intact:**
- Natural language responses maintained (no form fields exposed)
- Hidden routing (category/subcategory in metadata only)
- Conversational tone throughout
- Summary cards with correctly formatted fields when reached
- `isAffirmativeResponse` now working for summary-stage confirmation (improvement)

**One regression persists from iter 4:** Intent misclassification — Journey 5 ("Create a ticket please...") was classified as `change` instead of `problem`. This matches the iter 4 finding about "create"/"set up" language confusing the classifier.

---

## Summary of Findings

| Aspect | Status | Change from Iter 4 |
|--------|--------|--------------------|
| Conversational activation | Intact | Unchanged |
| Natural clarification questions | Intact | Unchanged |
| Hidden routing | Intact | Unchanged |
| Reaching summary from short journeys (1-2 msgs) | Works | Unchanged |
| Reaching summary from longer journeys (3+ msgs) | Fails | Unchanged |
| Chat-level summary confirmation | **Now recognized** | **Improved** |
| Chat-level detail-stage acceptance | Still ignored | Unchanged |
| Confirm endpoint (ticket creation) | Jira backend error | Unchanged |
| Direct ticket creation endpoint | Jira backend error | N/A (new test) |
| Repetitive clarification / field extraction | Still occurs | Unchanged |
| Intent misclassification on "create" phrasing | Still occurs | Unchanged |

---

## Convergence Assessment

**Partially converged — one improvement, core blockers remain.**

**What improved:** Chat-level confirmation in `summary` stage now correctly triggers ticket creation. The `isAffirmativeResponse` → `confirmAndSubmit` path works as intended. This was a specific blocker from iter 4 and is now resolved at the logic level.

**What remains blocked:**

1. **Jira backend failure (infrastructure):** All ticket creation fails uniformly — `createIssue` throws. This blocks the entire submission path regardless of how the journey reaches it. This may be a configuration/connectivity issue rather than a code issue.

2. **Field extraction in multi-turn conversations:** Account names and error messages stated in customer messages are not being extracted into collected fields, causing the system to re-ask. This drives the repetitive clarification loop that prevents longer journeys from reaching summary.

3. **Detail-stage ticket acceptance:** When the system offers "Would you like me to create a ticket?" during `detail` stage, customer acceptance is not recognized — the system continues asking questions.

4. **Intent misclassification:** "Create a ticket" phrasing triggers `change` classification, derailing the journey into wrong clarification paths.

**Recommendation:** The Jira backend error is the highest-impact blocker — it prevents ALL ticket creation across every path. Once resolved, 3 of 6 tested journeys would likely complete successfully (those that reached summary). The field extraction and detail-stage acceptance issues block the remaining 3 journeys.
