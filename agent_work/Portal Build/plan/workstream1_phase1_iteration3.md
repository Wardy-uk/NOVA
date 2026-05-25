# Workstream 1 Phase 1 — Iteration 3 Behavioural Routing

## Routing Decision

Another convergence iteration is required. This is the third iteration addressing the same core gap, and the routing must be direct about why.

The portal has strong bookends. The entry point (home page, "Get help" button, chat opening) is professional. The exit point (Request Summary card, urgency/contact preferences, file attachment, submission confirmation, ticket reference) is well-designed and operationally structured. These are genuine programme assets.

But the runtime path between those bookends — the actual intake conversation — has not changed. The customer's opening message still has no influence on what happens next. The portal still presents the same four area buttons regardless of input. The customer still must select a category and then re-describe their problem. The ticket summary still reflects only the re-description, discarding the opening message entirely.

Two iterations of routing have described this gap. The gap persists. This iteration's routing must therefore be more precise about what "conversational intake" means in observable, testable terms — and narrower about what specifically must change between the customer's first message and the already-working confirmation step.

## Core Behavioural Gap

The portal has two well-built layers and a hollow middle.

**Layer 1 — Conversational shell (working):**
The chat UI, message bubbles, timestamps, branded header, mobile layout, and "Support Assistant" framing are all professional. The customer sees a conversation interface and expects a conversation.

**Layer 2 — Confirmation and submission (working):**
The Request Summary card with editable fields, urgency selector, contact preference, file attachment, "Submit request" and "Edit in chat" actions, and the submission confirmation with ticket reference — these are genuinely good. The structure is operationally sound.

**The gap — Runtime intake between first message and confirmation:**
When the customer sends their opening message, the portal does not process it. It presents a fixed category picker. After category selection, it asks for a re-description. The re-description populates the confirmation card. The opening message is discarded.

The behavioural gap is specifically located between the moment the customer sends their first message and the moment the Request Summary card appears. Everything before and after that gap is working. The gap itself is where conversational intake should exist but does not.

This is important because it means the convergence target is narrow. The build does not need to redesign the portal shell or rebuild the confirmation flow. It needs to replace what happens in between: the customer's message must drive the intake, and the intake must feed the confirmation card.

## Converged Areas To Preserve

The following behaviours are working well and must remain stable through this iteration:

- **Portal home page.** Branded header, recent tickets with customer-friendly statuses, KB articles, clear "Get help" call-to-action.
- **Ticket list and detail.** Customer-friendly status wording ("Reviewed", "Awaiting Your Response"), working ticket detail views.
- **Chat UI chrome.** Message bubbles, timestamps, conversation sidebar with date and status tracking, "New Conversation" button.
- **Taxonomy hiding.** Zero occurrences of "category", "subcategory", "taxonomy", "routing", "queue", "triage", or "classification" in any customer-facing text. This is clean and must remain clean.
- **Request Summary card structure.** Subject, Request type, Account, Description, Browser, Urgency dropdown, Contact preference dropdown, file attachment area, "Submit request" and "Edit in chat" actions. This structure is good.
- **Submission confirmation.** Ticket reference, clear confirmation message, "View Ticket" and "Start a new conversation" options.
- **Mobile responsiveness.** Portal renders correctly at mobile viewport. All content accessible, nothing overflows.
- **Sidebar conversation tracking.** Date, status progression ("In Progress" → "Submitted"), ticket reference after submission.
- **Customer-friendly area language.** Where area concepts appear, they use customer perspective language ("My Website" not "Website Design Queue"). This principle must be preserved even as the delivery mechanism changes.

## Customer-Visible Problems

### The dominant runtime path is still category-first

Despite two iterations of convergence routing, every customer who sends an opening message still receives the same four area buttons. The customer's description — whether it is a complete, detailed, actionable request or a single vague word — makes no difference. The portal's response is fixed.

