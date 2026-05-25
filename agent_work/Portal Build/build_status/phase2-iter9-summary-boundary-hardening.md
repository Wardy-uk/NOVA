# Phase 2 — Iteration 9: Summary-Boundary Quality Hardening

**Date:** 2026-05-22
**Status:** Ready for evaluation

## What Changed

Three targeted fixes in `src/server/services/portal-chat.ts` and one type addition in `src/shared/portal-types.ts`:

### 1. Summary-stage confirmation recognition (Fix 1)

Expanded `isAffirmativeResponse()` to catch natural confirmation phrases at summary stage:
- Added: "that looks right/correct/good", "looks good/correct/right", "that's correct/right", "all good", "confirmed", "perfect", "no changes", "please submit"
- Previously only "yes", "go ahead", "submit it", "create ticket" etc. were recognised
- Also fixed: after submission failure at summary stage, session now transitions to `confirmed` stage so the conversation ends cleanly instead of looping

### 2. Vague-journey premature summary gate (Fix 2)

Added a readiness check in `handleDetailStage` before allowing progression to summary when `category === 'other'`:
- If the accumulated description is short (< 100 chars after stripping greetings) AND lacks specific actionable keywords, the system asks "Could you describe the issue in a bit more detail?" instead of jumping to summary
- Gate fires once per session (`vagueGateAsked` flag on `IntakeSessionMetadata`)
- Added `vagueGateAsked?: boolean` to `IntakeSessionMetadata` interface

### 3. Account extraction cleanup (Fix 3)

Added `cleanAccountName()` function applied at all account-extraction points (LLM intake, LLM field extraction, regex extraction, short-answer fallback):
- Strips wrapping phrases: "on our website, the X site" → X, "on the X website" → X, "for X" → X, "we're X" → X, "it's at X" → X
- Also tightened the short-answer fallback to reject complaint-like text ("something", "wrong", "broken", "not working", "help", "trouble" etc.) from being captured as account names

## Files Modified

- `src/server/services/portal-chat.ts` — all three fixes
- `src/shared/portal-types.ts` — added `vagueGateAsked` to `IntakeSessionMetadata`

## Verified Behaviours

| Test | Result |
|------|--------|
| "That looks right, please submit" at summary stage | Triggers submission attempt (Jira unavailable, but confirmation recognised) |
| "That's correct, submit it" at summary stage | Triggers submission attempt |
| "All good, please submit" at summary stage | Triggers submission attempt |
| Post-failure: "OK thanks" | "This conversation has already been completed" (clean end) |
| "Hello" + "Something's wrong with our account" | Asks for more detail instead of jumping to summary |
| "Hello" + "I have a problem" | Asks for more detail instead of jumping to summary |
| "Hello" + vague + "Can't log in, password expired" | Reclassifies to account/login, continues gathering |
| "on our main website, the BriefYourMarket site" | Account: "BriefYourMarket" |
| "on the Anderson Estate Agents website" | Account: "Anderson Estate Agents" |
| Site-wide issue (all Rightmove listings) | No property question — preserved |
| Non-property issue (email campaign) | No property question — preserved |
| Property-specific (42 Elm Street, wrong photos) | Efficient 2-turn summary — preserved |

## Still Blocked / Uncertain

- **Jira ticket creation** remains unavailable (`jira_ob_enabled=false`). Submission attempts fail with a clear message and clean session end — the flow is correct but actual ticket creation cannot be verified until Jira is configured.
- **Widget route accessibility**: `/api/portal/widget/*` routes are still intercepted by `portalAuth` middleware on `/api/portal`. Only codex-test-login works for API testing.
- **Description accumulation**: All user messages are still appended verbatim to the description field, including retry requests and corrections. This is a separate quality concern not addressed in this slice.
