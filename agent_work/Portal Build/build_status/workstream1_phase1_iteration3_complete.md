# Workstream 1 Phase 1 — Iteration 3 Completion Report

## Customer-Visible Behavioural Changes

### 1. Dramatically broader website detection without LLM

The keyword detection (`detectWebsiteFromKeywords`) now recognises:
- Named pages: "contact page", "about page", "team page", "staff page", "services page", "branch page", "office page"
- Page regions: "footer", "header", "banner", "menu", "navigation"
- URLs: any `https://...` or domain pattern like `acmeagents.co.uk`
- Implied website requests without explicit "website" word: "our phone number is wrong", "our address needs updating", "opening hours are incorrect"
- Broken-state patterns: "isn't working", "displaying wrong", "shows wrong", "isn't displaying", "not displaying", "not loading", "won't load"
- Content-change signals: "needs updating", "needs changing", "email address", "hours", "logo", "staff", "team"

Previously: only "website", "web site", "webpage", "home page", "our site", "the site", "landing page", "our page" were recognised. Many real customer messages fell through.

### 2. Website-likely but ambiguous messages get conversational clarification, not category picker

When keyword detection or LLM identifies a message as website-related but cannot determine the specific subcategory, the portal now asks a natural clarifying question: "Could you tell me a bit more — is something not displaying correctly, or do you need some content updated?"

Previously: `{ likely: true, subcategory: null }` fell straight through to the category picker. This was the primary reason the category picker appeared for nearly all inputs.

### 3. Moderate-confidence LLM classifications (0.4–0.6) get conversational treatment

When the LLM is moderately confident a request is website-related (0.4–0.6 confidence), the portal now enters the conversational path and asks: "It sounds like this might be about your website — could you tell me a bit more about what needs to happen?"

Previously: any confidence below 0.6 fell through to the category picker. This created a hard cliff where borderline-website requests got no conversational treatment at all.

### 4. The customer's opening message is always captured as description

The opening message is now captured as `meta.collectedFields.description` at the very start of `handleIntentStage`, before any routing decisions. This ensures the customer's first — and typically most detailed — communication survives into the ticket fields regardless of which path the intake follows.

Previously: in the no-LLM path, description was captured, but in the LLM path it was only captured if the LLM extracted it. If the LLM returned no description field, the opening message could be lost.

## What Conversational Behaviours Now Differ Based on Customer Input

| Customer opening | Previous behaviour | New behaviour |
|---|---|---|
| "Our homepage phone number is wrong. It says 01234 111111 and should be 01234 567890." | LLM path: specific acknowledgment (working) | Unchanged — LLM path already handled this |
| "The contact page needs updating" | Keyword detection missed "contact page" → category picker | "contact page" now detected → conversational intake |
| "Our phone number is wrong" (no "website" word) | No website signal → category picker | Implied website content detected → conversational intake |
| "The footer has the wrong address" | "footer" not recognised → category picker | "footer" detected as website signal → "Thanks for letting us know. Which account or website is this for?" |
| "Something is wrong with our website" | Keyword detected website but no subcategory → category picker | Conversational clarification: "Could you tell me a bit more — is something not displaying correctly, or do you need some content updated?" |
| "Our site isn't working" | "isn't working" didn't match → fell to generic category picker | "isn't working" now matched → classified as website_broken |
| "Website shows wrong number" | "shows wrong" not matched → detected website but no subcategory → category picker | "shows wrong" matched → website_broken subcategory |
| "I need to update acmeagents.co.uk" | Domain not detected → category picker | Domain pattern detected as website signal → conversational intake |
| "help" | Category picker | Category picker (unchanged — too vague) |
| "I can't log into the admin panel" | Category picker | Category picker (unchanged — not website content/design) |

## Preserved Behaviours

