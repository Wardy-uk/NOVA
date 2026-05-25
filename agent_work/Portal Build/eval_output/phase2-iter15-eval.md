# Phase 2 Iteration 15 — Behavioural Evaluation

**Date:** 2026-05-23
**Evaluator:** Eval Agent (API-driven behavioural testing)
**Slice focus:** Summary synthesis consistency, inline account extraction cleanup, edited field value quality

---

## Journeys Tested

| # | Session | Scenario | Purpose |
|---|---------|----------|---------|
| 1 | 488 | Multi-turn email alert problem → summary | Synthesis consistency on multi-turn problem reports (iter 14 Session 482 produced transcript dump) |
| 2 | 489 | Property search broken → summary | Synthesis on short problem journey, inline account extraction |
| 3 | 490 | CRM user addition → summary → multi-field edit | Hidden routing, account extraction from first message, multi-field edit |
| 4 | 491 | Security user removal → filler-word multi-field edit | Auto-urgency, filler-word extraction ("should just be") |
| 5 | 492 | Vague start → concrete problem → summary | Vague gating, multi-turn synthesis |
| 6 | 493 | Virtual tour broken → summary → 3-field edit | Synthesis on property problem, 3-field simultaneous edit |

---

## Findings By Evaluation Criterion

### 1. Description Synthesis Consistency — IMPROVED (5/6 synthesized)

| Session | Visible Description | Synthesized? | Metadata description matches visible? |
|---------|-------------------|-------------|--------------------------------------|
| 488 | "Property match email alerts have not been sent to any applicants for approximately 3 days, affecting all properties across the Greenfield Lettings account." | Yes | Yes — synthesizedDescription field populated and shown |
| 489 | "The property search on the main search page of oakwoodproperties.co.uk is not returning any results when searching by postcode. This issue began yesterday..." | Yes | Yes |
| 490 | "Request to add Sarah Johnson as a new user with editor access to the CRM system for the Greenfield Lettings account." | Yes | Yes |
| 491 | "Revoke access for James Mitchell...due to his departure from the company." | Yes | Yes |
| 492 | "The contact form on parkside.co.uk/contact is not sending any emails when submitted, resulting in missed enquiries." | Yes | Yes |
| 493 | "The virtual tour on the 42 Oak Lane property page...displays a blank white box instead of loading the tour." | Yes | Yes |

**Major improvement from iter 14:** All 6 journeys produced synthesized descriptions. In iter 14, Session 482 (multi-turn email alert problem, same scenario as Session 488 here) produced a raw transcript dump. That specific regression is now fixed — Session 488 produces clean synthesis.

**However:** The `collectedFields.description` in metadata still contains raw transcript concatenation in most sessions, while the `synthesizedDescription` field holds the clean text. The visible summary card correctly displays the synthesized version. This metadata divergence is cosmetic as long as Jira ticket creation uses `synthesizedDescription` rather than `collectedFields.description`.

### 2. Inline Account Extraction — PARTIALLY IMPROVED

| Session | Account Value | Clean? | Notes |
|---------|--------------|--------|-------|
| 488 | "Greenfield Lettings. Can you just raise" | No | Trailing text from "Can you just raise a ticket please?" leaked into field |
| 489 | "Oakwood Properties" | Yes | Clean extraction from first message |
| 490 | Not extracted from first message (asked again) | N/A | Account was stated in first message but bot asked "which account is this for?" |
| 491 | "Greenfield Lettings" (initial) | Yes | Clean initial extraction |
| 492 | "Parkside Homes" | Yes | Clean extraction |
| 493 | "Meadowview Estates" (initial) | Yes | Clean extraction |

**3 of 5 initial extractions were clean.** Session 488 captured trailing sentence text. Session 490 missed the account entirely despite it being stated inline. These are the same categories of failure seen in iter 14 — improvement in raw count but the underlying extraction patterns haven't changed.

### 3. Edited Field Values — NOT CONVERGED (filler words persist)

| Session | Edit Request | Field | Resulting Value | Clean? |
|---------|-------------|-------|----------------|--------|
| 490 | "account should be Oakfield Properties not Greenfield Lettings, and mark this as high urgency" | account | "Oakfield Properties" | Yes |
| 490 | same | urgency | "High" | Yes |
| 491 | "account should just be Oakfield Estates" | account | "just be Oakfield Estates" | No — filler "just be" captured |
| 491 | "change the description to say he was terminated for misconduct..." | description | "he was terminated for misconduct and all access must be revoked immediately" | Partially — instruction wording ("say") stripped but pronoun "he" retained without context |
| 493 | "Change the subject to Virtual tour embed broken, set the account to Oakview Properties, and mark urgency as high" | subject | "Virtual tour embed broken" | Yes (lost [Portal] prefix) |
| 493 | same | account | "Oakview Properties, and mark urgency as high" | No — rest of sentence absorbed into account |
| 493 | same | urgency | "Normal" (unchanged) | No — urgency edit consumed by account extraction |

**Multi-field edits (2 fields): 2/2 successful** — Session 490 correctly applied both changes.

**Multi-field edits (3 fields): 0/1 successful** — Session 493 failed: only subject was applied correctly. The account field absorbed the urgency instruction text, and urgency was not changed at all. This is a regression from iter 14, where 3-field edits worked (Session 486: subject + account + urgency all applied correctly).

