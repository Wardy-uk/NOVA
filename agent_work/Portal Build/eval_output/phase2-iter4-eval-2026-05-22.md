# Phase 2 Iteration 4 — Behavioural Evaluation
**Date:** 2026-05-22
**Evaluator:** Eval Agent (API-driven, no source inspection)
**Focus:** Conversational clarification → summary reliability

---

## Journeys Tested

### Journey 1 — Bulk email error (Session 389)
- **Opening:** Free-text report of bulk email error with red banner
- **Clarification:** System asked for account → URL → error message (3 sequential questions, all relevant)
- **Ticket offer:** System offered ticket creation alongside third clarification
- **Acceptance:** Customer said "Yes please, go ahead and create the ticket"
- **Result:** System ignored acceptance. Asked another clarification ("did the agent see any other details or codes"). Customer said "No, please just create the ticket now." System asked yet another question and re-offered ticket creation.
- **Outcome:** STUCK in `detail` stage. Ticket acceptance ignored. Repetitive clarification continued after customer answered.

### Journey 2 — Login issue (Session 390)
- **Opening:** Detailed report: login page at bryson-partners.kato.agency spinning forever, Bryson Partners account
- **Clarification:** System misclassified as `change` intent (should be `problem`). Asked "is something not displaying correctly, or do you need content updated?" — wrong direction
- **Re-asking:** After customer clarified login problem and provided account/username, system re-asked "Could you please provide the exact account name or ID" despite it being stated twice
- **Ticket offer:** System offered ticket creation at message 3
- **Acceptance:** Customer said "Yes, please create the ticket." → System responded: "I'm having trouble processing your request right now. Would you like me to create a support ticket..."
- **Loop:** Second acceptance produced identical error-and-re-offer
- **Outcome:** ERROR LOOP. `detail` stage never progressed. Intent misclassified. Account re-asked after provided.

### Journey 3 — 500 error, everything upfront (Session 391)
- **Opening:** Customer provided account, URL, error, and ticket request all in first message
- **Clarification:** System asked one question (browser) — reasonable
- **Summary:** After browser answer + push for ticket, system produced a `summary_card` with correctly extracted fields (subject, account, URL, error, browser, category)
- **Confirmation:** Customer said "That looks correct, please go ahead and submit it." → System re-displayed the summary with the confirmation text appended to the description field
- **Confirm endpoint:** Direct call to `POST /sessions/:id/confirm` returned: `"We couldn't create your ticket right now. Please try again, or contact us directly at support@nurtur.tech."`
- **Outcome:** REACHED SUMMARY but could not progress past it. Confirmation via chat re-displayed summary. Confirmation via API endpoint failed with error.

### Journey 4 — Email campaign images (Session 392)
- **Opening:** Vague "question about email campaigns"
- **Clarification:** Natural follow-up asking for more detail — appropriate
- **Routing:** Correctly hidden from customer. Category set to `website` after detail provided
- **Ticket offer:** System offered at message 3
- **Acceptance:** "Yes please, create the ticket" → "I'm having trouble processing your request right now. Would you like me to create a support ticket..."
- **Outcome:** ERROR LOOP on acceptance. Same pattern as Journey 2.

---

## Behavioural Questions — Answers

### 1. Does the system now provide a working path from late clarification into summary?
**Partially.** Journey 3 demonstrated that summary can be reached when the customer provides substantial detail upfront (account, URL, error) and answers one clarifying question. However, journeys with more conversational exchange (1, 2, 4) failed to reach summary at all — the system stayed stuck in `detail` stage, cycling through clarification.

### 2. When the customer accepts ticket creation, does the journey progress instead of re-offering in a loop?
**No.** In 3 of 4 journeys, accepting the ticket creation offer produced either:
- Continued clarification as if acceptance was not heard (Journey 1)
- An error message ("I'm having trouble processing your request") followed by a re-offer of the same thing (Journeys 2 and 4)

Even Journey 3, which reached summary, could not complete ticket creation — the confirm endpoint returned a server error.

### 3. Does the system still get stuck re-asking for account/context after the customer has already answered?
**Yes.** Journey 1 continued asking error-related questions after the customer answered. Journey 2 re-asked for account name/ID three times despite the customer providing it in their opening message and twice more in follow-ups.

### 4. Were any earlier Phase 2 conversational gains lost while restoring progression?
**Conversational gains remain largely intact:**
- Natural language responses (no exposed form fields or category pickers)
- Hidden routing (category/subcategory set in metadata, not shown to customer)
- Conversational tone maintained throughout
- Intent classification works for clear problem reports (Journeys 1, 3)
- Relevant clarifying questions (URL, browser, error message) asked naturally

**One regression noted:** Journey 2's intent was misclassified as `change` when the customer described a clear login problem. This suggests the intent classifier can still be confused by website-related issues.

---

## Summary of Findings

| Aspect | Status |
|--------|--------|
| Conversational activation | Intact |
| Natural clarification questions | Intact |
| Hidden routing | Intact |
| Reaching summary from short journeys | Works (Journey 3) |
| Reaching summary from longer journeys | Fails (Journeys 1, 2, 4) |
| Ticket-creation acceptance progression | Broken — error loop or ignored |
| Repetitive clarification after answering | Still occurs |
| Confirm endpoint (ticket creation) | Server error on all attempts |

---

## Convergence Assessment

**Not yet converged.**

The tested slice — reliable path from conversational clarification into summary — works only in a narrow scenario (substantial upfront detail, minimal clarification). The more common conversational path (iterative clarification over 3+ messages) does not reach summary. Ticket-creation acceptance is broken at both the chat level (acceptance ignored or error loop) and the API level (confirm endpoint returns server error). Earlier conversational continuity gains (natural language, hidden routing, tone) remain intact, but the core progression from clarification → summary → ticket creation is not yet reliable.

**Blocking issues for convergence:**
1. Chat-level acceptance of ticket creation is not wired to actually progress the stage
2. The confirm endpoint fails with a generic error (likely a downstream Jira or validation issue)
3. Longer conversational journeys get stuck in `detail` stage with repetitive clarification
