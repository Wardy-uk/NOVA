# Build Status — Portal Phase3 Iteration 3

## Slice: Reopened / follow-up ticket continuity hardening

**Status: Ready for evaluation**

## What Changed

### 1. Expanded follow-up detection patterns (`portal-chat.ts`)

Added missing real-world phrasings to `ESCALATION_CHASE_PATTERNS`:
- "marked resolved but" / "was resolved but" / "been resolved but"
- "same issue again" / "same problem again"
- "happened again" / "happening again"
- "it came back" / "it's come back" / "it has come back"
- "not actually fixed" / "not actually resolved"
- "problem is back" / "problem came back" / "problem returned"

These cover the two primary phrasing failures identified by evaluation ("still not fixed" already matched; "marked resolved but it is not" now matches).

### 2. Fixed follow-up detection ordering (both LLM and non-LLM paths)

**LLM path**: Moved the F5 escalation/chase check **above** the H2 vague-domain-signal handlers (account/website/property keyword detection). Previously, a follow-up message that happened to mention domain keywords (e.g., "still not fixed — I raised this about our website") would be intercepted by the domain handler and never reach follow-up detection.

**Non-LLM fallback path** (`handleIntentWithoutLlm`): Same reordering — F5 now runs first.

**Status intent path** (`handleStatusIntent`): Added follow-up detection when no ticket reference is found in the message but chase language is present. Previously this fell through to showing recent tickets without entering follow-up mode.

### 3. Follow-up ticket reference hydration in detail stage

Added a new block in `handleDetailStage` that detects ticket references (NT-xxx / NTPJ-xxx) during follow-up conversations and hydrates them from `jira_issue_cache`. This handles the case where the customer provides a ticket reference in their second message (after the initial follow-up detection asked for it).

### 4. Correct follow-up metadata in summary card

**Server**: Added `followUpTicketKey` and `followUpTicketSummary` to the `messageMeta.fields` object in `buildSummaryCard`. Previously these were only in the text response but missing from the structured metadata the client renders.

**Shared types** (`portal-types.ts`): Extended `ChatMessageMetadata.fields` to include `followUpTicketKey?` and `followUpTicketSummary?`.

**Client** (`PortalChat.tsx`): Added a non-editable "Related ticket" row to the `SummaryCard` component, showing the referenced ticket key and summary. Previously this information was only visible in the markdown text above the structured card.

### 5. Non-LLM F5 path now sets proper follow-up metadata

The non-LLM fallback F5 path previously only set `meta.escalationDetected = true` without setting `meta.category = 'followup'` or `meta.subcategory`. Now it correctly sets both, ensuring follow-up tickets are categorised and routed correctly regardless of which code path detected them.

## Files Changed

| File | Change |
|------|--------|
| `src/server/services/portal-chat.ts` | Pattern expansion, detection reordering, detail-stage hydration, summary metadata |
| `src/shared/portal-types.ts` | Extended `ChatMessageMetadata.fields` type |
| `src/client/components/portal/PortalChat.tsx` | Added "Related ticket" row to SummaryCard |

## Regression Risk

Low. Changes are additive (new patterns, new metadata fields). The reordering only affects messages that match `ESCALATION_CHASE_PATTERNS` — these were already being caught, just sometimes by the wrong handler. Domain-specific routing for non-follow-up messages is unchanged.

## Nothing Blocked

All three identified gaps are addressed. TypeScript compiles cleanly.
