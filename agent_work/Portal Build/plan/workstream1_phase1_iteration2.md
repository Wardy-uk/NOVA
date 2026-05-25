# Workstream 1 Phase 1 — Iteration 2 Behavioural Routing

## Routing Decision

Another iteration is required. The portal shell is now professional and functional — the home page, ticket list, ticket detail, status wording, mobile responsiveness, and chat UI chrome are all working well. These are genuine improvements that must be preserved.

However, the evaluator has determined that the core Phase 1 objective — conversational intake for website design / content change requests — has not been attempted. The portal currently operates as a category-first system with conversational wording. The customer types a natural-language message, but the portal's response is always a fixed set of area buttons, regardless of what the customer said. The customer's input is not read, not acknowledged, and not used. After selecting an area button, the customer is asked to re-describe their problem from scratch.

This is the fundamental gap. Everything built so far (portal shell, ticket list, status flow, chat chrome) is valuable scaffolding, but the behavioural core — the conversational intake experience — does not yet exist.

This iteration addresses that core.

## Core Behavioural Gap

The portal currently has conversational appearance but not conversational behaviour.

**Conversational appearance (present):**
- The customer types into a chat-style input
- Messages appear in speech bubbles with timestamps
- The portal responds in natural language ("Got it — My Website")
- The visual design says "you are having a conversation"

**Conversational behaviour (absent):**
- The customer's opening message has zero influence on what happens next
- The same four area buttons appear regardless of input
- The portal does not acknowledge, reference, or use anything the customer said
- After area selection, the customer is asked to re-describe from scratch
- The experience is functionally a form with a chat skin

The gap is not cosmetic. It is structural. The portal promises a conversation and delivers a category picker. This mismatch is worse than an honest form would be, because it sets an expectation of being heard and then visibly fails to listen.

## Customer-Visible Problems

### 1. The customer's message is ignored

A customer who writes "Our homepage phone number is wrong — it should be 01234 567890" receives the same response as a customer who writes "help" or "asdfgh". The portal makes no distinction. The customer's effort in crafting a clear description is wasted, and they can see that it was wasted — their message is visible in the chat, and the portal's response clearly has no relationship to it.

This is the single most damaging behaviour. A customer who feels ignored will not trust the portal.

### 2. Visible category selection breaks the conversational contract

After the customer describes their problem, the portal presents four labelled buttons and asks the customer to choose. While the labels avoid internal jargon ("My Website" rather than "Website Design Queue"), the behaviour is unmistakably category selection. The customer is being asked to classify their own request — the exact behaviour the conversational model is designed to eliminate.

For customers with clear requests, this feels redundant ("I just told you it's about my website"). For customers with ambiguous requests, this forces a choice they may not be equipped to make ("Is a Rightmove listing issue 'My Website' or 'Something Else'?").

### 3. Forced re-description wastes the customer's time and patience

After selecting "My Website", the portal says: "Please describe what should be happening and what is happening instead." This asks the customer to do again what they already did — describe their problem. For a customer who provided a detailed, complete opening message, this is particularly frustrating. They can see their original message in the chat history. They know they already said this.

### 4. Trust is broken before intake begins

The cumulative effect of these three problems is that trust is broken before any useful intake occurs. The customer has learned: this portal doesn't listen, it makes me classify my own problem, and then it makes me repeat myself. Even if the subsequent intake questions are well-designed, the customer arrives at them frustrated and sceptical.

## Operational Impact

Even though tickets can technically be created through this flow, the operational intake is not usable.

**The customer's opening message is not captured structurally.** A customer who provides their URL, the affected page, and the specific change in their first message has that information sitting in a chat transcript but not extracted into operational fields. The agent must manually re-read the chat to find it.

**Category selection is customer-performed, not system-determined.** When the customer selects "My Website", that is a customer classification, not an operational classification. Customers can and will select the wrong area — a Rightmove listing issue is not a website design issue, but "My Website" is the most intuitive button for a customer thinking about a website. This produces misrouted tickets.

**Re-description produces duplicate, conflicting information.** The customer's opening message says one thing. Their re-description (after being asked to describe again) may say the same thing differently, or may be terser because they're frustrated. The agent now has two versions of the problem with no clear indication of which is authoritative.

**Production cannot trust portal-sourced intake.** If agents learn that portal tickets require re-reading the chat, re-triaging the category, and re-confirming the details, they will treat portal-sourced tickets as lower quality than email. This is the opposite of the programme objective.

