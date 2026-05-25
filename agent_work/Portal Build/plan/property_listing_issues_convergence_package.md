# Property / Listing Issues — Convergence Package

## Objective

Implement conversational intake for Property / Listing Issues using the validated Workstream 1 methodology.

This workstream must preserve the protected behavioural standards established during:
- Website Design / Content Changes
- Regression Protection Standard
- Runtime & Evaluation Infrastructure rules

---

## Scope

This workstream covers:
- missing property listings
- incorrect property details
- media issues
- portal sync problems
- Rightmove/Zoopla inconsistencies
- property visibility issues
- floorplans/photos/EPC issues
- listing update delays
- website vs portal ambiguity

---

## Behavioural Goal

Customers should be able to describe property-related problems naturally.

NOVA should:
- interpret intent invisibly
- preserve operationally useful detail
- ask contextual follow-up questions
- avoid category-first intake
- avoid conversational resets
- hide operational complexity

---

## Protected Behaviours

The following protected behaviours from Workstream 1 must remain intact:

- hidden taxonomy
- conversational continuity
- opening-message preservation
- operational detail preservation
- attachment awareness
- human escalation acknowledgement
- graceful fallback behaviour
- operationally useful summaries

---

## Runtime Rules

Evaluation and behavioural testing must use:
- real frontend
- real backend
- real conversational routing path
- real persistence layer where practical

Mock-only conversational evaluation is invalid.

---

## Required Conversational Behaviours

### Missing Listing
Customer:
"One of our properties isn't showing on Rightmove."

Expected:
- conversational acknowledgement
- asks which property
- no category picker
- no feed terminology

---

### Incorrect Details
Customer:
"The price for 14 Church Lane is wrong."

Expected:
- preserves property detail
- contextual follow-up
- no conversational reset

---

### Portal Ambiguity
Customer:
"This property isn't updating properly."

Expected:
- conversational clarification
- hidden routing complexity
- no technical diagnosis required

---

### Media Issues
Customer:
"The floorplan disappeared from one of our listings."

Expected:
- media-aware conversational intake
- attachment-aware behaviour
- operational summary preservation

---

### High Context Multi-System Issue
Customer:
"Property 12345 updated yesterday but Rightmove still shows the old photos and Zoopla is missing the EPC."

Expected:
- chronology preserved
- portals preserved
- operational detail preserved
- contextual follow-up only where required

---

## Critical Constraints

Do NOT:
- expose internal taxonomy
- expose feed architecture
- expose confidence/routing logic
- require customer self-classification
- discard operationally useful customer details
- reintroduce category-picker-first intake

---

## Success Criteria

Convergence is achieved when:
- conversational intake dominates the domain
- operationally useful context survives intake
- evaluator regression suite passes
- protected behaviours remain stable
- runtime parity is validated

Regression protection requires:
- no critical behavioural blockers
- preserved operational usability
- evaluator-confirmed protected convergence