# Phase 2 Iteration 13 — Behavioural Evaluation

**Date:** 2026-05-23
**Evaluator:** Eval Agent (API-driven behavioural testing)
**Slice focus:** Summary synthesis and summary-edit robustness

---

## Journeys Tested

| # | Session | Scenario | Purpose |
|---|---------|----------|---------|
| 1 | 470 | Vague → actionable problem → summary → multi-field edit → single-field edits | Vague gating, subject quality, multi-field edit |
| 2 | 471 | Clear email-alert problem → summary | Subject categorization, description synthesis |
| 3 | 472 | CRM user addition → summary → multi-field edit | Hidden routing, subject quality, multi-field edit |
| 4 | 473 | Virtual tour broken → summary → natural confirmation | Subject generation, description quality, confirmation recognition |
| 5 | 474 | Security-sensitive user removal → multi-field edit | Auto-urgency, account capture, multi-field edit |

---

## Findings By Evaluation Criterion

### 1. Vague Follow-Up Verification — CONVERGED

The portal now reliably pushes back on vague answers before progressing. Tested in Session 470:
- "Things aren't working properly" → Asked for more detail
- "It's just not right" → Asked again for specifics
- "The website has some problems" → Asked for concrete symptoms, offered ticket escalation
- "The property search on the website isn't returning any results when customers search by postcode" → Accepted as actionable, progressed to field collection

The vague gating is working well. Only actionable problems with identifiable symptoms advance the conversation.

### 2. Subject Consistency — PARTIALLY CONVERGED

Subject generation varies significantly depending on journey path:

| Session | Subject | Quality |
|---------|---------|---------|
| 470 | `[Portal] Content update — Property search not returning results for postcode queries` | Good focus, wrong category ("Content update" for a functionality bug) |
| 471 | `[Portal] Property visibility issue — Property match email alerts not sent to applicants site-wide` | Good focus, wrong category ("Property visibility" for an email issue) |
| 472 | `[Portal] New user — Add new user Sarah Johnson with editor access to CRM` | Good — accurate and concise |
| 473 | `[Portal] Something broken — The virtual tour on 42 Oak Lane isn't loading for viewers on the Henderson Estates website. Accou...` | Bad — truncated first message, not synthesized |
| 474 | `[Portal] User removal — Remove user James Mitchell from BriefYourMarket account` | Good — accurate and concise |

3 of 5 subjects are well-synthesized. 1 is a truncated transcript dump, and 2 have incorrect category labels. The subject synthesis works when it fires, but it does not fire consistently (Session 473 showed no synthesis).

### 3. Description Quality — PARTIALLY CONVERGED

Two distinct description surfaces exist:

**Summary card body (visible to user):** Synthesis quality varies:
- Session 470: Clean — "The property search feature on ... is not returning any results when customers search by postcode."
- Session 471: Excellent — "Email alerts for new property matches have stopped being sent to applicants ... Applicant registration alerts are unaffected."
- Session 472: Clean — "Request to create a new user account for Sarah Johnson ... with editor permissions."
- Session 473: Transcript dump — raw message concatenation, no synthesis applied
- Session 474: Clean — "Remove access for James Mitchell ... from the Greenfield Lettings BriefYourMarket account."

**Description in metadata fields:** Always transcript-like across ALL sessions — raw concatenation of user messages with newlines. This is the value that would be sent to Jira, meaning even when the summary card looks clean, the underlying ticket description is still a transcript dump.

### 4. Multi-Field Summary Edits — NOT CONVERGED

Multi-field edits fail consistently across all tested patterns. The parser captures everything after the first field keyword as that field's value, ignoring subsequent field instructions.

| Session | Edit Request | Result |
|---------|-------------|--------|
| 470 | "Change subject to 'X' and change urgency to high" | Subject = `X' and change urgency to high`, Urgency unchanged |
| 472 | "Change account to Y, and mark this as high urgency" | Account = `Y, and mark this as high urgency`, Urgency unchanged |
| 474 | "Account should be Y not X, and change description to 'Z'" | Account = `Y not X, and change description to 'Z'`, Description unchanged |

**Root behaviour:** The field-value extraction regex consumes the entire remainder of the message after the first field keyword match. It does not segment on "and", comma, or "or" separators before extracting values, even though the exploration notes suggest this segmentation exists.

Single-field edits work correctly:
- Subject edit alone: Applied correctly (Session 470)
- Urgency edit alone: Applied correctly (Session 470)

### 5. Earlier Phase 2 Conversational Gains — MOSTLY INTACT

| Prior Gain | Status | Evidence |
|------------|--------|----------|
| Conversational activation | Intact | All sessions started conversationally |
| Hidden routing | Intact | Session 472 routed "change" intent without picker |
| Natural clarification | Intact | Sessions 470, 471, 473 asked relevant follow-ups |
| Non-looping failure handling | Mostly intact | Session 473 asked about error messages twice (minor loop) |
| Property-question narrowing | Intact | Session 473 asked about specific property vs site-wide |
| Natural summary confirmation | Intact | Session 473 "that looks good, go ahead" was recognized |
| Account-field protection | Intact | Accounts captured correctly in single-field flows |
| Security-sensitive auto-urgency | Intact | Session 474 auto-elevated urgency to High |

Minor regression: Session 472's bot response parroted and truncated the user's message — "I can see we need to add a new user to the CRM - our new sales manager Sarah Johnson ne...."

---

## Additional Observations (Out of Scope)

1. **Account confusion in Session 474:** The bot captured "BriefYourMarket" (the platform) as the account name instead of "Greenfield Lettings" (the customer). This is a semantic understanding gap in field extraction.
2. **Category mislabeling:** Sessions 470 and 471 were categorized as "Content update" and "Property visibility issue" respectively, when the actual issues were a search bug and an email alert failure.
3. **Redundant question in Session 474:** Bot asked "Could you confirm their name and email address?" when both were already provided in the same message.

---

## Convergence Assessment

| Criterion | Status |
|-----------|--------|
| Vague follow-up verification | **Converged** |
| Subject consistency | **Partially converged** — works 3/5 times, inconsistent synthesis trigger |
| Description quality (visible) | **Partially converged** — synthesis works 4/5 times but not reliably |
| Description quality (metadata/Jira) | **Not converged** — always transcript-like across all sessions |
| Multi-field summary edits | **Not converged** — fails 100% of the time |
| Earlier conversational gains | **Mostly intact** — minor parroting regression |

**Overall slice verdict: PARTIALLY CONVERGED**

The vague gating is solid and earlier conversational gains are intact. However, multi-field summary edits are completely broken (the parsing does not segment on conjunctions before extracting values), and description synthesis is inconsistent — sometimes the summary card body shows a clean synthesis but the underlying metadata field always contains raw transcript. Subject generation works more often than not but still produces truncated transcript dumps in some journeys.

**Priority fixes for next iteration:**
1. **Multi-field edit parsing** — the regex must segment the input on "and" / comma / "or" boundaries BEFORE extracting per-field values
2. **Metadata description field** — the synthesized description (when produced) should be stored in `metadata.fields.description`, not just rendered in the card body
3. **Subject synthesis reliability** — ensure the LLM synthesis path is reached in all journeys, not just some
