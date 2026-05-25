# Phase 2 Iteration 3 — Conversational Intake Continuity Evaluation

**Date:** 2026-05-22  
**Evaluator:** Eval Agent (API-level behavioural testing)  
**Server:** localhost:3001, authenticated via codex-test-login (Codex Test Organisation)  
**Sessions tested:** 385, 386, 387, 388

---

## Journeys Tested

Four distinct conversational intake journeys were executed via the portal chat API:

1. **Session 385 — Website content change (phone number update):** Free-text initial request → clarification about account → account provided → re-asked for account → accepted ticket creation → error loop
2. **Session 386 — Website content change (detailed upfront):** Rich initial message with account name, account number, URL, specific change details → still asked "Which account or website is this for?" → provided account again → asked for URL → provided URL → re-asked for URL → accepted ticket creation → error loop
3. **Session 387 — Account login issue:** Login problem report with account details → clarification about account → answered "Acme Estates" → re-asked for account → accepted ticket creation → error loop
4. **Session 388 — How-to question (adding property listings):** General process question → asked about specific property → clarified it's general → asked for property address → accepted ticket creation → error loop

All four sessions followed the same terminal pattern and none reached the summary stage.

---

## Behavioural Findings

### 1. Summary Subject — Cannot Evaluate (Stage Not Reached)

No session progressed past the `detail` stage to `summary`. The system never generated a summary card, so it is **not possible to evaluate whether the customer-visible summary subject exposes internal taxonomy**. This question remains untestable in the current build.

### 2. Natural-Language Confirmation — Blocked by Upstream Failure

The system offers ticket creation ("Would you like me to create a ticket so a team member can assist directly?") but when the customer responds affirmatively with any of:
- "Yes please, create a ticket for me"
- "Yes, please create a ticket. The account name is Acme Estates."
- "Yes"

The system responds with: **"I'm having trouble processing your request right now. Would you like me to create a support ticket so our team can help you directly?"**

This creates an infinite re-offer loop. The affirmative response is not understood as confirmation — it triggers what appears to be a fallback error path that re-offers the same action.

### 3. Summary-to-Submission Coherence — Cannot Evaluate

Since no session reached `summary`, the summary-to-submission transition cannot be evaluated.

### 4. Clarification-Stage Continuity — Partially Intact but Degraded

The initial conversational exchange works:
- Free-text messages are accepted and the system responds conversationally
- Intent classification works (change, problem detected correctly)
- Category and subcategory are derived from context (website/website_content, account/account_login, property)
- Some fields are extracted (urgency upgraded to High when "urgent" mentioned, URL extracted in session 387)

However, the **account field extraction is unreliable**:
- Session 385: Account name provided twice in free text — only populated after third explicit attempt ("Acme Estates - account AC12345")
- Session 386: Account name + number provided in initial message — never populated
- Session 387: Account name provided explicitly — never populated
- Session 388: Account name provided — populated successfully on second attempt

The system asks for the account repeatedly even when it has been stated, suggesting the LLM field-extraction prompt is not reliably recognising account information from conversational context.

### 5. Detail-Stage Looping

After 2-3 clarification exchanges where the system fails to extract a required field, it offers ticket creation. This offer is a dead end — accepting it always produces the "having trouble processing" error and re-offers. The session remains stuck at `detail` stage indefinitely.

The `offeredTicketCreation` flag is set to `true` in metadata, but the code path that should handle the customer's acceptance and progress to summary/confirmation appears to be broken or missing.

---

## Observations on Earlier Phase 2 Gains

| Earlier Gain | Status |
|---|---|
| Conversational mode activates on free-text input | **Intact** — `conversational: true` in metadata |
| Intent classification from natural language | **Intact** — change, problem correctly detected |
| Category/subcategory derived without explicit picker | **Intact** — derived contextually |
| Customer-facing assistant tone | **Intact** — conversational, no jargon in responses |
| Clarification questions feel natural | **Partially intact** — natural tone but repetitive when field extraction fails |

---

## Convergence Assessment

**Not Converged**

The completion-stage continuity target for this iteration is unreachable because:

1. **The conversation cannot exit the detail stage.** No combination of customer responses — including explicit acceptance of the ticket creation offer — advances the session to `summary` or `confirmed`.
2. **The ticket-creation acceptance path is broken.** When `offeredTicketCreation` is true and the customer says "yes", the system falls into an error-and-re-offer loop rather than generating a summary card.
3. **Field extraction reliability prevents natural progression.** Even when the customer provides all requested information, the account field frequently remains null, preventing the system from determining that enough detail has been collected.

### Blocking Issues (Priority Order)

1. **Critical:** Accepting the ticket creation offer does not progress the session — the "yes" → summary transition is broken
2. **Critical:** No path from `detail` stage to `summary` stage is functional in conversational mode
3. **High:** Account field extraction from conversational text is unreliable (works ~25% of the time)
4. **Cannot assess:** Summary subject taxonomy exposure and typed confirmation → submission — both blocked by inability to reach summary stage

### Recommendation

The next iteration must fix the detail → summary transition before the summary-subject and confirmation-to-submission questions can be evaluated. The ticket-creation acceptance handler is the most direct path — when `offeredTicketCreation` is true and the customer responds affirmatively, the system should generate a summary card and advance to the `summary` stage.
