# Phase 2 — Iteration 11 Evaluation
## Summary Quality and Sequencing

**Date:** 2026-05-22
**Evaluator:** Eval Agent (Opus 4.6)
**Method:** API interaction via codex-test-login JWT against running dev server (localhost:3001)

---

## Journeys Tested

| # | Session | Scenario | Messages to Summary |
|---|---------|----------|---------------------|
| 1 | 454 | "something is wrong with our stuff" (abstract vague, iter10 gap) | 2 — jumped to summary without account question |
| 2 | 455 | Specific property problem with URL in opening message | 2 — asked for account, then showed summary |
| 3 | 456 | "please raise a ticket" + URL + specific problem | 3 — asked for account, then browser, then summary |
| 4 | 457 | "we need some help please" (vague) | 3 — asked for detail, then person info, then summary |
| 5 | 458 | "can you raise a ticket" + URL + specific problem (different phrasing) | 4 — asked for account, then error, then offered ticket, then submitted WITHOUT summary |
| 6 | 459 | Specific CRM problem, then summary edit test | 2 — asked for account, then summary; edit applied cleanly |

---

## Question 1: Do abstract vague journeys now establish the actual problem before progressing?

**PARTIALLY — Same as iter 10. Abstract phrasing still does not trigger the vague gate.**

### J1 ("something is wrong with our stuff"):
- System responded with "Could you tell me a bit more about what's going on so I can point this in the right direction?" — a good clarification question.
- User answered with the actual problem: "our email campaigns seem to have stopped going out"
- System **jumped straight to summary** without ever asking for account name.
- Summary showed the **message text as the account name** ("our email campaigns seem to have stopped going out") — a regression from iter 10 where all account extractions were clean.
- `vagueGateAsked` not tracked in session metadata.

### J4 ("we need some help please"):
- System asked for more detail — good.
- User said "Parkview Estates - it's about our account setup" — still vague ("account setup" is not the problem).
- System asked for affected person details **without first clarifying what "account setup" means** — skipped the actual-problem gate.
- User provided person details AND the real problem ("we can't add a new branch to our account") in message 3.
- System showed summary with subject "account setup" — the vague label, not the specific problem discovered in message 3.

**Verdict:** The system asks an initial clarification question for vague openers (good), but does not verify that the user's answer actually describes a concrete problem before moving on. Both J1 and J4 progressed to summary with insufficient problem clarity.

---

## Question 2: Are summary subject and description fields cleaner?

**MIXED — One journey showed clear improvement, others unchanged.**

### Subject field:

| Journey | Subject | Quality |
|---------|---------|---------|
| J1 | `[Portal] our email campaigns seem to have stopped going out` | BAD — raw message, `[Portal]` prefix |
| J2 | `[Portal] the property photos on our listing at https://rightmove.co.uk/property/98765 are showing the wron...` | BAD — raw message, truncated mid-word, URL in subject |
| J3 | `Website contact form 500 error` | **GOOD** — synthesised, concise, no `[Portal]` prefix |
| J4 | `account setup` | BAD — vague label, not the actual problem |
| J5 | (no summary shown) | N/A |
| J6 (pre-edit) | `[Portal] our CRM login page is broken - it just shows a blank white screen when we try to access it` | BAD — raw message |
| J6 (post-edit) | `CRM login showing blank white screen` | GOOD — user-corrected |

**J3 is a clear breakthrough** — the subject was synthesised from the user's description rather than echoed verbatim. However, J1, J2, J4, and J6 still use the raw opening message as the subject. The inconsistency suggests the summarisation logic works for some routing paths but not others.

### Description field:

| Journey | Description | Quality |
|---------|-------------|---------|
| J1 | `something is wrong with our stuff\nour email campaigns seem to have stopped going out` | BAD — verbatim concat |
| J2 | `the property photos on our listing at...\nGreenfield & Co, the Coventry branch` | BAD — verbatim concat, account answer echoed |
| J3 | `please raise a ticket - our website contact form at...\nGreenfield & Co\nChrome` | BAD — verbatim concat including "please raise a ticket" preamble and bare answers |
| J4 | `we need some help please\nParkview Estates - it's about our account setup\nit's me, John Smith...` | BAD — verbatim concat of all 3 messages |
| J6 | `our CRM login page is broken...\nRiverside Lettings` | BAD — verbatim concat |

**No improvement in description quality.** All descriptions are still raw message concatenation with no summarisation, deduplication, or removal of conversational overhead (greetings, bare account-name answers, "please raise a ticket" phrasing).

### Account field:

| Journey | Account | Quality |
|---------|---------|---------|
| J1 | `our email campaigns seem to have stopped going out` | **BAD — regression.** Message text used as account name |
| J2 | `Greenfield & Co, the Coventry branch` | GOOD |
| J3 | `Greenfield & Co` | GOOD |
| J4 | `Parkview Estates` | GOOD |
| J5 | (no summary shown) | N/A |
| J6 | `Riverside Lettings` | GOOD |

J1's account extraction is a **regression from iter 10** where all 5 accounts were clean. The system didn't ask for the account at all in J1, and set the account field to the problem description message.

### URL field:

| Journey | URL | Quality |
|---------|-----|---------|
| J2 | `https://rightmove.co.uk/property/98765` | GOOD — captured from detail message |
| J3 | `https://greenfield.co.uk/contact` | **GOOD — captured when bundled with "please raise a ticket"** |
| J5 | (no summary shown — but URL acknowledged in conversation) | Cannot verify |

