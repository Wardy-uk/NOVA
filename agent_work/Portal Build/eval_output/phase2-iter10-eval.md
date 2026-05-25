# Phase 2 — Iteration 10 Evaluation
## Summary Readiness and Summary Quality

**Date:** 2026-05-22
**Evaluator:** Eval Agent (Opus 4.6)
**Method:** API interaction via codex-test-login JWT against running dev server (localhost:3001)

---

## Journeys Tested

| # | Session | Scenario | Messages to Summary |
|---|---------|----------|---------------------|
| 1 | 445 | "my website isnt working" (vague) | 4 (no summary shown — went direct to failed submission) |
| 2 | 446 | "need help with my account" (vague) | 3 |
| 3 | 447 | Add new branch office for Henderson Realty (specific) | 4 (no summary shown — went direct to failed submission) |
| 4 | 448 | "something is wrong with our stuff" (very vague) | 2 (premature summary) |
| 5 | 449 | Wrong property photos on listing (specific) | 3 |
| 6 | 450 | Product cancellation request (clear intent) | 1 (still in detail stage) |

---

## Question 1: Do vague journeys now establish the actual problem before progressing?

**PARTIALLY — Improved for some patterns, not others.**

### Improved (J1, J2):
- **J1** ("my website isnt working"): System asked for account → asked "what specifically isn't working?" → collected the actual problem (500 error on contact form) before attempting submission. **This is a clear improvement over iter 9** where vague journeys never asked what was wrong.
- **J2** ("need help with my account"): Same good pattern — asked for account → asked "what specifically isn't working?" → got real problem description before showing summary.

Both J1 and J2 had `vagueGateAsked: true` in metadata, confirming the vague gate fired correctly for these patterns.

### Still broken (J4):
- **J4** ("something is wrong with our stuff"): `vagueGateAsked: null` — the vague gate did NOT fire. The system asked "Could you tell me a bit more about what's going on?" (which is a good question), but when the user answered with just the account name, it **jumped straight to summary** without ever asking what the problem actually was. The user then provided the real problem (email campaigns stuck in queue), but the summary was not updated — it still showed the vague opener as the entire description.

The vague gate appears to trigger on recognisable patterns like "not working" or "need help" but misses more abstract phrasing like "something is wrong with our stuff".

---

## Question 2: Are summary fields cleaner and less verbatim?

**PARTIALLY — Subject and description quality remain noisy.**

### Subject field:

| Journey | Subject | Quality |
|---------|---------|---------|
| J2 | `[Portal] need help with my account` | BAD — vague opener, not the actual problem |
| J4 | `[Portal] something is wrong with our stuff` | BAD — vague opener, not actual problem |
| J5 | `[Portal] there, the property photos on listing 12345...` | BAD — stripped "Hi" but left orphan "there," |
| J1 | null (no summary shown) | N/A |
| J3 | null (no summary shown) | N/A |

No journey produced a clean, synthesised subject line. The subject is either the raw vague opener or a badly truncated version of the first message. The `[Portal]` prefix is still present.

### Description field:

| Journey | Description Quality |
|---------|-------------------|
| J1 | Verbatim concatenation: vague opener + account name + actual problem, newline-separated |
| J2 | Same verbatim concatenation before edit; **clean after user-requested edit** |
| J3 | Verbatim concat including "the account is Henderson Realty" echoing what user was asked |
| J4 | Only vague opener + account name — real problem never absorbed |
| J5 | Verbatim concat of all messages including redundant account references |

Description is still raw message concatenation. No summarisation, no deduplication, no removal of conversational overhead (greetings, account-name-only answers, confirmations).

### Account field:

| Journey | Account | Quality |
|---------|---------|---------|
| J1 | Acme Properties | GOOD |
| J2 | Riverside Lettings | GOOD |
| J3 | Henderson Realty | GOOD |
| J4 | Parkview Estates | GOOD |
| J5 | Greenfield & Co | GOOD |

**All account extractions were correct.** This is a clear improvement — no property-address-as-account or verbatim-message-as-account issues from iter 9.

### URL field:

| Journey | URL | Quality |
|---------|-----|---------|
| J1 | null | BAD — user provided URL in same message as "yes raise a ticket" |
| J3 | null | BAD — user provided URL in message |
| J5 | `https://rightmove.co.uk/property/12345` | GOOD |