- Portal shell, header, navigation — unchanged
- Home page layout and content — unchanged
- Ticket list and ticket detail views — unchanged
- Customer-facing status labels — unchanged
- Mobile responsiveness — unchanged
- Non-website request paths — category picker still appears for account, email marketing, billing, etc.
- Status intent handling — ticket lookup still works
- Question intent + KB deflection — still works
- Frustration detection and handoff — still works
- Summary card confirmation flow — unchanged
- Ticket creation via Jira — unchanged
- File attachment upload — unchanged
- Session management — unchanged
- Force-handoff after max exchanges — unchanged
- LLM conversational intake for high-confidence website requests — unchanged (already working from iteration 2)

## Known Limitations

1. **Website scope only.** Only website design/content change requests get conversational treatment. All other categories still see the category picker. By design.

2. **Implied website detection is narrow.** The no-"website"-word detection catches "our phone number is wrong" but not every possible phrasing. Uncommon phrasings without any website signal word will still fall to category picker.

3. **Default subcategory assumption.** When website is detected but subcategory is unclear, the system defaults to `website_content`. If the customer's actual need is `website_broken` or `website_new_page`, the detail-gathering questions may be slightly mismatched until the customer clarifies. The conversational follow-up questions will adapt based on their response.

4. **Moderate-confidence path defaults to website_content.** A 0.4–0.6 confidence classification that proceeds conversationally assumes website_content. If the LLM was wrong and it's not actually a website request, the customer will be in the wrong flow — the summary card is their checkpoint to correct this.

5. **Pre-existing: single agent-loop.ts type error.** `src/server/services/agent-loop.ts(1189,51): error TS2339: Property 'name' does not exist on type '{}'` — unrelated to portal changes, consistently present across all builds.

## Likely Evaluator Pressure Points

1. **"Our contact page phone number is wrong"** — No explicit "website" word. Does the implied-website detection catch "phone number...wrong" and route conversationally?

2. **"Something is wrong with our website"** — Website detected but no subcategory. Does the portal ask a clarifying question instead of showing category buttons?

3. **"The footer on acmeagents.co.uk shows the old address"** — Multiple signals (footer, URL, "old address"). Does the portal detect all of them and enter conversational intake?

4. **"Our site isn't working properly"** — "isn't working" was previously not matched. Does it now route to website_broken?

5. **Near-complete opening messages** — Does the opening message content survive into the ticket fields? Does the description field contain the original message?

6. **Non-website requests** — "I can't log into my account" should still show the category picker, not the website conversational flow.

7. **Very short messages** — "website change" should now get conversational treatment. "help" should still show category picker.

## Specific Code Changes

### `detectWebsiteFromKeywords()` — Broadened detection
- Added named pages: contact, about, team, staff, services, branch, office, property
- Added page regions: footer, header, banner, menu, navigation, nav bar
- Added URL detection: `https?://` patterns and domain patterns (`.co.uk`, `.com`, `.org`, `.net`, `.agency`)
- Added implied website detection (no "website" word needed): phone number/address/opening hours + wrong/incorrect/change/update
- Added broken-state patterns: isn't working, displaying wrong, shows wrong, isn't displaying, not displaying, not loading, won't load
- Added content-change signals: needs updating, needs changing, email address, hours, logo, staff, team

### `handleIntentStage()` — Always capture opening message
- Added `meta.collectedFields.description = content` before any routing, ensuring the opening message is never lost

### `handleIntentWithLlm()` — Three-tier confidence routing
- **High confidence (≥0.6) with subcategory**: conversational intake (unchanged from iteration 2)
- **High confidence (≥0.6) without subcategory**: NEW — conversational clarification instead of category picker
- **Moderate confidence (0.4–0.6)**: NEW — conversational clarification instead of category picker
- **Low confidence (<0.4) or not website**: category picker (unchanged)

### `handleIntentWithoutLlm()` — Conversational fallback for no-subcategory
- When `websiteDetection.likely === true` but `subcategory === null`: NEW — conversational clarification question instead of falling to category picker
- Added "isn't working" to intent detection regex

---

*Build completed: 2026-05-18*
*Build Agent — NOVA Attractor Programme*
*Workstream 1, Phase 1, Iteration 3*
*Status: Build complete, routed for evaluation*
*TypeScript compilation: clean (only pre-existing agent-loop.ts error)*
