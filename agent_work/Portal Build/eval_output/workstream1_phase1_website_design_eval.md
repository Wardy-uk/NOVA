# Workstream 1 Phase 1 Evaluation — Website Design / Content Changes

## Overall Result
**BLOCKED — Partially Converged (UI layer only)**

## Summary

Iteration 4 shows a **significant structural change** from iterations 1–3. The mandatory 4-option category picker ("Which area does this relate to?") that was the primary convergence failure in all prior iterations has been **completely removed**. The portal now presents a clean conversational chat interface with an open-ended prompt: "How can we help?" / "Tell us what you need — report an issue, ask a question, request a change, or check on a ticket."

However, the evaluation is **blocked from full behavioural assessment**. The `mockBypass=chat` cookie correctly bypasses the Vite mock layer for `/api/portal/chat*` endpoints, but the Express API server is not running (MSSQL credentials not configured), so every chat session creation request returns HTTP 500. No assistant responses were received for any of the 7 scenarios. The conversational intake flow — the core Phase 1 deliverable — cannot be evaluated end-to-end.

**What can be assessed:** UI structure, empty states, category picker removal, mobile responsiveness, taxonomy leaks, portal shell.
**What cannot be assessed:** Conversational quality, follow-up questions, classification accuracy, confirmation card population, ticket submission, detail preservation, escalation handling.

## Change from Iterations 1–3

| Aspect | Iterations 1–3 | Iteration 4 |
|--------|----------------|-------------|
| First response to any message | Fixed 4-option area picker | No picker — chat interface ready for conversational flow |
| Category selection visible | Yes — "Which area does this relate to?" | No — removed entirely |
| Customer forced to re-describe | Yes — after area selection | Unknown — backend unavailable |
| Conversational intake | Not present | Architecture present, backend unreachable |

This is a **fundamental architectural change** in the right direction. The category picker was the single largest convergence blocker in iterations 1–3.

## Observed Behaviour (All 7 Scenarios)

Every scenario produced identical observable behaviour due to the backend being unavailable:

1. Customer navigates to portal → clean home page with "How can we help?" heading
2. Customer clicks **"Get help"** → chat interface opens with textarea
3. Customer types their message → submits
4. **No assistant response appears** — `/api/portal/chat/sessions` returns HTTP 500
5. Chat shows the customer's message bubble only
6. No Request Summary, no ticket submission, no follow-up questions

### Network Evidence (all scenarios identical)
```
POST /api/portal/chat/sessions → 500
POST /api/portal/chat/sessions → 500 (retry)
```

### Taxonomy Check
**CLEAN** across all 7 scenarios — zero occurrences of "category", "subcategory", "taxonomy", "routing", "queue", "triage", "classification", or "department".

## Scenario Results

### Scenario 1 — Simple Content Change
**Input:** "Our homepage phone number is wrong. It should be 01234 567890."
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — cannot evaluate conversational handling
- **Evidence:** [v4/s1_01.png](v4/s1_01.png)

### Scenario 2 — Information-Rich Request
**Input:** "Our website nurturtest.com has the wrong phone number on the contact page. It currently says 01234 111111 but should be 01234 567890. Can this be changed today?"
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — this is the critical test (complete request should reach confirmation in one exchange)
- **Evidence:** [v4/s2_01.png](v4/s2_01.png)

### Scenario 3 — Vague Website Request
**Input:** "I need something changed on our website."
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — cannot evaluate whether vague input triggers conversational clarification
- **Evidence:** [v4/s3_01.png](v4/s3_01.png)

### Scenario 4 — Multiple Changes
**Input:** "We need the staff photo changed on the team page and the opening hours updated on the contact page."
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — cannot evaluate compound request handling
- **Evidence:** [v4/s4_01.png](v4/s4_01.png)

### Scenario 5 — Non-Website Request
**Input:** "My property isn't showing on Rightmove."
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — cannot evaluate cross-category routing
- **Evidence:** [v4/s5_01.png](v4/s5_01.png)

### Scenario 6 — Ambiguous Website Problem
**Input:** "Something is wrong with our website."
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — cannot evaluate diagnostic clarification
- **Evidence:** [v4/s6_01.png](v4/s6_01.png)

### Scenario 7 — Human Escalation Preference
**Input:** "I don't want to use the bot, I just need someone to update our homepage."
- **UI:** Clean chat, message sent, no response received
- **Assessment:** BLOCKED — cannot evaluate escalation/bypass handling
- **Evidence:** [v4/s7_01.png](v4/s7_01.png)

## UI Assessment (What IS Observable)

### Improvements Confirmed

1. **Category picker removed.** The mandatory 4-option area picker is gone. This was the #1 convergence failure in iterations 1–3. Its removal is the single most important change.

2. **Open-ended chat interface.** The portal now opens directly to a conversational textarea with a natural-language prompt. This sets the correct expectation for customers — they can describe their issue in their own words.

