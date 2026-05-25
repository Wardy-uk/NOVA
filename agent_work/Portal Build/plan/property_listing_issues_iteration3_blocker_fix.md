# Property / Listing Issues — Iteration 3 Blocker Fix

## Goal

Address the remaining convergence blockers from Iteration 2 evaluation without redesigning the property intake model.

The structural model is sound.

This iteration is limited to:
- frustration detection robustness
- preserving operational detail when frustration is detected
- follow-up account extraction if low-risk

---

## Confirmed Protected Behaviours

The following behaviours must not regress:

- no category picker for property requests
- hidden property taxonomy
- no technical jargon leakage
- property-vs-website detection ordering
- Website Design regression protection
- conversational continuity
- operational detail preservation
- attachment awareness

---

## Blocker 1 — Frustration Regex Too Narrow

Current failure examples:

- "I'm absolutely furious"
- "I'm completely furious"
- "This is completely ridiculous"
- "Wow, great service"
- "I'm starting to wonder if anyone reads these"

Required behaviour:

Frustrated or sarcastically frustrated users should not fall back to category picker behaviour.

They should receive:
- empathetic acknowledgement
- conversational continuity
- graceful handoff where appropriate

---

## Blocker 2 — Empathy Response Discards Operational Detail

Current failure:

When a message contains both frustration and operational detail, the empathy path fires but the property details in the same message may not be preserved.

Example:

"This is ridiculous, property REF-123 at 14 Church Lane still isn't showing on Rightmove."

Required behaviour:

The system must preserve:
- property reference
- address
- portal
- status/symptom
- raw opening message

Even when frustration handling is triggered.

The empathy response may lead the conversation, but operational detail must still be captured.

---

## Optional Low-Risk Fix — Follow-Up Account Extraction

If safe and contained, improve account extraction from follow-up turns.

Example:

"It's for Hargreaves & Sons in Manchester."

This should be captured where possible.

Do not make this a structural redesign.

---

## Explicitly Out Of Scope

Do NOT address multi-property modelling in this iteration.

Multi-property support is a future enhancement, not a convergence blocker.

Do NOT redesign:
- collectedFields
- summary card
- ticket creation
- portal shell
- domain architecture

---

## Success Criteria

- frustration scenarios do not fall to category picker
- frustration + detail messages preserve operational detail
- empathy response remains customer-friendly
- protected behaviours remain stable
- no Website Design regression