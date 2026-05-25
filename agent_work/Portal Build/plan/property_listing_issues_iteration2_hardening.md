# Property / Listing Issues — Iteration 2 Hardening

## Goal

Address the evaluator-identified conversational polish gaps without redesigning the converged intake architecture.

The structural conversational model is considered sound.

This iteration focuses on:
- empathy robustness
- template-path conversational quality
- detection ordering refinement

---

## Gap 1 — Frustration Detection Robustness

Current frustration detection is too narrow.

Examples currently failing:
- "This has been broken for days"
- "Nobody is fixing this"
- "I'm absolutely furious"

Required:
- widen frustration detection patterns
- support indirect frustration phrasing
- support adverb-separated emotional phrases
- avoid category picker fallback for emotionally escalated users

When frustration is detected:
- conversational continuity must continue
- empathetic acknowledgement should appear
- graceful handoff behaviour should remain available

---

## Gap 2 — Template Path Conversational Acknowledgement

The fallback/template conversational path currently produces generic responses even when operational details were successfully extracted.

Examples:
- listing IDs
- portals
- property addresses
- chronology

The customer should feel their details were recognised.

Required:
- enrich template-path acknowledgements using extracted metadata
- reference operational details conversationally where available
- preserve concise tone
- avoid robotic summarisation

Important:
This is conversational acknowledgement improvement only.

Do NOT:
- redesign metadata extraction
- redesign conversational architecture
- replace the existing LLM path

---

## Gap 3 — Property vs Website Detection Priority

Property-related requests mentioning websites/portals should prefer property conversational intake.

Example:
"It's on the website but not Zoopla..."

Currently website detection may win too early.

Required:
- prioritise property detection when portal indicators are present
- preserve website conversational behaviour for genuine website issues
- avoid regression to Website Design convergence

---

## Constraints

Do NOT:
- expose taxonomy
- reintroduce category pickers
- regress Website Design behaviours
- redesign portal shell
- weaken operational detail preservation
- introduce holdout-specific hardcoding

---

## Success Criteria

- emotionally escalated users remain conversational
- template responses feel context-aware
- property/portal ambiguity routes more naturally
- evaluator no longer identifies architectural concerns
- protected behaviours remain stable