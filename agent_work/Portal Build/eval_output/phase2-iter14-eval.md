# Phase 2 Iteration 14 — Behavioural Evaluation

**Date:** 2026-05-23
**Evaluator:** Eval Agent (API-driven behavioural testing)
**Slice focus:** Summary fidelity — multi-field edits, synthesis consistency, metadata quality

---

## Journeys Tested

| # | Session | Scenario | Purpose |
|---|---------|----------|---------|
| 1 | 481 | Property search broken → summary → multi-field edits (×2) | Multi-field edit robustness, synthesis quality |
| 2 | 482 | Email alerts stopped → summary | Synthesis consistency across problem types |
| 3 | 483 | CRM user addition → summary → multi-field edit | Hidden routing, synthesis on change-intent, multi-field edit |
| 4 | 484 | Virtual tour broken → summary → natural confirmation | Synthesis on short journey (iter 13 regression scenario), confirmation |
| 5 | 485 | User removal (security-sensitive) → summary → multi-field edit | Auto-urgency, account extraction, multi-field edit |
| 6 | 486 | Vague start → contact form broken → summary → 3-field edit | Vague gating, 3-field simultaneous edit |

---

## Findings By Evaluation Criterion

### 1. Multi-Field Summary Edits — CONVERGED (major improvement)

Multi-field edits now work reliably across all tested patterns. This was 100% failing in iter 13.

| Session | Edit Request | Fields Changed | Result |
|---------|-------------|----------------|--------|
| 481 | "Change subject to X and change urgency to high" | subject + urgency | Both applied correctly |
| 481 | "Change account to Y and change the description to Z" | account + description | Both applied correctly |
| 483 | "Account should be Y not Z, and mark this as high urgency" | account + urgency | Both applied correctly |
| 485 | "Account should just be X, and change the description to Y" | account + description | Both applied — but account captured "just be Greenfield Lettings" (literal filler words included) |
| 486 | "Change subject to X, set account to Y, and change urgency to high" | subject + account + urgency | All three applied correctly |

**4 of 5 multi-field edits applied all requested fields correctly.** The remaining issue is that value extraction is too literal — natural-language filler words like "just be" get captured as part of the field value rather than being stripped. This is a polish issue, not a structural failure.

### 2. Subject Consistency — IMPROVED (converging)

| Session | Subject | Quality |
|---------|---------|---------|
| 481 | `[Portal] Something broken — Property search by postcode returns no results on website` | Good — clear, focused |
| 482 | `[Portal] Property visibility issue — Our property match email alerts have stopped going out to applicants` | Wrong category ("Property visibility" for an email issue), but synthesized |
| 483 | `[Portal] New user — Add new user Sarah Johnson with editor access to Greenfield Lettings CRM` | Excellent — accurate, concise |
| 484 | `[Portal] Something broken — Virtual tour not loading on 42 Oak Lane property page` | Excellent — this was a transcript dump in iter 13, now synthesized |
| 485 | `[Portal] User removal — Remove user James Mitchell (j.mitchell@greenfield.co.uk) from Greenfield Lettings` | Good — accurate |
| 486 | `[Portal] Something broken — Contact form not sending emails on contact page` | Good — clean synthesis |

**5 of 6 subjects are well-synthesized.** Session 482's category label ("Property visibility issue" for an email alert problem) is the only misclassification. The iter 13 regression (Session 473/virtual tour producing a transcript dump) is now fixed — Session 484 produces a clean, synthesized subject for the same scenario.

### 3. Description Quality — SIGNIFICANTLY IMPROVED

**Visible summary card:**

| Session | Quality | Notes |
|---------|---------|-------|
| 481 | Synthesized | Clean prose: "The property search feature on...does not return any results..." |
| 482 | Transcript dump | Raw concatenation of all 3 user messages including "Can you just raise a ticket please?" |
| 483 | Synthesized | "Request to add Sarah Johnson...as a new user with editor access..." |
| 484 | Synthesized | "The virtual tour on the 42 Oak Lane property page...displays a blank white box..." |
| 485 | Synthesized | "Request to immediately revoke access for user James Mitchell..." |
| 486 | Partially synthesized | Decent but includes "Account name is Oakwood Properties" as content rather than extracting it to the field |

**Metadata description field (what goes to Jira):**

| Session | Matches visible? | Quality |
|---------|-----------------|---------|
| 481 | Yes | Clean synthesized text |
| 482 | Yes | Same transcript dump |
| 483 | Yes | Clean synthesized text |
| 484 | Yes | Clean synthesized text |
| 485 | Yes | Clean synthesized text |
| 486 | Yes | Same partially-synthesized text |

