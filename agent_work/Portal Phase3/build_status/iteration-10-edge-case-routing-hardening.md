# Iteration 10 — Edge-Case Routing Final Hardening

**Status:** Ready for evaluation
**Date:** 2026-05-25
**File changed:** `src/server/services/portal-chat.ts`

## What Changed

Three targeted fixes in `portal-chat.ts`, all local to the routing precedence logic:

### Fix 1: Follow-up "NT-XXXXX is not fixed" now deterministic (lines ~1318-1352)

**Problem:** The ESCALATION_CHASE_PATTERNS check ran at line 1583, AFTER LLM-driven domain routing (website/property/account at lines 1339-1502). When a customer wrote "NT-12345 is not fixed", the LLM could inconsistently classify it as belonging to a domain, stealing it before follow-up detection ran.

**Change:** Added a deterministic follow-up gate BEFORE the LLM domain routing. When the message contains a Jira ticket reference (`NT-xxx` or `NTPJ-xxx`) AND matches ESCALATION_CHASE_PATTERNS, it routes to `followup_not_resolved` immediately — including Jira cache lookup for ticket context. This runs before letters, website, property, or account routing.

### Fix 2: Letters precedence gate guarded against website-primary requests (lines ~1353, 1796)

**Problem:** The letters precedence gate fired on ANY letter signal (e.g. "letter", "correspondence"), even when the message was primarily about a website (e.g. "the lettering on our website needs updating").

**Change:** Added a guard: `!hasExplicitWebsiteWords` — when the message contains explicit website vocabulary (`website`, `our site`, `homepage`, etc.), the letters gate is skipped and the request falls through to website routing. Applied in both the LLM path and the no-LLM fallback path.

### Fix 3: Property detection guarded for website-content context (lines ~522-530)

**Problem:** `detectPropertyFromKeywords` matched `\bproperty\b` broadly, so "property images on my website are not loading" triggered property routing instead of website.

**Change:** Added an early exit in `detectPropertyFromKeywords`: when explicit website context is present (`website`, `our site`, `my site`, etc.) AND no portal-listing signals exist (`rightmove`, `zoopla`, `listing`, `feed`, etc.), the bare word "property" is treated as website content and property detection returns false.

## Regression Risk

- **Low.** All three changes are additive guards that narrow existing paths, not widen them.
- Letters-primary requests without website words are unaffected.
- Property-listing requests with portal vocabulary (rightmove, zoopla, listings, feed) are unaffected.
- Follow-up without a ticket reference still handled by the existing check at its original position.
- Protected domains (complaint, account, email template) untouched.

## Nothing Blocked or Uncertain

All three fixes are self-contained. No shared-config, complaint metadata, or broad redesign work required.
