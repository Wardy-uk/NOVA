# Property / Listing Issues — Iteration 2 Hardening Complete

## Behavioural Changes Implemented

### Gap 1: Frustration Detection Robustness
- Widened `FRUSTRATION_PATTERNS` regex to cover:
  - Duration-based frustration: "been broken for days/weeks/ages", "been waiting for a while"
  - Third-person blame: "nobody is fixing this", "no one is helping"
  - Persistence complaints: "still not fixed", "still hasn't been resolved"
  - Adverb-intensified phrases: "completely useless", "utterly unacceptable", "beyond frustrated", "extremely unhappy", "so frustrated/angry/disappointed"
  - Patience exhaustion: "I've had enough", "I've lost patience", "I've been waiting"
  - Strong negative adjectives: "unacceptable", "appalling", "disgraceful", "atrocious", "dreadful"
  - Repetition frustration: "how many times", "how long do I"

### Gap 2: Template-Path Conversational Acknowledgements
- Added `buildEmpathyAcknowledgement()` — generates metadata-aware empathy when frustration is detected (references property address, listing ID, portals if available)
- Added `buildTemplateAcknowledgement()` — generates metadata-aware acknowledgement for non-LLM template paths (references property/listing/portal/URL details)
- Updated all non-LLM fallback responses to use `buildTemplateAcknowledgement()` instead of generic "Thanks for letting us know" / "Thanks for getting in touch"
- Frustration handoff now uses contextual empathy instead of a single static message

### Gap 3: Property vs Website Detection Ordering
- Moved property detection BEFORE website detection in `handleIntentWithoutLlm()`
- Extracted `handlePropertyFallback()` method for clean separation
- Messages like "not showing on Zoopla or our website" now correctly route to property intake instead of website intake
- LLM path already had correct priority instructions in the prompt — no changes needed there

## Files Changed

| File | Change |
|------|--------|
| `src/server/services/portal-chat.ts` | All three gaps implemented |

## Protected Behaviours Preserved

- Website Design conversational intake — untouched, runs after property detection fails
- Website content/broken/new page subcategory routing — unchanged
- LLM-based conversational intake — unchanged (already had correct property priority)
- Category picker fallback for non-website/non-property — unchanged
- Operational detail preservation (raw message capture, no LLM overwrites) — unchanged
- Hidden taxonomy — no category IDs exposed to users
- Attachment mention tracking — unchanged
- KB deflection flow — unchanged
- Handoff threshold behaviour — unchanged
- Summary card with metadata — unchanged

## Build Validation

- TypeScript: clean (only pre-existing agent-loop.ts error, unrelated)
- Vite build: clean (62 entries precached)

## Remaining Known Gaps

- Frustration detection is regex-based — subtle sarcasm or irony won't be caught (would require LLM-based sentiment analysis)
- Template acknowledgements in `handleIntentWithoutLlm` are limited to regex-extracted fields — the LLM path has richer extraction and its own conversational acknowledgements
- The LLM prompt for property vs website priority relies on model compliance — edge cases where LLM ignores the instruction would still mis-route (this is inherent to LLM-based classification)
