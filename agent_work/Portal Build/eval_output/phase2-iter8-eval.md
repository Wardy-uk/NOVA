# Phase 2 — Iteration 8 Evaluation

**Date:** 2026-05-22
**Evaluator:** Eval Agent (behavioural, API-driven)
**Sessions tested:** 416–425 (8 sessions, 10 journeys)

---

## Verdict: PARTIALLY CONVERGED

Property-question narrowing is substantially fixed. Submission end-state is improved (no more infinite re-offer loop), though ticket creation itself still fails due to configuration. Two regressions from earlier Phase 2 persist (premature summary for vague starts, summary-stage confirmation not triggering submission).

---

## Journeys Tested

| # | Scenario | Outcome |
|---|----------|---------|
| 1 | Property-specific website issue (wrong photos, 42 Elm St) | Reached summary in 2 turns ✓ — Jira submission failed ✗ — failure message clear ✓ |
| 1b | Re-attempt after failure (session 418) | Summary re-displayed with user's retry appended to description — no submission attempt ⚠ |
| 2 | Non-property issue (email campaign delivery) | Reached summary in 2 turns ✓ — No property question ✓ — Confirmation not recognised as submission trigger ✗ |
| 3 | Site-wide website issue (maintenance message, acmeprops.co.uk) | No property question ✓ — Reached ticket-offer in 4 turns ✓ — Failure message clean ✓ |
| 4 | Site-wide listings (all Rightmove listings missing, all branches) | No property question ✓ — Asked for account name twice despite it being provided ⚠ — Reached ticket-offer ✓ |
| 5 | Non-property CRM issue (add new user) | No property question ✓ — Reached summary in 3 turns ✓ — Extracted person email + office ✓ |
| 6 | Conversational continuity (greeting → vague → clarify) | Greeting handled ✓ — Jumped to summary after 2nd message with poor field extraction ✗ |
| 7 | Property-specific + summary edit (bedroom count, 15 Oak Lane) | Reached summary in 5 turns — Urgency edit applied ✓ — Property address edit ignored ⚠ — Failure end-state clean ✓ — Session marked complete after failure ✓ |
| 8 | Explicit site-wide + denial of property specificity | No property question ✓ — Account-name loop (asked 3 times despite being provided) ⚠ — Reached ticket-offer ✓ |

---

## Findings by Evaluation Question

### 1. Does the portal reach a usable end-state when submission is attempted?

**Improved — partially.** The submission failure path is now substantially better:

- **No more infinite re-offer loop.** In iter7, the system would fail → re-offer ticket → user accepts → fail again → re-offer, indefinitely. This is fixed.
- **Clear failure message.** After a failed submission, the system now says: "I wasn't able to create a ticket right now. Please contact us directly at **support@nurtur.tech**." This gives the user an actionable alternative.
- **Session completes after failure.** Subsequent messages after the failure receive "This conversation has already been completed. Start a new conversation if you need more help." This prevents dead-end loops.

**Still broken:** Actual ticket creation fails because `jira_ob_enabled=false`. This is environmental/configuration, not a behavioural defect — when Jira is enabled, submission should work. However, it cannot be verified behaviourally until Jira is configured.

**Summary-stage confirmation still broken:** When the system presents a summary card and the user says "Yes, that looks correct. Please submit" or "That looks right, please submit", the system does NOT treat this as a submission trigger. Instead, it appends the confirmation text to the description and re-displays the summary. The only working submission path appears to be the ticket-offer flow ("Would you like me to create a ticket?" → "Yes") or the explicit `/confirm` endpoint. This means the natural conversational confirmation at summary stage is not functioning.

**Severity:** Medium. The end-state is stable (no loops), but the confirmation-to-submission pathway at summary stage is broken, forcing users through an awkward ticket-offer detour or requiring client-side confirm button handling.

### 2. Do clearly non-property journeys escape property-address questioning?

**Yes — fixed.** This is a major improvement from iter7.

- **Test 2 (email campaign):** No property question. Reached summary in 2 turns.
- **Test 5 (add new user):** No property question. Reached summary in 3 turns. Correctly extracted person email and office/branch.
- **Test 6 (vague start → account issue):** No property question (though other issues present).

In iter7, all three of these scenarios triggered property-address questions. In iter8, none did.

### 3. Do explicitly site-wide journeys escape property-address questioning?

**Yes — fixed.** Another major improvement.

