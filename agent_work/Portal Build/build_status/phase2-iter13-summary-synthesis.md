# Phase 2 Iteration 13 — Summary Synthesis and Edit Robustness

**Status:** Ready for evaluation  
**Date:** 2026-05-23

## What Changed

### 1. Vague gate: third-round verification (`portal-chat.ts`)
- Added `vagueGateSecondAsked` flag so the response to the second vague-gate question is checked via `followUpLacksConcreteProblem()` before the journey progresses.
- Previously, the second question's response was never verified — the gate was consumed when the question was asked. Now the response is checked one more time (without asking a third question, to avoid frustrating the customer).

### 2. Summary synthesis via LLM (`portal-chat.ts`)
- Added `SummarySynthesisSchema` and `synthesizeSummaryFields()` method.
- When LLM is available and the description is multi-turn or long (>150 chars), an LLM call generates:
  - **Subject**: concise, issue-focused (max 80 chars), prefixed with `[Portal]` and subcategory.
  - **Description**: 1-3 sentence prose summary with specific details preserved (addresses, phone numbers, names, URLs, error messages). No transcript filler.
- Synthesis is called at the three main entry points to the summary card: `tryKbDeflection`, `handleKbCheckResponse` ("no" path), and `handleDetailStage` (ticket-request interception).
- `buildSummaryCard` uses synthesized values when available, falls back to existing heuristic cleanup.
- `confirmAndSubmit` uses `meta.synthesizedDescription` for the Jira ticket description (raw transcript still goes to internal notes).

### 3. Multi-field summary edits (`portal-chat.ts`)
- `handleSummaryEdit` now splits multi-field messages on conjunction boundaries (`and`/`,`) before field keywords.
- Each segment is processed independently against field-specific regex patterns, so "change the subject to X and the account to Y" correctly updates both fields.
- When edits are applied, stale synthesized values (`synthesizedSubject`, `synthesizedDescription`) are cleared.
- LLM fallback prompt updated to explicitly handle multi-field edit requests.

### 4. Types (`portal-types.ts`)
- Added `vagueGateSecondAsked?: boolean`, `synthesizedSubject?: string`, `synthesizedDescription?: string` to `IntakeSessionMetadata`.

## Files Modified
- `src/shared/portal-types.ts` — 3 new optional fields on `IntakeSessionMetadata`
- `src/server/services/portal-chat.ts` — vague gate logic, synthesis method, summary card display, multi-field edit splitting, confirmAndSubmit description source

## Build
- TypeScript compiles clean (`tsc --noEmit` passes with no errors).

## Not Changed / Still Blocked
- Single-turn first-message paths (e.g. all fields present on opener) do not call `synthesizeSummaryFields` — these descriptions are typically short and coherent already.
- Synthesis quality depends on LLM availability. When LLM is unavailable, the existing heuristic cleanup (dedup, fragment filtering) remains the fallback.
- No changes to Phase 1 behaviour, conversational activation, hidden routing, natural clarification, failure handling, property-question narrowing, summary rendering, confirmation recognition, system-offer flow, account-field protection, or bundled URL capture.
