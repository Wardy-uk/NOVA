# Phase 2 — Iteration 12 Evaluation
## Summary Quality and Sequencing Consistency

**Date:** 2026-05-23
**Evaluator:** Behavioural eval agent
**Verdict:** Partially converged

---

## Journeys Tested

| # | Scenario | Sessions |
|---|----------|----------|
| 1 | Vague opener → vague follow-ups → accept ticket offer | 461 |
| 2 | Concrete problem (wrong property photos) → full detail collection | 462 |
| 3 | Vague opener → concrete answer (new CRM user) | 463 |
| 4 | Urgent crash report → skip account → accept ticket offer | 464 |
| 5 | Frustration opener → accept ticket | 465 |
| 6 | Concrete change request → summary → edit request | 466 |
| 7 | URL + account in single message → full flow | 467 |
| 8 | Potential account-field contamination | 468 |
| 9 | Bare greeting → conversational activation | 469 |

---

## Q1: Do vague journeys now verify the actual problem before progressing?

**No — not converged.**

Session 461: The user said "something is wrong with my account", "yeah it just doesnt seem right", and "I dont know, things are just broken". At no point did the system ask _what specifically is wrong_. Instead it repeatedly asked for the _account name_, accepting the categorisation `account` and stage `detail` without ever verifying a concrete problem. The system offered ticket creation ("Would you like me to create a ticket?") after 3 exchanges, none of which contained an actionable problem statement.

The vague-verification gap remains: the intake progresses on structural completeness (has the user answered the expected detail fields?) rather than semantic completeness (does the system understand what is actually wrong?).

## Q2: Are summary subjects more consistently issue-focused?

**Mixed — partially converged.**

| Session | Subject | Quality |
|---------|---------|---------|
| 461 | `[Portal] Account details — I dont know, things are just broken` | Poor — user's vague text used verbatim |
| 462 | `[Portal] Incorrect property details — The property photos on 42 High Street are showing the wrong images since yesterday` | Acceptable category prefix but too long; duplicates description |
| 463 | `[Portal] New user — We need to add a new user to our CRM system, their name is Jane Smith and email is jane@acme.com` | Good category, but entire user message appended — far too long for a subject |
| 464 | `[Portal] Content update — Our website has completely crashed and nothing loads at all` | Wrong category — "Content update" for a crash. Good problem text though |
| 465 | `[Portal] Support: this is ridiculous I've been trying to sort this for days` | Poor — user frustration text, no problem description |
| 466 | `Change email address for user John` | Good — concise and issue-focused |
| 467 | `Page not loading` | Good — short and accurate |

Pattern: When the user provides a clear, specific request in a single message (sessions 466, 467), subjects are good. When the journey involves multiple exchanges or vagueness, subjects degrade — either appending the full user message or using the user's emotional text verbatim. The `[Portal] Category —` prefix pattern produces excessively long subjects when combined with full user messages.

## Q3: Are summary descriptions cleaner and less transcript-like?

**No — not converged.**

Every tested session produced descriptions that are raw concatenation of user messages, separated by newlines:

- Session 461: `"hi, something is wrong with my account\nyeah it just doesnt seem right\nI dont know, things are just broken"`
- Session 462: `"The property photos on 42 High Street...\nThe account is Acme Estate Agents\nwww.acme-estates.co.uk/properties/42-high-street\njust on our website"`
- Session 463: `"I need help with something\nWe need to add a new user...\nAcme Estate Agents"`
- Session 467: `"Page not loading at...\nChrome on Windows 11...\nSmith and Jones Estate Agents is the account name"`

Descriptions include conversational noise ("I need help with something"), account names (already captured in their own field), and structural answers (like "yes please create a ticket this is urgent" in session 464). A support agent reading these descriptions would need to parse the conversation to find the actual problem.

## Q4: When the system offers ticket creation and the user accepts, is summary review still shown?

**Yes — converged.**

Sessions 461, 464, 465, 467 all followed the pattern: system offered ticket creation → user accepted → summary card displayed with review/edit option. No observed case of accepting a ticket offer bypassing summary review. This is a clear improvement.

## Q5: Are account fields less likely to be populated with problem-description text?

**Mostly yes — partially converged.**

In sessions 461, 464, 465, 468, the account field remained `null` when the user didn't provide an account name. No observed leakage of problem-description text into the account field. However, session 467 showed a minor issue: `account=Smith and Jones Estate Agents is the account name` — the full user phrase including "is the account name" was captured rather than just the entity name. This is conversational noise in the field, though not problem-description contamination.

## Q6: Were any earlier Phase 2 conversational gains lost?

**No major regressions observed.**

| Earlier gain | Status |
|---|---|
| Conversational activation (bare greetings) | Preserved — session 469 responded naturally to "hello" |
| Hidden routing (no category picker shown) | Preserved — all sessions routed silently |
| Natural clarification questions | Preserved — questions feel conversational |
| Stable non-looping failure handling | Preserved — no loops observed |
| Frustration detection | Preserved — session 465 detected frustration immediately |
| Summary edit flow | Partially working — session 466 updated the subject text but failed to update urgency from Normal to High despite the user requesting both changes in one message |
| URL capture | Working at summary time — session 467 correctly extracted URL in the summary card, though it wasn't captured in the intermediate metadata |
| Account extraction | Working — sessions 462, 463, 467 all captured account names |

One minor regression noted in summary edits: the subject was updated to include the edit instruction text ("Email change for John Smith and the urgency should be High") rather than parsing it as two separate field updates. The urgency field was not updated at all.

---

## Additional Observations (Outside Phase Scope)

1. **Category misclassification:** Session 464 categorised a complete website crash as "Content update" rather than "Something broken" or "Website down". This is a category-routing accuracy issue, not a summary-quality issue.
2. **Widget auth routing:** The widget `/identify` endpoint is unreachable when portal is in OIDC mode because the portalAuth middleware at `/api/portal` intercepts requests before they reach the widget router at `/api/portal/widget`. This is a deployment issue unrelated to intake quality.

---

## Convergence Assessment

| Criterion | Status |
|---|---|
| Vague follow-up verification | Not converged |
| Subject consistency | Partially converged |
| Description quality | Not converged |
| Summary review on ticket-offer accept | Converged |
| Account-field regression | Partially converged |
| Earlier gains preserved | Converged |

**Overall: Partially converged.**

The system reliably shows summary review before ticket creation (the main sequencing-consistency goal). Account-field contamination is largely resolved. However, the two core summary-quality issues — transcript-dump descriptions and inconsistent subjects — remain substantive. Vague journeys still progress without verifying a concrete problem, which means the summary-quality issues are downstream of a structural gap: the intake collects _answers to expected fields_ but does not verify that the conversation contains _an actionable problem statement_ before advancing.

**Recommended next focus:** (1) Description synthesis — generate a prose summary rather than concatenating raw messages; (2) Subject truncation — use only the category prefix + a short AI-generated label, not the user's message; (3) Vague-answer gate — require at least one exchange that contains a specific, actionable problem before transitioning from detail to kb_check/summary.