This is the core trust failure. The customer typed a message expecting engagement. The portal responded with a menu. The customer can see their own message in the chat. They can see the portal's response has no relationship to it. The conclusion is immediate: this system is not listening.

### The customer's opening context is discarded entirely

The evaluator confirmed that the ticket summary is populated exclusively from the re-description (the customer's second attempt at explaining their problem, after category selection). The opening message — which in Scenario 2 contained the URL, specific page, current wrong value, correct value, and urgency — does not appear in any structured field on the ticket.

This means the customer's most considered, most complete communication is thrown away. The ticket contains whatever the customer typed the second time, which is typically terser and less detailed because the customer is frustrated at being asked to repeat themselves.

### Forced re-description breaks conversational continuity

After selecting a category, the portal says: "Got it — [category]. Please describe what should be happening and what is happening instead." This is a conversational reset. The customer already described what is happening and what should be happening — in their opening message. Being asked again communicates: your first message was not read.

For a customer who provided a complete request (Scenario 2), this is particularly damaging. For a customer who was vague (Scenario 3), a follow-up question is reasonable — but "please describe what should be happening" is generic re-description, not targeted clarification based on what they said.

### Identical responses to different inputs feel non-conversational

A customer who says "Our homepage phone number is wrong — it should be 01234 567890" and a customer who says "Something is wrong with our website" receive byte-for-byte identical responses. The portal makes no distinction between a complete, actionable request and a vague, ambiguous one. This is the opposite of conversational behaviour, where responses adapt to what was said.

### Human escalation intent is ignored

A customer who explicitly says "I don't want to use the bot" receives the same category picker as every other customer. There is no acknowledgement of their preference, no fast-track path, and no human handoff option. The only exit is "End conversation", which abandons the request without submission.

## Operational Impact

### The confirmation card structure is good but its content is weak

The Request Summary has the right fields in the right places. Production would be well-served by a ticket arriving with a clear subject, accurate description, URL, urgency, and contact preference. The problem is that the content populating those fields comes from the re-description, not the customer's actual opening request.

For Scenario 2, the customer provided: URL (nurturtest.com), page (contact page), current value (01234 111111), desired value (01234 567890), and urgency (today). None of this appears in the ticket summary. Production receives a generic description and must re-read the chat transcript to find the actionable detail.

### Support will routinely need to restart intake manually

The evaluator assessed that Production would need to re-read the chat transcript for approximately 60% of realistic scenarios. This means the portal is adding a step (chat transcript reading) rather than removing one (intake questioning). The operational promise of the portal — better intake than email — is not being delivered.

### Opening context is the highest-quality signal and it is being lost

Customers put their most thought into their first message. It is the moment of highest engagement and clearest intent. The re-description, by contrast, is typically shorter and less specific because the customer is annoyed at repeating themselves. The portal is discarding the best signal and keeping the worst.

## Behavioural Priorities

These are ordered. Earlier priorities must not be sacrificed for later ones.

### 1. The customer's opening message must materially influence the portal's next response

This is the single most important behavioural change. When a customer describes their issue, the portal's next response must be observably connected to what they said. Different messages must produce different responses. The portal must demonstrate that it received and processed the customer's input.

"Materially influence" means: a customer describing a phone number change should receive a response about phone numbers, pages, or website changes — not a generic category picker. A customer describing something vague should receive a targeted clarifying question — not the same generic category picker.

### 2. Conversational intake must become the dominant runtime path

The category picker must no longer be the first response to every customer message. For messages where the portal can determine what the customer needs (which, based on the evaluator scenarios, includes most clear website change requests), the portal should proceed directly to conversational follow-up or confirmation — not through category selection.

The category picker may survive as a fallback for genuinely uninterpretable input, but it must not be the default path. The default path must be: read the message, respond to it.

### 3. Original customer context must persist into the confirmation and submission

The customer's opening message must contribute to the Request Summary. Information provided in the first message — URLs, page names, specific changes, urgency signals — must appear in the structured ticket fields, not only in the chat transcript. The confirmation card should reflect the full conversation, not just the last thing the customer typed.

### 4. Ambiguous requests should trigger conversational clarification, not category selection

When a customer says "Something is wrong with our website," the portal should ask a natural question that helps distinguish what kind of problem they're having: "Can you tell me a bit more — is something displaying incorrectly, or is something not working?" This is conversational clarification. Presenting four area buttons is category selection. These are fundamentally different behaviours.

### 5. Human escalation intent should be acknowledged gracefully

When a customer explicitly requests to bypass automated intake or speak to a human, the portal should acknowledge this and offer a path forward. This might be a fast-track submission with whatever context has been gathered, or an acknowledgement that their request will go directly to a person. The portal must not ignore the statement and continue with automated questioning.

## Scope Reminders

**The confirmation flow works — preserve it.** The Request Summary card with its fields, urgency selector, contact preference, file attachment, and submission confirmation is a programme asset. This iteration should change what populates the card, not the card itself.

**Ticket creation works — preserve it.** The submission flow, ticket reference generation, and confirmation are functioning correctly.

**Taxonomy hiding is clean — preserve it.** The evaluator confirmed zero taxonomy leaks. This must remain true.

**Mobile UX works — preserve it.** Mobile responsiveness is good across all tested viewports.

**The portal shell is professional — preserve it.** Home page, ticket list, KB articles, navigation, branded header — all working.

**Do not broaden into future workstream concerns.** This iteration addresses the intake conversation for website design / content change requests only. It does not address: KB deflection, emotional routing beyond basic escalation acknowledgement, reopened ticket detection, session continuity across browser sessions, feedback measurement, or any non-website category intake.

**Keep the convergence target narrow.** The gap is specifically located between the customer's first message and the Request Summary card. That is where conversational intake must be built. Everything outside that gap is either working or out of scope.

**Do not redesign the portal.** The visual design, layout, navigation, and information architecture are not the problem. The problem is that the runtime intake path does not process the customer's message. The fix is behavioural, not structural.

## Convergence Guidance

The following observable behaviours would indicate meaningful convergence progress in the next evaluation:

**Different customer openings produce materially different portal responses.** A customer describing a specific phone number change and a customer saying "something is wrong with our website" should receive different next responses — responses that reflect what they actually said.

**The category picker is no longer the first response to every message.** For clear website change requests, the portal should proceed to relevant follow-up or confirmation without requiring the customer to select a category. The category picker may still exist as a fallback, but it is no longer the dominant path.

**Customer context from the opening message appears in the Request Summary.** If a customer provides a URL, a page name, a specific change, or urgency information in their first message, that information should be visible in the confirmation card — not lost.

**The customer is not asked to re-describe a problem they already described.** If the opening message contains a clear, complete request, the next conversational step should acknowledge what was said and ask only for genuinely missing detail. If the opening message is vague, the follow-up should be a targeted clarifying question, not a generic "please describe your problem."

**Conversational clarification replaces category selection for ambiguous inputs.** When the customer's intent is unclear, the portal asks a natural question that helps understand the problem — not a set of category buttons that asks the customer to classify themselves.

**A customer who asks for a human receives acknowledgement.** The portal recognises explicit escalation language and offers a path forward, rather than ignoring the request and continuing with automated intake.

These are the signals that the intake conversation is becoming genuinely conversational. The evaluator will test for these specific behaviours. Perfect classification, optimal question sequences, and comprehensive edge case coverage are not expected. What is expected is that the customer's message enters the intake as a first-class input and survives through to the ticket.

---

*Routing completed: 2026-05-18*
*Manager Agent — NOVA Attractor Programme*
*Workstream 1, Phase 1, Iteration 3*
*Status: Routed for build*
*Prior iterations: iteration 1 (portal shell), iteration 2 (same gap identified, not resolved)*
