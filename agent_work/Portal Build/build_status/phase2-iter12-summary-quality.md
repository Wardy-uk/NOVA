# Phase 2 Iteration 12 — Deep Summary-Quality and Sequencing Hardening

**Status:** Ready for evaluation  
**Date:** 2026-05-23  
**Files changed:** `src/server/services/portal-chat.ts`, `src/shared/portal-types.ts`  
**Build:** Clean (tsc --noEmit passes)

## What Changed

### 1. Vague follow-up verification (concrete-problem gate)
Previously, `vagueGateAsked` was a one-shot flag — the gate fired once but never checked whether the follow-up actually contained a real problem description. Now a second check (`vagueGateVerified`) re-evaluates the user's response. If the follow-up is still vague (e.g. "yeah it's just not right"), the system asks one more targeted question before progressing. Capped at two rounds to avoid looping.

### 2. System-offered ticket creation now routes through summary review
When `offeredTicketCreation` was accepted (e.g. after handoff threshold), the system previously called `forceHandoff` directly, bypassing summary review. Now acceptance routes through `buildSummaryCard` so the customer sees and confirms what will be submitted before a ticket is created.

### 3. Subject generation improvements
- Conversational fragments (yes/no/thanks/hi) and short account-name-only lines are now filtered out when selecting the issue-focused sentence for the subject.
- When the selected sentence doesn't clearly indicate the problem domain, the subcategory name is prepended for context (e.g. `[Portal] Login / password — the error says my account is locked`).

### 4. Description quality in summary card
- Lines that duplicate the account name or affected person email (already shown in dedicated fields) are stripped from the description display.
- Near-identical lines from multi-turn accumulation are deduplicated.

### 5. Account-field regression prevention
- The short-answer account-name fallback now checks `justAskedVagueGate` — when the vague gate was just asked, the user's response is a problem description, not an account name.
- The conversational-content rejection list was expanded to include common problem-description words (showing, display, error, missing, page, update, change, fix, login, password, access, photo, image, listing) that should not be captured as account names.

## What's Not Changed
- Phase 1 behaviour preserved (all routing, category detection, field extraction unchanged).
- Earlier Phase 2 gains preserved: conversational activation, hidden routing, natural clarification, stable non-looping failure handling, property-question narrowing, summary rendering, natural summary confirmation recognition, working summary edits, improved account extraction, improved bundled URL capture.

## Uncertainties / Risks
- The second vague-gate round uses the same `descriptionLacksActionableDetail` function — if a user's second response is borderline (e.g. mentions a specific target like "property" but no concrete symptom), the function allows it through. This is intentional: the function already checks for specific-target nouns.
- The system-offer → summary routing change means customers who previously got instant ticket creation now see one more step. This is the desired behaviour per the spec but is a perceptible UX change.
