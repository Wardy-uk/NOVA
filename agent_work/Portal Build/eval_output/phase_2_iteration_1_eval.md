# Phase 2 Iteration 1 — Behavioural Evaluation

**Evaluator:** Eval Agent  
**Date:** 2026-05-21  
**Phase:** Phase 2 — Conversational Intake Continuity  
**Slice:** Conversational clarification continuity  
**Method:** API interaction only (portal chat sessions via HTTP). No source code inspected.

---

## Journey Tested

Four scenarios were exercised through the portal chat API, each starting a fresh session and progressing through multiple conversational turns:

1. **Ambiguous free-text request** — extremely vague opener, followed by login/account detail, then account name, then confirmation
2. **Clear website request** — homepage banner update, followed by carousel detail
3. **Status lookup failure** — customer asks to check ticket status (no org match)
4. **Cross-domain ambiguity** — email + website combined issue

Two additional edge-case probes:
5. **Topic switch mid-flow** — customer pivots from email campaign to website contact form
6. **Nonsense input** — garbage text followed by more garbage

---

## Where Continuity Held

### Category picker eliminated (strong pass)

In Phase 1, the first free-text message immediately triggered a category button grid ("My Website", "My Account", "Billing & Contracts", "Something Else"). In every Phase 2 scenario tested, the category picker did **not** appear. The system responded conversationally instead:

- Ambiguous request → "Could you tell me a bit more about what's going on so I can get this to the right team?"
- Email campaign → "Could you tell me a bit more about what's going on so I can point this in the right direction?"
- Nonsense → "I couldn't find a direct answer in our knowledge base, but let me help you get in touch with the right team."

No scenario triggered visible category buttons, subcategory buttons, or a "Which area does this relate to?" prompt.

### Conversational tone maintained (pass)

All clarification turns used natural conversational language. No "please select", "choose from", or form-driven phrasing appeared. Follow-up questions were contextually appropriate:

- After login detail: "Can you please tell me the name of your account or company where users are seeing the white screen after logging in?"
- After website request: "Which account or website is this for?"
- After topic switch: "Can you please provide the account name or email associated with your website so I can check the contact form issue?"

### Silent reclassification worked (pass)

The ambiguous opener was correctly reclassified after the customer mentioned login/password issues. The meta data shows `category: "account"`, `subcategory: "account_login"` — but this classification was never surfaced to the customer during the clarification turns. The customer experienced a smooth conversational flow without seeing the internal routing decision.

### Status failure stayed conversational (pass)

When status lookup could not find the organisation, the response was: "I couldn't find your organisation's tickets. Would you like to raise a new request instead? If so, just describe what you need and I'll get it sorted." No category picker was shown. This is a clear improvement from Phase 1 where this path fell back to the category grid.

### Cross-domain and topic switch handled (pass)

When the customer's request spanned email and website domains, or switched topic mid-flow, the system continued conversationally without forcing a category choice. The topic switch was handled gracefully — the system pivoted to the new issue without re-presenting a category picker.

---

## Where Continuity Broke

### 1. Summary card exposes internal taxonomy (moderate)

When the conversation progressed to the summary/confirmation stage, the subject line exposed internal routing labels:

> **Subject:** [Portal] My Account — Login / password: Hi, I'm having an issue...

The customer can see `[Portal]`, `My Account`, and `Login / password` — all internal operational categories. The conversational flow carefully avoided exposing these labels during clarification, but then revealed them at the summary stage. For the nonsense input case, the summary showed `[Portal] Something Else — General query`.

This partially undermines the conversational trust built during clarification. The customer learns that internally their request was classified as "My Account > Login / password", which is exactly the taxonomy the build was intended to hide.

**Severity:** Moderate — the summary card is a late-stage disclosure and the customer has already provided their details, but it still makes visible the internal routing model that was hidden during the conversation.

### 2. Summary card subject truncation (minor)

The subject line was cut off mid-sentence: "Hi, I'm having an issue and need some help please.\nUsers at one of our branches" — this looks like an incomplete thought and reduces the professional quality of the summary.

**Severity:** Minor — cosmetic, but it makes the confirmation less trustworthy.

### 3. Confirmation did not progress (moderate)

