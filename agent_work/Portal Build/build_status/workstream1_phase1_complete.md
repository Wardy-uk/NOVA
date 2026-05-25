# Workstream 1 — Phase 1 Completion Report

## Execution Phase: Website Design / Content Changes → Full Conversational Intake

## Customer-Visible Behavioural Improvements

1. **No category picker for website requests.** When a customer describes a website design or content change, the system now invisibly classifies the request and continues conversationally. The customer never sees "Which area does this relate to?" with 8 category buttons, and never sees subcategory buttons.

2. **Contextual follow-up questions.** Instead of generic field-by-field prompts ("Could you describe the issue in more detail?"), the system generates questions that reference what the customer already said and adapt to the specific type of website request. A content change gets "Could you tell me what needs changing and where on the page?" — a broken page gets "Could you describe what's happening and what you'd expect to see instead?"

3. **No taxonomy exposure in conversation or summary.** The response text no longer shows "**Category:** My Website > Content update". Instead it shows "**Request type:** Content update" — a customer-friendly label. The summary card in the UI uses "Request type" rather than "Category".

4. **Natural acknowledgment before first question.** The system opens with "I can help with that." (for changes) or "Sorry to hear that — let me help get this sorted." (for problems) before asking the first contextual question, rather than dropping into a form-like category selection.

## Operational Improvements

1. **Invisible classification preserved.** The underlying category and subcategory are still set correctly in session metadata and flow through to Jira ticket creation. Production receives the same structured data they always did — the change is purely in how the customer experiences the intake.

2. **Confidence threshold gating.** Website bypass only triggers when the LLM classification confidence is ≥ 0.7. Ambiguous requests ("I need to make some changes") fall through to the existing category picker. This prevents misclassification from silently routing tickets to the wrong queue.

3. **Graceful fallback chain.** If the website classification LLM call fails entirely (timeout, API error, malformed response), the system falls through to the existing category picker without any customer-visible error. The customer simply sees the original flow.

4. **Existing paths untouched.** Non-website categories (email marketing, account, billing, etc.) continue through the existing category picker flow. Status lookups, KB deflection, frustration detection, and handoff logic are all preserved unchanged.

## Files Changed

- `src/shared/portal-types.ts` — Added `conversational?: boolean` flag to `IntakeSessionMetadata`
- `src/server/services/portal-chat.ts` — Added `WebsiteClassificationSchema`, `ConversationalFollowUpSchema`, `tryWebsiteBypass()`, `buildConversationalQuestion()`, `buildConversationalFollowUp()`. Modified `handleIntentStage` (bypass insertion point), `handleDetailStage` (conversational question branch), `buildSummaryCard` (taxonomy hiding).
- `src/client/components/portal/PortalChat.tsx` — Changed SummaryCard "Category" label to "Request type"

## Known Limitations

1. **Website-only scope.** Only website design/content change requests benefit from the conversational bypass. All other categories still show the category picker. This is by design for this phase.

2. **LLM dependency for bypass.** The conversational path requires a working LLM service. If the LLM is unavailable, customers fall back to the category picker — functional but not conversational.

3. **One extra LLM call.** The website classification adds one additional LLM call per session (on top of the existing intent classification). This is a ~200 token structured output call, so cost and latency impact is minimal.

4. **Follow-up question quality depends on LLM.** The `buildConversationalFollowUp` method uses an LLM call to generate contextual questions. If the LLM produces a poor question, the system falls back to the template-based `buildConversationalQuestion`. The template questions are good but not personalised.

5. **Subcategory classification accuracy.** The distinction between `website_content` and `website_design` can be subtle ("change the banner image" — content or design?). The classification prompt gives clear definitions but borderline cases will exist. Misclassification between website subcategories has low operational impact since they share the same Jira project (NTPJ) and similar field requirements.

## Likely Evaluator Pressure Points

1. **Ambiguous website requests** — "I need something changed on our site" with no further detail. The classification may succeed but the subcategory could be wrong. The follow-up questions should still collect the right information regardless.

2. **Mixed-intent messages** — "Our website contact form is broken AND we need the phone number updated." The classification picks one subcategory. The detail gathering may not fully cover both issues in a single ticket.

3. **Non-website requests that mention websites** — "I can't log into the website admin panel" is really an account/login issue, not a website content/design issue. The classification prompt distinguishes this but edge cases may leak through.

4. **Very brief initial messages** — "Website." or "Need a change." These should fall below the 0.7 confidence threshold and route to the category picker, but borderline cases may produce unexpected behaviour.

5. **Conversation continuity after classification** — If the invisible classification picks the wrong subcategory, the field requirements may not match the actual request (e.g., asking for a URL when the customer wants a new page that doesn't exist yet). The customer can still provide the information through conversation, but the questions may feel slightly off.

## Trust Risks

1. **Silent misrouting.** If the classification confidently picks the wrong subcategory, the customer has no way to know or correct it during the conversation. The summary card shows the request type, so they can spot obvious mismatches there. But between classification and summary, the wrong fields might be asked for.

2. **LLM-generated question quality.** The conversational follow-up questions are LLM-generated. An inappropriate or confusing question would break trust. The fallback to template questions mitigates this, but only triggers on LLM failure, not on poor-quality output.

3. **Expectation gap on summary.** The summary card now says "Request type: Content update" instead of "Category: My Website > Content update". A customer who previously used the portal and saw categories might notice the change, though this is unlikely to cause confusion.

## Assumptions Made

1. The existing `LlmService.call()` method supports the new Zod schemas (`WebsiteClassificationSchema`, `ConversationalFollowUpSchema`) without modification — it already handles arbitrary Zod schemas for structured output.

2. The NTPJ project mapping for website categories is already correctly configured in the intake service settings.

3. The `conversational` flag on session metadata will be correctly persisted and restored across message exchanges (it's serialised as JSON alongside existing metadata fields).

4. Pre-existing type error in `agent-loop.ts` is unrelated and does not affect the portal chat system.
