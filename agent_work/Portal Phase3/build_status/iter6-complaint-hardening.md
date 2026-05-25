# Build Status — Portal Phase3 Iteration 6

## Slice: Complaint / escalation operational behaviour hardening

**Status: Ready for evaluation**

## What Changed

Three targeted fixes in `src/server/services/portal-chat.ts`:

### 1. Complaint intent check moved before domain disambiguation (intent stage)

The `COMPLAINT_INTENT_PATTERNS` check now runs **before** `detectCrossDomainAmbiguity()` in the LLM intent handler. Previously, a mixed-domain complaint like "I'm really unhappy with the website, the listings are wrong" would hit disambiguation before complaint detection. Now explicit complaint language takes precedence.

The disambiguation block is preserved unchanged — it just runs after the complaint check, so non-complaint ambiguous messages still get clarification as before.

### 2. Vague gate bypassed for complaint sessions (detail stage)

The vague gate condition changed from `if (meta.conversational)` to `if (meta.conversational && !meta.complaintDetected)`. Short complaint openings (e.g. "I want to complain") previously triggered the generic "what specifically isn't working?" vague gate on turn 2. Complaint sessions now skip the vague gate entirely — the complaint intent itself is the actionable signal, and the complaint-aware follow-up question ("Could you tell me what happened and what outcome you're looking for?") already asks for detail in a complaint-appropriate way.

### 3. Extended complaint phrase coverage

Added to `COMPLAINT_INTENT_PATTERNS`:
- `need this escalated` (alongside existing `needs to be escalated`, `want this escalated`)
- `really/so/incredibly/absolutely unhappy/disappointed/dissatisfied/frustrated` (alongside existing `very/extremely` variants)
- Compound escalation phrases: "I'm really unhappy and need this escalated" style patterns

## What Was Preserved

- Complaint-aware acknowledgement wording unchanged
- Urgency=High auto-assignment unchanged
- Subcategory inference (escalate/response/service) unchanged
- Frustration override fast-track path unchanged
- Follow-up/chase detection unchanged (still runs after complaint check)
- No-LLM fallback complaint path unchanged (already had correct ordering)
- Silent reclassification, vague gate for non-complaint sessions, and all domain-specific field extraction unchanged
- Summary synthesis complaint note unchanged
- Internal ticket complaint markers unchanged

## Nothing Blocked

All three fixes are local to `portal-chat.ts`. TypeScript compiles cleanly. No schema, type, or route changes required.