When the customer said "Yes, that all looks correct. Please go ahead and raise this for us," the system re-presented the summary card with the confirmation text appended to the description rather than submitting the ticket. The customer's confirmation was treated as another message rather than as an acceptance signal.

The journey did not reach a ticket-created confirmation state. The customer would need to understand that they must use a specific confirm action (likely a button or API call) rather than typing their agreement.

**Severity:** Moderate — the customer cannot complete the journey through natural conversation alone. The progression stalls at summary and requires a non-conversational interaction to submit.

### 4. Nonsense escalated to summary too quickly (minor)

After two turns of nonsense input ("asdf jkl; qwerty" then "???"), the system jumped straight to a summary card with category "other" and subcategory "other_general". The request description was just the garbage text. A more robust conversational flow might have attempted one more genuine clarification before giving up and offering to create a ticket with minimal detail.

**Severity:** Minor — edge case. The system at least stayed conversational and didn't show a category picker.

### 5. Email campaign not classified (observation)

"Our email campaign didn't send out properly last week" received the generic clarification question rather than being classified as email marketing. The keyword "email campaign" feels like it should have triggered a domain match. This may mean the keyword detection only covers website/account/property signals and not email marketing.

**Severity:** Observation — not a continuity break (the response was conversational), but a potential gap in classification coverage.

---

## Behavioural Questions Answered

**Does the customer remain inside a believable conversational intake journey after the first free-text request?**  
Yes, through the clarification phase. The customer is not pushed into category selection at any point during the first two turns. The experience feels like talking to a support assistant who is trying to understand the issue.

**Does clarification feel additive and natural rather than like a reset into another intake model?**  
Yes. Each follow-up question builds on what was already said. The system asks for the specific missing piece (account name, URL) rather than restarting from scratch.

**Does the system avoid pushing the customer into visible category selection once conversational intake is underway?**  
Yes, during clarification. However, the summary card at the end reveals the internal category labels, which partially undermines this.

**Do progression and confirmation states still feel like part of one joined-up support experience?**  
Partially. The summary card appears at the right time and includes the right information, but the subject line exposes internal taxonomy, and the confirmation step does not respond to natural language confirmation. The customer cannot complete the journey by typing "yes" — they appear to need a separate confirm action.

**Does the overall experience build or lose conversational trust as the interaction continues?**  
It builds trust through clarification turns 1-2, then partially loses it at the summary stage due to taxonomy exposure and the inability to confirm naturally.

---

## Phase 1 Regression Check

No Phase 1 regressions were observed in this pass. The evaluation did not re-test ticket status display, but the changes reported are backend-only in the chat service and should not affect ticket presentation surfaces.

---

## Issues Outside Phase 2 Scope (noted, not expanded)

- The summary card's subject-line format (`[Portal] Category — Subcategory: description`) appears to be a general template concern, not specific to the conversational path. Fixing it would benefit all intake paths.
- The confirm-and-submit flow requires a separate API call (`POST /chat/sessions/:id/confirm`) rather than responding to conversational confirmation. This is an architectural pattern, not a Phase 2 bug.

---

## Convergence Assessment

**Status: Partially converged.**

The primary Phase 2 objective — keeping the support journey behaviourally conversational after a free-text request — is materially achieved for the clarification phase. The category picker is completely eliminated from the conversational path. Clarification turns feel natural and additive. Silent reclassification works correctly. Status failures and cross-domain ambiguity are handled conversationally.

However, the journey does not remain fully coherent through to completion:

1. The summary card breaks the conversational contract by exposing internal category/subcategory labels that were hidden during clarification.
2. The confirmation step does not respond to natural language confirmation, creating a progression dead-end.

The first issue (taxonomy in summary) is a moderate continuity break that partially undermines the conversational trust built during clarification. The second issue (confirmation not responding to "yes") means the customer cannot complete the journey within the conversational model.

**Recommendation:** Another narrow iteration focused on:
- Removing internal taxonomy labels from the customer-facing summary card subject line
- Making the summary-to-submission transition respond to natural language confirmation (or making it visually clear that a confirm button is required)

The clarification continuity itself is converged. The remaining gaps are in the late-stage summary and confirmation, not in the conversational intake path.
