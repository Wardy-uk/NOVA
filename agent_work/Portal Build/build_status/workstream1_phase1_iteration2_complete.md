# Workstream 1 Phase 1 — Iteration 2 Completion Report

## Customer-Visible Behavioural Changes

### 1. The portal's response now reflects what the customer said

When a customer describes a website issue, the portal's first response is an LLM-generated acknowledgment specific to their message. A customer who writes about a phone number gets a response about their phone number. A customer who writes about a broken image gets a response about their image. Different inputs produce observably different responses.

Previously: every customer received the same category picker buttons regardless of what they wrote.

### 2. No category buttons for website requests

Website design and content change requests now bypass the category picker entirely. The customer describes their issue, the system classifies it invisibly, and the conversation continues without the customer ever seeing area buttons, subcategory pickers, or internal taxonomy.

Previously: every request — no matter how clearly described — was met with "Which area does this relate to?" and a grid of buttons.

### 3. Information already provided is not asked again

The single LLM call extracts fields (URL, account name, description, error messages, browser) from the customer's opening message. Follow-up questions only ask for what is genuinely missing. A customer who includes a URL in their first message will not be asked for the URL again. A customer who names their account will not be asked which account.

Previously: field extraction happened separately and after category selection, meaning the customer was asked to "describe the issue" even if they already had.

### 4. Complete requests skip to confirmation

When a customer provides enough detail in their opening message (what needs changing + where/which account), the portal acknowledges the request specifically and moves directly to the summary card for confirmation — without unnecessary follow-up questions.

Previously: every request went through category selection → subcategory selection → full field gathering, regardless of how much detail was provided upfront.

### 5. Vague requests get natural clarifying questions

A customer who writes something like "I need to change something on our website" receives a natural follow-up question ("Could you tell me what needs changing and where on the page?") rather than a category picker. The question is contextual and conversational.

## What Conversational Behaviours Now Differ Based on Customer Input

| Customer opening | Previous behaviour | New behaviour |
|---|---|---|
| "Our homepage phone number is wrong. It says 01234 111111 and should say 01234 567890." | Category picker buttons | Specific acknowledgment referencing phone number + asks which account/website |
| "The contact page on acmeagents.co.uk needs updating" | Category picker buttons | Acknowledges contact page + URL already captured + asks what needs changing |
| "I need to update some content on our website" | Category picker buttons | Asks what content needs changing and where on the page |
| "Website not working" | Category picker buttons | Acknowledges the issue + asks what's happening and what they'd expect |
| "We need a new staff page added" | Category picker buttons | Acknowledges new page request + asks for content/navigation details |
| "help" | Category picker buttons | Category picker buttons (unchanged — too vague to classify) |
| "I can't log into the admin panel" | Category picker buttons | Category picker buttons (not website content/design — correctly falls through) |

## Preserved Behaviours

- Portal shell, header, navigation — unchanged
- Home page layout and content — unchanged
- Ticket list and ticket detail views — unchanged
- Customer-facing status labels — unchanged
- Mobile responsiveness — unchanged
- Non-website request paths — category picker still appears for account, email marketing, billing, etc.
- Status intent handling — ticket lookup still works
- Question intent + KB deflection — still works
- Frustration detection and handoff — still works (extended with more human-request patterns)
- Summary card confirmation flow — unchanged (uses "Request type" label instead of "Category")
- Ticket creation via Jira — unchanged
- File attachment upload — unchanged
- Session management — unchanged
- Force-handoff after max exchanges — unchanged
- Widget endpoints — unchanged

## Known Limitations

1. **Website scope only.** Only website design/content change requests get the conversational treatment. All other categories still see the category picker. This is by design — non-website categories are out of scope for this phase.

2. **LLM quality dependency.** The acknowledgment quality depends entirely on the LLM's ability to reference what the customer said. A weak model or a poorly formatted customer message may produce a less-than-specific acknowledgment. The prompt provides good/bad examples to guide the model.

