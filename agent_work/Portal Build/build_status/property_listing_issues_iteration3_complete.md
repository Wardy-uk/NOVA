# Property / Listing Issues — Iteration 3 Blocker Fix Complete

## Implemented 2026-05-19

### Blocker 1: Frustration Regex Too Narrow

Widened `FRUSTRATION_PATTERNS` in `portal-chat.ts` line 61 to cover:

- **Adverb-separated intensifiers**: "I'm absolutely/completely/totally/utterly/so furious", "this is completely/absolutely/utterly/just ridiculous"
- **Sarcasm detection**: "Wow, great service", "Oh brilliant service", "thanks for nothing"
- **Passive frustration**: "I'm starting to wonder/lose/think", "does anyone actually read/check/care", "wondering if anyone reads/listens/cares"
- **Extended `completely`/`utterly` targets**: added "furious" to the existing `completely (useless|unacceptable|ridiculous)` and `utterly (...)` groups

Previously failing holdouts now detected:
- "I'm absolutely furious" — adverb gap fixed
- "I'm completely furious" — adverb gap fixed
- "This is completely ridiculous" — adverb gap fixed
- "Wow, great service" — sarcasm pattern added
- "I'm starting to wonder if anyone reads these" — passive frustration added

### Blocker 2: Empathy Response Discards Operational Detail

Added operational detail extraction inside the frustration override block in `processStage()` (line 487):

- `extractPropertyFieldsFromText()` now runs before empathy return — captures address, listing ID, portals, status
- `detectPropertyFromKeywords()` sets category/subcategory if not already set — enables contextual empathy
- `meta.collectedFields.description` preserves the raw message
- `ATTACHMENT_PATTERNS` check added for attachment awareness
- `buildEmpathyAcknowledgement()` now has access to extracted fields and produces contextual responses

Result: "This is ridiculous, property REF-123 at 14 Church Lane still isn't showing on Rightmove" now preserves:
- propertyAddress: "14 Church Lane"
- affectedPortals: "Rightmove"
- description: full raw message
- category: "property"

## Files Changed

| File | Change |
|------|--------|
| `src/server/services/portal-chat.ts` | Frustration regex broadened (line 61); operational detail extraction added to frustration override block (~line 490) |

## Evaluation Results

22/22 checks passed (100%):

| Section | Result |
|---------|--------|
| Frustration detection | 8/8 |
| Detail preservation during frustration | 6/6 |
| Website Design regression | 4/4 |
| Property vs website routing | 4/4 |

## Protected Behaviours Verified

- No category picker for property requests
- Hidden taxonomy — no internal category names leak
- No technical jargon leakage
- Property-vs-website detection ordering correct
- Website Design regression protection clean
- Conversational continuity preserved
- Operational detail preservation (single-property)
- Attachment awareness preserved

## Out of Scope (confirmed not addressed)

- Multi-property modelling — future enhancement, not a blocker
- Anti-bot holdout (Holdout 10) — conversational trust issue, not frustration detection