**Improvement over iter 10:** J3 successfully captured a URL bundled with "please raise a ticket" phrasing — this was a documented gap in iter 10. J2 also captured correctly as before.

---

## Question 3: When the user asks early to create a ticket, does the system still show summary for review?

**PARTIALLY — Improved for some patterns, still broken for others.**

### Improved (J3, J5-M1):
- **J3** ("please raise a ticket — our website contact form...") — System did **not** bypass summary. It asked for account, then browser, then showed the full summary for review. This is a clear improvement.
- **J5** ("can you raise a ticket please, the page at...") — System also did **not** immediately create a ticket. It asked for account, then asked about error messages. Good so far.

### Still broken (J5-M4):
- After J5 gathered details, the system said "Would you like me to create a ticket so a team member can assist directly?" The user said "yes please create the ticket" → System **attempted submission without showing summary** and produced a fallback error message.
- The summary review step was completely skipped. The user never saw subject, description, account, or URL fields before submission was attempted.

**The bypass happens at a different point than before.** In iter 10, early ticket-request language in the opening message could bypass summary. Now that's fixed (J3 proves it). But when the system itself offers to create a ticket mid-conversation and the user accepts, it skips summary review.

---

## Question 4: Are URLs captured more reliably when bundled with ticket-request language?

**YES — Improved.**

- **J3** ("please raise a ticket — our website contact form at https://greenfield.co.uk/contact is throwing a 500 error") → URL captured correctly in summary: `https://greenfield.co.uk/contact`. In iter 10, URLs bundled with confirmation phrases were not captured.
- **J5** ("can you raise a ticket please, the page at https://acme-properties.co.uk/listings/456...") → System acknowledged the URL in conversation and asked relevant follow-up questions. Summary was never shown (bypass bug), so capture cannot be fully verified, but the URL was clearly parsed from the opening message.

---

## Question 5: Were earlier Phase 2 conversational gains preserved?

**YES — All earlier gains intact.**

| Earlier Gain | Status This Iteration |
|-------------|----------------------|
| Conversational activation | ✅ All sessions conversational |
| Hidden routing | ✅ Intent/category set internally, never shown to user |
| Natural clarification questions | ✅ J1, J3, J4, J5, J6 all asked relevant follow-ups |
| Natural confirmation recognition | ✅ J5 "yes please create the ticket" was understood |
| Non-looping submission failure | ✅ J5 showed clean fallback, no re-prompt loop |
| Summary edit processing | ✅ J6 edit applied correctly (subject changed, [Portal] prefix removed) |
| Account extraction | ⚠️ J1 regressed — message text as account. J2–J6 clean |

Minor regression: J1's account extraction used message text instead of asking for account name.

---

## Summary Assessment

| Criterion | Iter 10 | Iter 11 | Delta |
|-----------|---------|---------|-------|
| Vague journey actual-problem gate | PARTIALLY | **PARTIALLY** | ➡ No change — still doesn't verify answer is a concrete problem |
| Account extraction quality | CONVERGED | **PARTIALLY** | ⬇ J1 regression (message text as account) |
| Subject field quality | NOT CONVERGED | **PARTIALLY** | ⬆ J3 produced a clean synthesised subject |
| Description field quality | NOT CONVERGED | **NOT CONVERGED** | ➡ Still verbatim concatenation |
| Summary edit processing | CONVERGED | **CONVERGED** | ➡ Stable |
| Summary review before submission | NOT CONVERGED | **PARTIALLY** | ⬆ Opening-message ticket requests now show summary (J3); mid-conversation offer still bypasses (J5) |
| URL capture (bundled) | PARTIALLY | **IMPROVED** | ⬆ J3 captured URL bundled with "raise a ticket" |
| Earlier conversational continuity | CONVERGED | **CONVERGED** | ➡ Stable |

### Overall Phase 2 Iteration 11 Verdict: **PARTIALLY CONVERGED**

**Progress from iter 10:**
- J3's subject line ("Website contact form 500 error") shows the summarisation logic can work — this is the first clean synthesised subject observed across all Phase 2 iterations
- URL capture improved — bundled URLs with ticket-request phrasing now captured (J3)
- Early ticket-request language in opening messages no longer bypasses summary (J3 vs iter 10 J1/J3)

**Remaining gaps:**
1. **Vague gate depth** — System asks "what's going on?" but doesn't verify the answer is a concrete problem description before progressing to summary
2. **Subject inconsistency** — Only 1 of 5 summaries produced a clean subject; others still use raw message text with `[Portal]` prefix
3. **Description verbatim** — All descriptions are still raw message concatenation, no summarisation
4. **Mid-conversation summary bypass** — When the system offers "Would you like me to create a ticket?" and user accepts, summary review is skipped entirely (J5)
5. **Account regression** — J1 set account to message text because it never asked for account name

---

## Out-of-Scope Observations (for future phases)

- **Request type accuracy:** J4 was categorised as "New user" for an account setup / branch addition request — routing may need refinement
- **AI echo pattern:** J2 response truncated the user's message mid-word ("You mentioned hi, the property photos on our listing at https://rightmove — which account...") — cuts off URL and looks broken
- **`[Portal]` prefix** still present in most subjects — should be added server-side, not in user-facing summary
- **Session metadata not persisted:** All session metadata fields (stage, vagueGateAsked, conversational, collectedFields) are empty when querying the session endpoint. Metadata appears to exist only in per-message responses. This makes post-hoc analysis difficult.