3. **"How can we help?" empty state.** Clean, welcoming heading with descriptive subtext: "Tell us what you need — report an issue, ask a question, request a change, or check on a ticket." This guides without constraining.

4. **Zero taxonomy leaks.** No internal language visible anywhere in the portal UI. Consistent with iterations 1–3 (which were also clean on this dimension).

5. **Sidebar conversation list.** "No previous conversations" shown for new sessions. Architecture supports conversation history.

6. **Mobile responsiveness preserved.** Portal renders cleanly at 375×812. Chat interface fits without overflow. Navigation remains accessible.

7. **Portal shell intact.** Home page, navigation tabs (Home / My Tickets / Knowledge Base), branded header, and "Get help" CTA all function correctly.

### Concerns (Observable Without Backend)

1. **No error feedback to customer.** When the chat API returns 500, the customer sees... nothing. Their message appears in the chat but no response arrives, no loading indicator persists, and no error message explains the silence. A production-ready portal must handle backend failures gracefully — even if just "We're having trouble connecting. Please try again in a moment."

2. **No "End conversation" or navigation escape.** Once in the chat with no response, the customer's only option is browser back or clicking a nav tab. The chat interface should offer an explicit exit path.

## Regression Assessment

**No regressions observed** in the portal shell, navigation, home page, or mobile layout. The removal of the category picker is an additive improvement, not a regression.

## Convergence Assessment

**Cannot fully assess — BLOCKED by backend unavailability.**

| Phase 1 Requirement | Status |
|---------------------|--------|
| One coherent conversational intake | BLOCKED — UI ready, backend unreachable |
| Invisible classification | PARTIALLY MET — category picker removed; backend classification untestable |
| No visible category selection | MET — picker is gone |
| Relevant follow-up questions | BLOCKED — no responses received |
| Conversational continuity | BLOCKED — no responses received |
| No repeated questions | BLOCKED — no responses received |
| No conversational resets | BLOCKED — no responses received |
| Trustworthy confirmation | BLOCKED — no Request Summary appeared |
| Operationally useful intake | BLOCKED — no tickets submitted |
| Graceful fallback behaviour | NOT MET — silent failure on API error |

**Assessed requirements: 1 MET, 1 PARTIALLY MET, 7 BLOCKED, 1 NOT MET.**

## What Must Happen for a Full Evaluation

The Express API server must be running with a valid database connection so that `/api/portal/chat/sessions` and `/api/portal/chat/sessions/:id/messages` return real responses. The `mockBypass=chat` cookie correctly bypasses the Vite mock layer — the architecture for real-backend evaluation is in place. The only missing piece is the backend itself.

Once the backend is available, the evaluation should be re-run with the same 7 scenarios. The key questions that iteration 4 could not answer:

1. Does the portal now engage conversationally with the customer's opening message?
2. Does it classify the request behind the scenes (invisible to the customer)?
3. Does it ask relevant follow-up questions tailored to the specific request?
4. Does a complete request (Scenario 2) reach the confirmation card in one exchange?
5. Does a vague request (Scenario 3) trigger natural clarification?
6. Does an escalation request (Scenario 7) offer a fast-track or human handoff?
7. Does the Request Summary card still populate correctly from the conversation?

## Recommended Behavioural Feedback

### 1. The category picker removal is the right direction — preserve this
The architectural change from a fixed picker to an open-ended chat is exactly what Phase 1 requires. Do not reintroduce any form of visible category/area selection.

### 2. Handle API failures gracefully
When the backend is unreachable, the customer currently sees silence. The portal should show a clear, friendly error message and offer retry or alternative contact options.

### 3. Previous iteration recommendations still apply (pending verification)
All behavioural recommendations from the iteration 3 report remain relevant but untestable:
- Opening message must influence the next step
- Classification must happen behind the scenes
- Complete requests should reach confirmation in one exchange
- Explicit escalation requests must be honoured
- Vague requests need conversational clarification
- The confirmation card structure should be preserved

These will be verified in the next evaluation once the backend is available.

---

*Evaluation completed: 2026-05-18T14:15Z*
*Evaluator: Eval Agent (Workstream 1, Phase 1, Iteration 4)*
*Portal URL: http://127.0.0.1:5173/portal?codexTestUser=1*
*Cookie: mockBypass=chat (bypasses Vite mock layer for /api/portal/chat*)*
*Test method: Headless Chrome (puppeteer-core) — full end-to-end UI interaction with screenshot capture*
*Scenarios tested: 7/7 (all sent messages; none received responses)*
*Tickets created: 0 (backend unavailable)*
*Screenshots: v4/ directory (desktop + mobile)*
*Taxonomy scan: CLEAN across all scenarios*
*Result: BLOCKED — UI improvements confirmed, backend evaluation pending*