**Major improvement:** In iter 13, the metadata description was ALWAYS transcript-like even when the visible summary was clean. Now the metadata description matches the visible summary in all 6 sessions. When synthesis fires, the metadata is clean too. The metadata/visible divergence is resolved.

Synthesis fires in 4 of 6 journeys. Session 482 (multi-turn email alert problem) still produces a transcript dump. Session 486 is partially synthesized but includes field values as content.

### 4. Earlier Phase 2 Conversational Gains — MOSTLY INTACT

| Prior Gain | Status | Evidence |
|------------|--------|----------|
| Conversational activation | Intact | All sessions started conversationally |
| Hidden routing | Intact | Session 483 (user addition) routed without picker |
| Natural clarification | Intact | Sessions 481, 482, 484 asked relevant follow-ups |
| Non-looping failure handling | Intact | Session 484 confirmation triggered graceful fallback |
| Property-question narrowing | Intact | Session 482 asked website vs Rightmove vs Zoopla |
| Natural summary confirmation | Intact | Session 484 "that looks good, go ahead" recognized |
| Account-field protection | Partially intact | See below |
| Security-sensitive auto-urgency | Intact | Session 485 auto-elevated to High |

**Account extraction issues:**
- Session 485: Account captured as "Greenfield Lettings and his email is j." — trailing text from the original message leaked into the field value
- Session 486: Account field was empty in the initial summary despite user clearly stating "Oakwood Properties" twice
- Session 483: Asked for account despite it being provided in the first message

**Redundant questioning persists:**
- Session 485: Bot asked "Could you confirm their name and email address?" when both were already provided in the same message
- Session 486: Bot asked for account after user had already said "Oakwood Properties"

**Vague gating potentially regressed:**
- Session 486: "Something's not working on our website" was accepted and progressed to account collection rather than asking for more detail. In iter 13, similarly vague messages were pushed back on. However, this may be acceptable since the message does identify a concrete system (website), even if the problem is vague.

### 5. Additional Observations (Out of Scope)

1. **Parroting regression (Session 483):** Bot response included "i need to add a new user to our CRM system" — parroting the user's words back as the bot's own statement. Same issue noted in iter 13.
2. **Category mislabeling (Session 482):** "Property visibility issue" for an email alert failure — same issue as iter 13. The category taxonomy doesn't have a good fit for email/notification problems.
3. **Confirmation → ticket creation failure (Session 484):** Natural confirmation was recognized correctly, but the ticket submission itself failed with a graceful fallback message. This is likely a backend integration issue (Jira not configured in dev) rather than a conversational continuity problem.

---

## Convergence Assessment

| Criterion | Iter 13 | Iter 14 | Delta |
|-----------|---------|---------|-------|
| Multi-field summary edits | Not converged (0/3) | **Converged** (4/5 correct, 1 literal filler issue) | Major improvement |
| Subject consistency | Partially converged (3/5) | **Mostly converged** (5/6 synthesized) | Improved |
| Description quality (visible) | Partially converged (4/5) | Partially converged (4/6 synthesized) | Stable |
| Description quality (metadata) | Not converged (0/5 matched visible) | **Converged** (6/6 match visible) | Major improvement |
| Vague follow-up verification | Converged | Mostly intact (1 possible regression) | Minor regression |
| Earlier conversational gains | Mostly intact | Mostly intact | Stable |

**Overall slice verdict: PARTIALLY CONVERGED — trending toward convergence**

The two biggest structural failures from iter 13 are resolved:
1. Multi-field edits now work reliably (was 0%, now ~80-100%)
2. Metadata description now matches visible summary (was 0%, now 100%)

Remaining gaps:
- **Description synthesis inconsistency:** Still doesn't fire on all journeys (Session 482 produced raw transcript). Multi-turn problem-reporting journeys seem less likely to trigger synthesis than change-request or short-journey paths.
- **Account extraction quality:** Field extraction occasionally captures trailing text or misses the account entirely when provided inline with other information.
- **Value extraction literalism:** Natural-language filler words in edit requests get captured as part of field values ("just be Greenfield Lettings").
- **Redundant questioning:** Bot sometimes asks for information already provided in the same or prior message.

**Priority fixes for next iteration:**
1. **Description synthesis reliability** — ensure synthesis fires on ALL journeys, not just short or change-request ones. Session 482 (multi-turn problem report) still produces raw transcript concatenation.
2. **Account extraction robustness** — improve extraction to not consume trailing text and to recognize account names provided inline with other details.
3. **Value extraction cleanup** — strip natural-language filler words ("should be", "just be", "change to") from extracted field values.