3. **Single LLM call per opening message.** The comprehensive call does intent + classification + field extraction + response generation in one shot. If the LLM misclassifies (e.g., thinks a Rightmove feed issue is a website issue), the customer enters the wrong flow. The prompt explicitly instructs against this for property portal feeds, email marketing, CRM, etc.

4. **No-LLM degradation is keyword-based.** When the LLM is unavailable, keyword matching detects website requests. This catches common patterns ("our website phone number is wrong") but cannot generate specific acknowledgments — it uses templates instead. The category picker remains the final fallback.

5. **Confidence threshold at 0.6.** Ambiguous messages that mention websites but aren't clearly about website content/design may be classified with moderate confidence. The 0.6 threshold allows reasonable messages through while filtering genuinely ambiguous ones. Borderline cases may go either way.

6. **Follow-up questions after the first message use a separate LLM call.** The detail stage's `buildConversationalFollowUp` makes its own LLM call for contextual questions. If this fails, it falls back to template questions. The template questions are reasonable but not personalised.

7. **The `buildFirstDetailQuestion` method still exposes taxonomy for the category-picker path.** If a non-website request goes through the category picker and the customer selects "My Website", they'll see "Got it — **My Website** > **Content update**". This only affects the fallback path, not the conversational path.

## Likely Evaluator Pressure Points

1. **Near-complete opening messages.** "Our homepage at acmeagents.co.uk/contact shows 01234 111111 but it should be 01234 567890." — Does the portal acknowledge the specific numbers, capture the URL, and skip to confirmation without redundant questions?

2. **Ambiguous website mentions.** "Something's wrong with our Rightmove listing" — This is NOT a website design/content issue. Does the portal correctly route it to the category picker rather than treating it as a website request?

3. **Very brief messages.** "website change" or "update needed" — Does the portal ask a useful clarifying question rather than showing buttons?

4. **Non-website requests.** "I can't log into my account" — Does the portal correctly show the category picker, not the website conversational flow?

5. **Mid-conversation context.** After the first conversational exchange, do subsequent follow-up questions reference what was already discussed? Or do they feel disconnected?

6. **Escalation requests.** "I want to speak to a real person, not a chatbot" — Does the frustration detection catch this and offer handoff?

7. **LLM unavailability.** If the LLM service is down, does the portal degrade gracefully to keyword-based website detection rather than breaking entirely?

## Trust Risks

1. **Silent misclassification.** If the LLM confidently classifies a non-website request as website-related, the customer enters the wrong flow with no way to correct it. The summary card is their last checkpoint. The prompt's explicit exclusion list (email marketing, CRM, Rightmove, billing) mitigates this but cannot eliminate it.

2. **Over-specific acknowledgment from hallucination.** If the LLM generates an acknowledgment that references details the customer didn't actually mention, trust is immediately broken. The prompt says "reference the details they mentioned" and "do not guess", but LLM hallucination is an inherent risk.

3. **Follow-up question mismatch.** The LLM might generate a follow-up question that doesn't match what's actually needed for ticket creation (e.g., asking about design preferences when the field config requires a URL). The fallback to `buildConversationalQuestion` + `getMissingFields` keeps this aligned with actual field requirements.

## Assumptions Made

1. The `LlmService.call()` method supports the `ConversationalIntakeSchema` Zod schema for structured output without modification.

2. The LLM model behind `tier: 'standard'` is capable of following the comprehensive prompt and producing all required fields in a single call (acknowledgment quality, classification accuracy, field extraction).

3. The `maxTokens: 500` is sufficient for the LLM to produce the full structured response including acknowledgment and next question.

4. URL extraction via regex (`https?://...`) catches the majority of URLs customers will provide. Customers who mention pages by name without a URL ("the contact page") rely on the LLM to note this in the description field.

5. The `temperature: 0.2` provides enough determinism for classification while allowing natural variation in acknowledgments.
