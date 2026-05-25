# Phase 2 Iteration 1 — Conversational Clarification Continuity

## What changed

All changes in `src/server/services/portal-chat.ts` (backend only — no frontend changes needed).

### 1. Replaced category picker fallback with conversational clarification

**Before:** When the LLM couldn't classify a free-text request with sufficient confidence and no keyword detection fired, the system dropped to `meta.stage = 'category'` and rendered a grid of nine category buttons (My Website, My Account, Email Marketing, etc.). This was the primary continuity break — the customer typed a natural description and was immediately pushed into explicit category selection.

**After:** The system stays in the `detail` stage with `meta.conversational = true`, sets a temporary category of `other`, and asks: "Could you tell me a bit more about what's going on so I can point this in the right direction?" The customer continues talking naturally.

This change was applied to both the LLM-backed path (`handleIntentWithLlm`, line ~1235) and the no-LLM fallback path (`handleIntentWithoutLlm`, line ~1314).

### 2. Added silent reclassification on follow-up

When the customer responds to the broad clarification question (category=other), the system now runs keyword detection against the combined opening message + follow-up before extracting fields. If property, account, or website signals are found, the category and subcategory are silently updated. The customer never sees the reclassification — they just see the next natural follow-up question for the now-identified domain.

### 3. Replaced subcategory picker with conversational question

**Before:** `askSubcategory()` showed a `subcategory_picker` button grid (e.g., "Content update", "Something broken", "New page", "Design change") when the system had a category but not a subcategory.

**After:** In conversational mode, the method now skips the picker and asks: "Could you tell me a bit more about what you need so I can make sure this gets to the right person?" The subcategory is set to the first available option as a routing default and refined through the subsequent conversation.

### 4. Removed taxonomy exposure from `buildFirstDetailQuestion`

**Before:** After category+subcategory selection, the first detail question said: "Got it — **My Website** > **Content update**. Could you tell me what needs changing?"

**After:** In conversational mode, the response is simply: "Thanks for that. Could you tell me what needs changing and where on the page?" No internal category or subcategory labels are shown.

### 5. Fixed status intent failures to stay conversational

**Before:** When status lookup failed (org not found, no tickets), the system dropped to the category picker: "I couldn't find any recent tickets. Would you like to raise a new request?" + category grid.

**After:** Stays conversational: "I couldn't find any recent tickets for your organisation. Would you like to raise a new request? Just describe what you need and I'll take it from there."

### 6. Category stage re-ask loop made conversational

**Before:** If `handleCategoryStage` couldn't match the customer's response, it re-showed the category picker: "I didn't quite catch that. Which area does this relate to?"

**After:** In conversational mode, asks naturally: "No problem — could you describe what's happening in a bit more detail? That'll help me make sure it gets to the right team."

## What was preserved

- All Phase 1 converged behaviour (status mapping, portal status presentation, status history collapsing) is untouched.
- The category picker and subcategory picker still exist and are used for the non-conversational (form-based) intake path.
- All existing conversational flows (website, property, account classification at ≥0.4 confidence) are unchanged.
- Cross-domain disambiguation, frustration detection, security-sensitive fast-track, escalation chase detection — all preserved.
- Vocabulary firewall, field extraction, KB deflection, summary card, ticket creation — all preserved.
- The `buildCategoryQuestion()` method itself is preserved for use in the non-conversational path.

## Technical verification

- Server TypeScript check passes: `npx tsc -p tsconfig.server.json --noEmit` — clean, no errors.
- No frontend changes made — all changes are backend-only in the stage routing logic.
- No new dependencies, no schema changes, no migration needed.

## Anything uncertain

- The silent reclassification uses keyword detection only (no LLM call). For truly ambiguous follow-ups that don't match any keyword patterns, the category will remain `other` and the ticket will route to the general queue. This is operationally safe but suboptimal — a future iteration could add an LLM reclassification pass.
- The `other_general` subcategory's field config only requires `description` — it doesn't ask for `account`, `url`, or `browser`. For unclassifiable requests that stay in `other`, the ticket may have fewer structured fields. This is acceptable because the full conversation transcript is attached to the Jira ticket.

## Readiness

This slice is ready for evaluation. The running portal should support a conversational request plus one or two clarification turns without visibly reverting to category-led routing in the tested path.