URL extraction is inconsistent — works when provided in a standalone detail message but not when bundled with a confirmation phrase.

### Other fields:

- **Listing ref** correctly extracted in J5 (12345) — good
- **Affected portals** correctly set to "Rightmove" in J5 — good
- **Urgency** defaulted to Normal in all cases — no urgency detection tested this iteration

---

## Question 3: When the user asks to change a field at summary stage, does the re-rendered summary reflect that change?

**YES — Converged. This is a significant improvement over iter 9.**

J2 tested two sequential edits:

1. **Subject edit:** User asked "can you change the subject to CRM licence expired - cannot log in" → Summary re-rendered with new subject. ✅
2. **Description edit:** User asked "please update the description to: Unable to log into CRM..." → Summary re-rendered with the new clean description, replacing the verbatim concatenation. ✅

In iter 9, edit requests were completely ignored. Now they work correctly for both subject and description fields.

---

## Question 4: Were earlier Phase 2 conversational gains preserved?

**YES — All earlier gains observed intact.**

| Earlier Gain | Status This Iteration |
|-------------|----------------------|
| Conversational activation | ✅ All sessions used `conversational: true` |
| Hidden routing | ✅ Intent/category/subcategory set internally, never shown to user |
| Natural clarification questions | ✅ J1, J2, J5 all asked relevant follow-ups |
| Natural confirmation recognition | ✅ J5 "yeah that looks right, go ahead" → triggered submission |
| Non-looping submission failure | ✅ J1, J3, J5 all showed clean fallback message on failure, no re-prompt loop |
| Property-question narrowing | ✅ J5 asked "is this affecting your website, property portals, or both?" |

No regressions detected in previously converged behaviours.

---

## Summary Assessment

| Criterion | Iter 9 | Iter 10 | Delta |
|-----------|--------|---------|-------|
| Vague journey context gathering | NOT CONVERGED | **PARTIALLY** | ⬆ Some patterns now gate correctly, others still skip |
| Account extraction quality | PARTIALLY | **CONVERGED** | ⬆ All 5 accounts clean |
| Subject field quality | NOT CONVERGED | **NOT CONVERGED** | ➡ Still vague-opener-as-subject |
| Description field quality | NOT CONVERGED | **NOT CONVERGED** | ➡ Still verbatim concatenation |
| Summary edit processing | NOT CONVERGED | **CONVERGED** | ⬆⬆ Both subject and description edits now apply |
| URL extraction | N/A | **PARTIALLY** | New — works in some contexts, not others |
| Natural confirmation | CONVERGED | **CONVERGED** | ➡ Stable |
| Earlier conversational continuity | PARTIALLY | **CONVERGED** | ⬆ No regressions detected |

### Overall Phase 2 Iteration 10 Verdict: **PARTIALLY CONVERGED**

Clear progress from iter 9:
- **Summary edits now work** — a complete fix of a previously broken behaviour
- **Account extraction is clean** across all tested journeys
- **Vague gate fires** for "not working" / "need help" patterns (J1, J2)
- **No regressions** in earlier Phase 2 gains

Remaining gaps:
1. **Vague gate inconsistency** — abstract phrasing like "something is wrong with our stuff" doesn't trigger it, leading to premature summary with no problem description
2. **Subject line quality** — still uses the raw opening message rather than a synthesised summary of the actual issue
3. **Description verbatim concatenation** — raw message dump with no summarisation, deduplication, or removal of conversational overhead
4. **URL extraction inconsistency** — URLs bundled with confirmation phrases are not captured
5. **Summary bypass on "yes please raise a ticket"** — when user says this before seeing a summary, the system attempts submission without showing summary first (J1, J3)

---

## Out-of-Scope Observations (for future phases)

- **Routing precision:** Product cancellation request was categorised as `property_visibility` (J6) — routing logic may need refinement for non-property request types
- **AI reply quality:** J5 msg1 echoed the user's full message verbatim in the AI response ("You mentioned hi there, the property photos on listing 12345 for Greenfield & Co are showin...") — truncated mid-word, poor UX
- **`[Portal]` prefix** still present in all subjects — should be added server-side at submission, not shown in user-facing summary
- **Summary not shown before submission when user eagerly confirms:** J1 and J3 both went from detail-gathering straight to submission attempt when user said "yes please raise a ticket" without first rendering the summary for review
