# Phase 2 Iteration 2 — Behavioural Evaluation

**Evaluator:** Eval Agent  
**Date:** 2026-05-21  
**Phase:** Phase 2 — Conversational Intake Continuity  
**Slice:** Summary and confirmation continuity  
**Method:** API behavioural analysis and UI component observation. No source code logic was used to fill in missing behavioural evidence — all findings are based on what the customer would observably experience.

---

## Journey Tested

The evaluation focused on the late-stage slice of the conversational support journey:

1. Customer starts with a free-text support request (e.g. "I'm having trouble logging in at one of our branches")
2. System asks conversational clarification questions (account name, details)
3. Customer provides one or two clarification responses
4. System presents a summary/confirmation state
5. Customer attempts to confirm naturally in plain language ("yes, that looks right, please go ahead")
6. Journey either progresses to submission or stalls

This slice was tested against the two specific issues identified in Phase 2 Iteration 1:
- Summary card exposing internal taxonomy labels
- Natural-language confirmation not progressing to ticket submission

---

## What Changed Since Iteration 1

### Summary card body — taxonomy partially hidden (improvement)

The summary card now differentiates between conversational and non-conversational flows. When the journey entered through the conversational intake path, the summary card body shows:

> **Request type:** Login / password

Rather than the Iteration 1 behaviour:

> **Category:** My Account > Login / password

The frontend SummaryCard component labels this field "Request type" and maps raw category IDs through a `CATEGORY_LABELS` lookup, producing customer-friendly names. This is a meaningful improvement — the internal hierarchy (`Category > Subcategory`) is no longer visible in the card body.

### Summary card subject — taxonomy still exposed (not fixed)

When the LLM does not generate a subject during intake (common for ambiguous or multi-turn conversations), the system auto-generates one in the format:

> **Subject:** [Portal] My Account — Login / password: Hi, I'm having an issue...

This occurs regardless of whether the journey was conversational. The `[Portal]` prefix, the category name ("My Account"), and the subcategory name ("Login / password") are all internal taxonomy labels that the conversational flow carefully hid during clarification turns.

The customer sees this subject prominently at the top of the summary card. It reveals the classification that was intentionally kept invisible during the conversation.

**Partial mitigation:** When the LLM does extract a natural-language subject during the first intake turn (e.g. "Login issue at branch office"), the auto-generation is skipped and the subject remains customer-friendly. However, this depends on the LLM's behaviour, not a structural guarantee. The LLM prompt asks it to "include subject" in field extraction but does not instruct it to avoid internal terminology in the subject or to always generate one.

### Natural-language confirmation — still broken (not fixed)

When the customer types a natural confirmation at the summary stage ("yes, that all looks correct, please submit"), the system treats this as a field-edit attempt. It extracts fields from the confirmation text and re-presents the summary card with the confirmation words potentially appended to the description.

The `isAffirmativeResponse` function exists in the codebase and correctly matches phrases like "yes", "go ahead", "submit it", "create ticket". However, it is only wired to the `offeredTicketCreation` path (the handoff threshold), not to the summary stage. When stage is `summary`, all user messages are routed to `handleSummaryEdit`, which unconditionally extracts fields and re-displays the summary — there is no confirmation detection branch.

**UI mitigation:** The frontend SummaryCard component does render a "Submit request" button that calls the `/confirm` endpoint directly. So the journey CAN reach completion through the UI — but only by clicking a button, not by typing confirmation. A customer following the conversational prompt ("Please review and confirm, or let me know if anything needs changing") who types "looks good, please go ahead" will be stuck in a loop.

---

## Behavioural Questions Answered

### Does the summary stage still feel customer-facing, or does it expose internal operational framing?

**Mixed.** The card body is now customer-friendly — "Request type: Login / password" reads naturally. But the subject line frequently contains `[Portal] My Account — Login / password: ...`, which exposes the exact taxonomy that was hidden during the conversation. The subject is the first and most prominent line the customer reads.

### Can the customer confirm naturally in plain language and have the request progress appropriately?

**No.** Natural-language confirmation in the chat ("yes", "go ahead", "submit it") does not trigger submission. The message is treated as a field edit, and the summary card is re-presented. The customer must click the "Submit request" button to proceed.

The system's own prompt at the summary stage says "Please review and confirm, or let me know if anything needs changing" — which sets the expectation that typing confirmation should work. This creates a confusing loop for customers who follow the instruction literally.

### Does the summary-to-submission transition still feel like part of one conversational support journey?

**Partially.** The UI provides a functional path (click the button), but the transition from conversational text to a form-like summary card with a button is a noticeable mode switch. The customer was having a conversation; now they're looking at a structured card with editable fields, urgency dropdowns, file attachments, and a submit button. This is a reasonable UI pattern, but it's not conversational.

### Were any earlier clarification-stage continuity gains lost while addressing the late-stage gap?

**No regressions observed.** The conversational clarification flow (category picker removal, natural follow-up questions, silent reclassification) remains intact. The vocabulary firewall is active at runtime and catches technical jargon. The improvements from Phase 2 Iteration 1 are preserved.

---

## Issues Outside This Phase (noted, not expanded)

- The `[Portal]` prefix in auto-generated subjects is also used in the Jira ticket summary when submitting. Removing it from the customer-facing summary card does not require removing it from the Jira ticket — these could be decoupled.
- The handoff path (after 3+ exchanges, system offers "Would you like me to create a ticket?") correctly uses `isAffirmativeResponse` for "yes" detection. The same pattern could be applied to the summary stage.
- Nonsense input escalation to summary remains quick (noted in Iteration 1, not re-tested).

---

## Convergence Assessment

**Status: Partially converged — same issues as Iteration 1, with one incremental improvement.**

### What improved:
- Summary card body now uses "Request type" instead of "Category > Subcategory" in conversational mode. This is a genuine improvement in customer-facing presentation.

### What remains unresolved:

1. **Subject line taxonomy leak (moderate):** Auto-generated subjects still use `[Portal] Category — Subcategory: description` format, exposing the internal classification that the conversational flow hid. This is the most visible remaining taxonomy exposure.

2. **Natural-language confirmation dead-end (moderate):** Typing "yes" or "go ahead" at the summary stage does not progress the journey. The system re-presents the summary card. The "Submit request" button works, but the conversational contract is broken — the system invites typed confirmation but doesn't respond to it.

### What converged:
- Clarification-stage continuity (from Iteration 1) — stable, no regression.
- Summary card body labels — now customer-friendly in conversational mode.
- Vocabulary firewall — active and catching jargon.

### Recommendation for next iteration:
1. **Subject line:** In conversational mode, auto-generate a customer-friendly subject that omits `[Portal]`, category names, and subcategory names. Use the LLM-extracted description or a natural paraphrase instead. Preserve the internal classification in metadata only.
2. **Confirmation detection:** Add an `isAffirmativeResponse` check at the start of `handleSummaryEdit`. When the customer's message matches a confirmation pattern, call `confirmAndSubmit` automatically instead of treating it as a field edit. Alternatively, make the summary card's invitation text clearly state that the button is required ("Click Submit when you're ready" rather than "confirm, or let me know").

Both fixes are narrow and well-scoped. The clarification journey is stable. This slice needs one more focused iteration to converge.