**Filler word stripping: Not improved.** "just be" in Session 491 was captured verbatim (same issue as iter 14 Session 485). The extraction logic does not strip common natural-language filler phrases.

### 4. Earlier Phase 2 Conversational Gains — MOSTLY INTACT

| Prior Gain | Status | Evidence |
|------------|--------|----------|
| Conversational activation | Intact | All 6 sessions started conversationally |
| Hidden routing | Intact | Sessions 490 (user addition), 491 (user removal) routed without picker |
| Natural clarification | Intact | Sessions 488, 489, 493 asked relevant follow-ups |
| Property-question narrowing | Intact | Session 488 asked website vs Rightmove vs Zoopla |
| Metadata/visible alignment | Intact | All 6 sessions show synthesizedDescription in visible summary |
| Security-sensitive auto-urgency | Intact | Session 491 auto-elevated to High |
| Non-looping failure handling | Intact | Session 489 offered ticket creation after URL pushback |
| Natural summary confirmation | Intact | Sessions 489, 492, 493 recognized "yes please create the ticket" |
| Multi-field edits (2 fields) | Intact | Session 490: account + urgency both applied |
| Multi-field edits (3 fields) | Regressed | Session 493: only 1 of 3 fields applied correctly |

**Parroting persists (Session 490):** Bot said "i need to add a new user called Sarah Johnson to our CRM system with editor a...." — parroting user's first-person statement as the bot's own words. Same issue noted in iter 13 and 14.

**Redundant questioning persists:** Session 490 asked "which account or company is this for?" when the user had stated "The account is Greenfield Lettings" in the same message.

**Vague gating appears weakened:** Session 492's opening "Something is not working on our website" was accepted and progressed to account collection rather than being pushed back on. In iter 13, similar vague messages triggered pushback. This may be acceptable since it identifies "website" as the affected system, but it's less strict than iter 13's behaviour.

### 5. Additional Observations (Out of Scope)

1. **Description not re-synthesized after account edit (Session 490):** After changing account from "Greenfield Lettings" to "Oakfield Properties", the description still references "Greenfield Lettings account." The synthesizedDescription was not regenerated when fields were edited.
2. **[Portal] prefix dropped on subject edit (Session 493):** When user overwrote the subject, the system prefix was lost. Minor but worth noting for Jira consistency.
3. **synthesizedDescription wiped by description edit (Session 491):** After user explicitly changed the description via edit, `synthesizedDescription` was set to `NONE` and `synthesisDone` was not present. The raw edit text became the only description. This is arguably correct behaviour (user explicitly overwrote the description), but the resulting text is lower quality than what synthesis would produce.

---

## Convergence Assessment

| Criterion | Iter 14 | Iter 15 | Delta |
|-----------|---------|---------|-------|
| Description synthesis consistency | Partially converged (4/6) | **Mostly converged** (6/6 synthesized) | Improved |
| Description metadata/visible alignment | Converged (6/6) | Converged (6/6) | Stable |
| Account extraction quality | 3 issues in 6 sessions | 2 issues in 6 sessions | Slightly improved |
| Filler word stripping (edits) | Not converged | Not converged | No change |
| Multi-field edits (2 fields) | Converged (~80-100%) | Converged (2/2) | Stable |
| Multi-field edits (3 fields) | Converged (1/1) | **Regressed** (0/1) | Regression |
| Earlier conversational gains | Mostly intact | Mostly intact | Stable |

**Overall slice verdict: PARTIALLY CONVERGED — improved on synthesis, but extraction and edit cleanup remain open**

### What improved:
1. **Description synthesis now fires on all tested journeys** (6/6), including the multi-turn email alert scenario that was a raw transcript dump in iter 14. This is the biggest win.
2. **Account extraction slightly better** — 3 of 5 initial extractions were clean (vs mixed results in iter 14).

### What remains:
1. **Account extraction still captures trailing text** (Session 488: "Greenfield Lettings. Can you just raise") — the extraction boundary doesn't stop at the account name when followed by unrelated instructions.
2. **Filler word stripping doesn't work** — "just be" (Session 491), "and mark urgency as high" absorbed into account (Session 493). The extraction logic is too literal.
3. **3-field simultaneous edits regressed** — Session 493 failed to parse the 3rd field (urgency) when the 2nd field (account) absorbed the rest of the sentence. This worked in iter 14 Session 486.
4. **Redundant questioning** — bot still asks for information already provided in the same message (Session 490: account).
5. **Parroting** — bot still echoes user's first-person statements as its own (Session 490).

### Priority fixes for next iteration:
1. **Field extraction boundary detection** — stop account extraction at sentence boundaries, commas, or transition words ("and", "please"). Session 488 and 493 both show the same root cause: extraction doesn't know where the value ends and the next instruction begins.
2. **Filler word stripping** — strip common instruction filler from extracted values: "just be", "should be", "change to", "set to". Currently these are captured verbatim.
3. **3-field edit parsing** — ensure all 3 fields are identified before extraction begins. The current approach seems to extract greedily, which causes the 2nd field to absorb text meant for the 3rd.