- **Test 3 (maintenance message, acmeprops.co.uk):** No property question. Asked appropriate account/detail questions.
- **Test 4 (all Rightmove listings missing):** No property question. System correctly noted "All properties (site-wide)" in its acknowledgement.
- **Test 8 (font changed, explicit "NOT property-specific"):** No property question. System acknowledged site-wide scope.

In iter7, all site-wide scenarios were stuck in a property-question loop. In iter8, none were. The system correctly distinguishes site-wide from property-specific issues.

### 4. Do concrete property-specific journeys still move efficiently?

**Yes — mostly preserved, with minor regressions.**

- **Test 1 (wrong photos, 42 Elm St):** Reached summary in 2 turns. Property address correctly extracted. Issue type correctly identified as "Incorrect property details".
- **Test 7 (wrong bedroom count, 15 Oak Lane):** Took 5 turns (2 more than expected) because the system insisted on a URL even when the user explicitly declined. Summary field extraction had issues: property address edit request ("15 Oak Lane, Swindon") was not applied to the property field, and the account field captured verbatim conversation text instead of extracting "Anderson Estate Agents".

**Minor regression:** The URL-insistence in Test 7 is new — the system asked for a listing URL twice even after the user said "I don't have the URL handy." It eventually proceeded but this adds friction.

### 5. Were earlier Phase 2 conversational gains preserved?

**Mostly preserved, with two known regressions persisting from iter7:**

**Preserved:**
- Greetings and natural openings handled conversationally ✓
- Hidden routing — no category picker shown ✓
- Property-specific issues reach summary efficiently ✓
- Summary cards render with structured fields ✓
- Session ends cleanly after failure or completion ✓

**Persisting regressions (from iter7, not new):**
- **Premature summary for vague starts:** Test 6 — "Hello" + "Something's wrong with our account" → immediately jumped to summary with "Account: Something's wrong with our account" as verbatim text. The system should gather more detail before summarising.
- **Summary-stage confirmation not recognised:** Saying "Yes, that looks correct" at summary stage appends the text to description rather than triggering submission.
- **Account field extraction poor:** Multiple tests showed the account field capturing verbatim user messages ("on our main website, the BriefYourMarket site") instead of extracting the account name ("BriefYourMarket").

**New minor issue:**
- **Account-name loop:** Tests 4 and 8 saw the system ask for the account name 2-3 times despite it being clearly stated. Not a property-question issue, but an account-recognition issue.

---

## Issues Outside Scope (Noted for Reference)

1. **Widget routing intercepted by portalAuth:** The `/api/portal/widget/*` routes are intercepted by the generic portalAuth middleware mounted on `/api/portal` (registered first). Widget identify endpoint returns 401. Only the codex-test-login path works for API testing.

2. **Account-name recognition loop:** The system sometimes fails to extract account names from natural language and re-asks. Not a property-question issue, but an extraction/recognition gap.

3. **Description field accumulates all messages verbatim:** Every user message is appended to the description field, including retry requests, confirmations, and corrections. This creates noisy ticket descriptions.

---

## Summary of Convergence Status

| Blocker | Status | Detail |
|---------|--------|--------|
| Jira ticket creation fails | **Environmental** | `jira_ob_enabled=false` — not a behavioural defect, needs configuration |
| Submission end-state loops | **Fixed** ✓ | Failure → clear message → session completes. No more re-offer loop |
| Property-question for non-property issues | **Fixed** ✓ | Email, CRM, user-admin issues no longer trigger property questions |
| Property-question for site-wide issues | **Fixed** ✓ | Site-wide issues correctly recognised and not funnelled into property-address loop |
| Summary-stage confirmation not triggering submission | **Not fixed** | "Yes, submit" at summary stage treated as additional input, not a submission trigger |
| Premature summary for vague conversations | **Not fixed** | Vague start → insufficient detail → summary rendered prematurely with poor fields |
| Account field extraction | **Not fixed** | Account field captures verbatim text instead of extracting the account name |
| Property-specific journeys efficient | **Mostly preserved** ⚠ | Works well but URL-insistence and field-edit-ignore add friction in some paths |

**Overall: Partially converged.** The two primary blockers from the iteration objective (submission end-state looping, property-question narrowing) are substantially resolved. The submission failure is now environmental rather than behavioural, and property-question narrowing is working well across all tested non-property and site-wide scenarios. Three remaining issues (summary-stage confirmation, premature summary, account extraction) prevent full convergence but are lower severity than the iter7 blockers.
