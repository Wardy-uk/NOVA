# Phase 2 — Iteration 9 Evaluation
## Conversational Intake: Late-Detail / Summary Boundary Quality

**Date:** 2026-05-22
**Evaluator:** Eval Agent (Opus 4.6)
**Method:** API interaction via widget JWT against running dev server (localhost:3001)

---

## Journeys Tested

| # | Session | Scenario | Messages to Summary |
|---|---------|----------|---------------------|
| 1 | 439 | Property listing wrong photo (clear intent) | 3 |
| 2 | 440 | "Something is not working" (vague) | 4 (no summary shown) |
| 3 | 441 | Phone number update (clear intent) | 3 |
| 4 | 442 | Email campaign sent to wrong list (non-property) | 2 |
| 5 | 443 | "I need help with something" (very vague) | 4 (no summary shown) |
| 6 | 444 | Property status change (rich upfront detail) | 2 |

---

## Question 1: Does natural confirmation at summary stage behave as confirmation?

**YES — Converged.**

Three distinct natural confirmation phrases were tested at summary stage:

- "yes that looks right, submit it please" → triggered submission (J1)
- "that looks good, go ahead" → triggered submission (J3)
- "yeah thats fine, submit it" → triggered submission (J6)

All three correctly triggered the submission flow (submission itself failed due to Jira config not being available in eval, but the intent routing was correct). No confirmation phrase was misinterpreted as additional input.

---

## Question 2: Do vague journeys gather enough context before rendering summary?

**NO — Not yet converged.**

Two vague journeys (J2, J5) showed the same pattern:

- **J2:** "Something is not working on our site" → asked for account → asked for URL → asked for URL again → offered to create ticket. **Never asked what was actually broken.** When user said "yes create a ticket", it attempted submission with essentially no problem description.

- **J5:** "I need help with something" → asked for more detail → "it's about our website" → asked for URL → offered ticket creation. Again, **never asked what the user actually needed help with.** Accepted ticket creation with no meaningful description.

Both vague journeys prioritised collecting structured fields (account, URL) over understanding the actual problem. The system will offer to create a ticket without ever establishing what is wrong.

---

## Question 3: Are account fields cleaner and more accurately extracted?

**PARTIALLY — Mixed results.**

| Journey | Account Extracted | Quality |
|---------|------------------|---------|
| J1 | "14 Oak Lane, Sheffield S2 4RT" | BAD — property address used as account name |
| J3 | "Henderson Estates" | GOOD — correct extraction |
| J4 | "Henderson Estates" | GOOD — correct extraction |
| J6 | "Park Lane Residential - I mentioned it in my first message" | BAD — verbatim message content, not cleaned |

When the account name is stated simply, extraction works. When context is mixed (property address alongside account) or the user references earlier context ("I mentioned it in my first message"), the extraction pulls raw message text verbatim.

### Other summary field issues observed:

- **Subject:** "[Portal] Hi there" (J6) — pulled greeting instead of issue description. "[Portal] We need to update the phone number..." (J3) — acceptable but the [Portal] prefix is noise.
- **Person field:** Incorrectly populated with company names ("Henderson Estates", "Park Lane Residential") — these are organisations, not people.
- **Description:** Raw concatenation of all user messages including frustrated reiterations ("I just told you", "I mentioned it in my first message"). No summarisation or deduplication.
- **Urgency:** Correctly escalated to High when user said "quite urgent" (J6), but NOT escalated for objectively urgent situations like wrong email campaign (J4).

---

## Question 4: Were earlier Phase 2 conversational gains preserved?

**MOSTLY — but some regressions noted.**

### Preserved:
- Conversational activation works — the system engages naturally
- Hidden routing is intact — no visible category/subcategory selection exposed to users
- Natural clarification questions flow well for clear-intent journeys
- Summary confirmation reliably triggers submission (key Phase 2 gain)

### Regressions or ongoing issues:
- **Detail acknowledgement lost for non-property journeys:** J4 (email campaign) — user provided campaign name, wrong list, correct list in first message. System responded with generic "Could you tell me a bit more about what's going on?" without acknowledging ANY of the provided detail.
- **Rich detail not absorbed:** J6 — user provided account name, property address, URL, desired action, and urgency in a single message. System asked "which account?" despite it being explicitly stated.
- **Summary edit requests not processed:** J3 — user asked to change urgency to High. Summary re-rendered unchanged with urgency still Normal.

---

## Summary Assessment

| Criterion | Status |
|-----------|--------|
| Natural confirmation as submission trigger | **CONVERGED** |
| Vague journey context gathering | **NOT CONVERGED** — system collects fields but never asks what the problem is |
| Account extraction quality | **PARTIALLY CONVERGED** — works for simple cases, fails for mixed context |
| Summary field quality (subject, person, description) | **NOT CONVERGED** — verbatim extraction, greeting-as-subject, company-as-person |
| Summary edit processing | **NOT CONVERGED** — edit requests at summary don't update fields |
| Earlier conversational continuity | **PARTIALLY CONVERGED** — gains preserved but detail acknowledgement regressed |

### Overall Phase 2 Iteration 9 Verdict: **PARTIALLY CONVERGED**

The confirmation-as-submission-trigger is solid — that's a clear win. But three significant gaps remain:

1. **Vague journeys skip the "what" question** — the system collects who/where but never asks what is actually wrong before offering to create a ticket.
2. **Summary field quality is noisy** — verbatim extraction produces poor subjects, wrong person fields, and raw conversation dumps as descriptions.
3. **Summary edits are ignored** — requesting a field change at summary stage re-renders the same summary without applying the change.

---

## Out-of-Scope Observations (for future phases)

- The `[Portal]` subject prefix is hard-coded noise — could be added server-side at submission rather than shown to the user.
- The "I'm sorry — I wasn't able to create a ticket" fallback is user-hostile — it doesn't explain why or offer retry.
- When the system asks a question the user already answered, it can feel dismissive ("Could you tell me a bit more?") — acknowledging what was already said before asking for clarification would improve the experience.
