# Build Status — Iteration 5: Complaint / Escalation Operational Behaviour

**Status:** Ready for evaluation  
**Date:** 2026-05-24

## What Changed

### 1. Complaint intent detection (`portal-chat.ts`)
Added `COMPLAINT_INTENT_PATTERNS` regex that catches clear complaint and escalation language:
- "I want to make a complaint", "formal complaint", "raise a complaint"
- "I need to escalate", "please escalate", "this needs escalating"
- "I'm not happy", "completely unacceptable", "your service has been terrible"

### 2. Complaint-aware conversational path (`portal-chat.ts`)
Three insertion points ensure complaint intent is caught regardless of LLM availability:
- **`handleIntentStage`** (LLM path): After cross-domain disambiguation, before escalation/chase patterns. Detects complaint intent, sets `category=complaint`, `urgency=High`, infers subcategory from language (escalate/response time/service), and enters a complaint-specific conversational path.
- **`handleIntentWithoutLlm`** (no-LLM fallback): Same detection after chase patterns.
- **Frustration override**: When frustration is detected AND complaint intent matches, routes to complaint category instead of generic property/account.

### 3. Complaint-specific conversational questions (`portal-chat.ts`)
- `buildConversationalQuestion` returns "Could you tell me what happened and what outcome you're looking for?" for complaint category description field.
- Initial complaint acknowledgement: "I'm sorry to hear that — I want to make sure your complaint is properly recorded and dealt with."

### 4. Complaint context preservation (`portal-chat.ts`, `portal-intake.ts`)
- Summary synthesis prompt includes complaint-aware instructions when `complaintDetected` is set — generates subjects like "Complaint: repeated login failures not resolved".
- Internal note on Jira tickets includes `⚠️ COMPLAINT / ESCALATION — customer expressed dissatisfaction. Treat as complaint case.` for both chat-intake and form-intake paths.

### 5. Complaint priority boost (`portal-intake.ts`)
- Complaints default to `High` priority in the intake service. If urgency was `Normal`, it's boosted to `High` for any `complaint*` category.
- Chat path sets `urgency=High` at detection time.

### 6. Metadata type (`portal-types.ts`)
- Added `complaintDetected?: boolean` to `IntakeSessionMetadata`.

## Behavioural Summary

**Before:** A customer saying "I want to make a complaint about your service" would either:
- Match FRUSTRATION_PATTERNS (if angry enough) → generic fast-track to ticket creation with no complaint context
- Fall through LLM classification → no complaint intent → category picker or generic `other` path

**After:** The same message:
1. Matches `COMPLAINT_INTENT_PATTERNS` → sets `complaint` category + `complaint_service` subcategory
2. Acknowledges the complaint context explicitly
3. Asks what happened and what outcome is desired
4. Gathers account name
5. Shows summary card with "Complaint / Escalation" request type
6. Creates Jira ticket at High priority with complaint marker in internal note

## Files Changed
- `src/server/services/portal-chat.ts` — complaint patterns, intent handling, synthesis, internal note
- `src/server/services/portal-intake.ts` — complaint priority boost, complaint internal note marker
- `src/shared/portal-types.ts` — `complaintDetected` field on metadata

## Not Blocked
All changes are self-contained. No external dependencies or config required.

## Regression Risk
Low. Changes are additive — new regex + new conditional branches in intent handling. Existing paths (frustration, chase, domain classification) are preserved. The complaint path only fires on explicit complaint/escalation language that wasn't previously caught by any domain-specific handler.