## Behavioural Priorities

The following priorities are ordered. Earlier priorities must not be sacrificed for later ones.

### Priority 1: The customer's opening message must materially influence the portal's next response

When a customer describes their issue, the portal's response must demonstrate that the message was received and understood. The portal's next action — whether that is asking a follow-up question, acknowledging the request, or requesting clarification — must be visibly connected to what the customer actually said.

A customer who writes about a phone number change should receive a response that relates to phone numbers, pages, or website changes. A customer who writes about Rightmove should receive a response that relates to property portals. The response must not be identical regardless of input.

### Priority 2: Classification must happen without the customer's involvement

The customer must not be presented with area buttons, category options, or any selection mechanism that asks them to classify their own request. If the portal needs to determine what kind of issue this is, it must do so from the customer's description — not by asking the customer to choose from a fixed list.

This does not mean the portal must perfectly classify every request. It means the customer must never see the classification happening. If the portal is uncertain, it should ask a natural clarifying question ("Are you seeing this on your own website, or on a property portal like Rightmove?") rather than presenting options to select from.

### Priority 3: The customer must never be asked to re-describe what they already described

If the customer's opening message contains information, that information must be carried forward into the intake. The portal must not ask "Please describe your problem" after the customer has already described their problem. Follow-up questions must ask only for information that is genuinely missing — not for information the customer already provided.

A complete opening message (URL, page, change needed) should lead to a confirmation step, not to a re-description step. A vague opening message should lead to specific clarifying questions, not to a generic "describe your problem" prompt.

### Priority 4: The conversational flow must feel like a single continuous exchange

From the customer's perspective, the conversation should flow naturally: they describe their problem, the portal responds in a way that shows comprehension, asks any necessary follow-up questions, and confirms the request. There should be no visible "phase transitions" — no moment where the customer can tell the system switched from one mode to another.

### Priority 5: Escalation intent must be acknowledged

When a customer explicitly says they don't want to interact with an automated system, or asks for a human, the portal must acknowledge this and offer a path forward. It must not ignore the statement and continue with automated questioning.

## Scope Reminders

**Preserve the portal shell.** The home page, branded header, ticket list, ticket detail view, status wording, mobile responsiveness, and chat UI chrome are all working well. None of these should change.

**Preserve non-website request behaviour unless convergence requires it.** The current area buttons serve requests that are not website design / content changes. If the portal's response to a non-website request needs to change to support conversational intake for website requests, that is acceptable — but only to the minimum extent necessary. Non-website request flows should not be degraded.

**Avoid broad redesign.** This iteration addresses the conversational intake behaviour for website design / content change requests. It does not redesign the portal's navigation, visual design, information architecture, or any feature outside the intake conversation.

**Avoid future workstream concerns.** This iteration does not address: KB deflection, emotional routing, reopened ticket detection, context continuity across sessions, or feedback measurement. These belong to later phases and workstreams. The intake conversation for this iteration ends at ticket creation or human handoff.

**Preserve existing successful improvements.** The customer-friendly status language, the professional ticket list, the working ticket detail view, and the clean chat chrome are programme assets. They must not regress.

## Convergence Guidance

Meaningful convergence progress in the next iteration would be indicated by the following observable behaviours:

**The portal's response to the customer's opening message is not identical across different inputs.** A customer describing a phone number change and a customer describing a photo update should receive different responses — responses that relate to what they actually said.

**The customer is not presented with area selection buttons as the first response to their message.** The customer's opening message is the start of the conversation, not a preamble to a classification step.

**A customer who provides complete information in their opening message is not asked to re-describe it.** The portal should acknowledge what was said and ask only for what is genuinely missing.

**A customer who provides vague information receives a natural clarifying question, not a category picker.** "What would you like changed on your website?" is a conversational clarification. "Which area does this relate to?" with four buttons is a category picker.

**The intake conversation, when completed, produces a ticket with operational fields populated from the customer's actual input.** The agent receiving the ticket should find the information the customer provided, extracted and structured — not buried in a chat transcript.

These are the behavioural signals that would indicate the portal is moving from category-first intake to conversational intake. Perfect classification, optimal question sequencing, and complete holdout coverage are not expected in the next iteration. What is expected is that the customer's message matters.

---

*Routing completed: 2026-05-18*
*Manager Agent — NOVA Attractor Programme*
*Workstream 1, Phase 1, Iteration 2*
*Status: Routed for build*
