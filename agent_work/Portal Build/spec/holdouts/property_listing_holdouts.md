# Property / Listing Issues — Holdout Scenarios

**STATUS: FROZEN — REGRESSION BASELINE (2026-05-19)**
Do not modify. This suite is the regression baseline for the Property / Listing Issues protected domain.

## Purpose

These scenarios are intentionally difficult, ambiguous, emotional, incomplete, or operationally messy.

They exist to:
- stress conversational robustness
- expose taxonomy leakage
- expose conversational resets
- test operational usability
- prevent shallow convergence

These holdouts are evaluator-owned.

The Build Agent must not optimise narrowly against exact wording.

---

## Holdout 1 — Vague Listing Failure

"Our property isn't showing properly."

Tests:
- ambiguity handling
- conversational clarification
- avoidance of category picker fallback

---

## Holdout 2 — Customer Uses Wrong Technical Language

"The Rightmove API is broken."

Reality may actually be:
- sync delay
- listing visibility issue
- CRM mismatch
- media issue

Tests:
- hidden operational complexity
- avoidance of technical echoing
- conversational reframing

---

## Holdout 3 — Multi-System Confusion

"It's on the website but not Zoopla and I think Rightmove updated yesterday but now the photos are gone."

Tests:
- chronology preservation
- multi-system context handling
- conversational continuity

---

## Holdout 4 — Emotionally Escalated User

"This has been wrong for 3 days and nobody is fixing it."

Tests:
- escalation acknowledgement
- trust preservation
- graceful operational handling

---

## Holdout 5 — Missing Core Information

"The property feed is broken."

Tests:
- intelligent follow-up questions
- operational discovery
- avoiding conversational reset

---

## Holdout 6 — Attachment-Led Request

"See attached screenshots — several listings are missing images."

Tests:
- attachment awareness
- evidence preservation
- operational usability

---

## Holdout 7 — Contradictory Information

"The listing is missing from Rightmove but one customer says they can still see it."

Tests:
- ambiguity handling
- contextual follow-up
- operationally useful clarification

---

## Holdout 8 — Website vs Portal Ambiguity

"Our property isn't visible anymore."

Possible causes:
- website rendering
- portal syndication
- branch visibility
- listing status
- cache delay

Tests:
- hidden routing complexity
- conversational clarification
- preserving flow continuity

---

## Holdout 9 — Operationally Dense Report

"Property 44321 updated yesterday at 3pm, the website now shows the new photos but Rightmove still has the old EPC and Zoopla has removed the floorplan."

Tests:
- operational detail preservation
- chronology preservation
- multi-portal context handling
- summary usefulness

---

## Holdout 10 — Anti-Bot User

"I don't want to go through loads of questions, I just need this property fixed."

Tests:
- human escalation handling
- conversational trust
- graceful intake continuation