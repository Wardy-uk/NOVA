# Iter 39 — Replay Specificity Hardening

**Status:** Ready for evaluation  
**Date:** 2026-05-28  
**File changed:** `src/server/services/portal-chat.ts`

## What changed

### 1. LLM prompt — domain-specific next-question guidance (section 9)
- Added **ANTI-REDUNDANCY RULE**: if the customer already named their website, account, URL, company, portal, or CRM, don't re-ask for it.
- Added **DOMAIN-SPECIFIC NEXT QUESTION GUIDANCE** for property, feed/integration, website, and account — instructs the LLM to ask the most operationally useful next question for each domain rather than a generic clarification.

### 2. New `buildFeedFollowUp()` method
- Dedicated follow-up builder for feed/integration cases with subcategory-aware questions:
  - `feeds_property`: asks what's not coming through (specific properties, all listings, certain details)
  - `feeds_reporting`: asks which report/dashboard is affected
  - `feeds_integration` (default): asks what's not syncing and when it started
- Replaces generic `buildConversationalQuestion` / "Which account is this for?" in feed routing paths.

### 3. Property fallback specificity
- All property fallback paths (high-confidence no-subcategory, moderate-confidence, `handlePropertyFallback`, vague signal) now use `getPropertyMissingFields()` → `buildPropertyFollowUp()` instead of hardcoded generic questions like "Could you tell me which property is affected and where you're seeing the issue?"
- This means if description is already present, the system asks for `propertyIdentifier` or `affectedPortals` directly rather than a broad "tell me more".

### 4. Account fallback specificity
- High-confidence account (no subcategory), moderate-confidence account, `handleAccountFallback`, and vague account signal paths now use `getAccountMissingFields()` → `buildAccountFollowUp()` instead of generic "Could you tell me a bit more about what's happening?"
- If description already exists, system asks for the next operationally useful field (affected person, office/branch, account name).

### 5. Website vague-signal improvement
- Vague website signal with a detected subcategory now checks missing fields and asks the subcategory-specific question.
- When a URL is already present, asks "Could you describe what needs to happen on this page?" instead of the binary "is something not displaying correctly, or do you need content updated?"

### 6. Feed routing blocks updated
- Both deterministic and vague feed signal paths now use `buildFeedFollowUp()` for operationally relevant questions.
- Vague feed path checks whether account/description already exist before choosing which field to ask about.

## What was preserved
- All fallback-routing protection (category picker is still last resort)
- Email marketing separation (deterministic confirmation gates unchanged)
- Session/summary-card flow (no changes)
- KB retrieval and auth/login paths (no changes)
- All security-sensitive fast-tracks (unchanged)
- Existing `buildPropertyFollowUp` and `buildAccountFollowUp` templates (only their usage was expanded)

## Nothing blocked or uncertain
- TypeScript compiles cleanly (`tsc --noEmit` passes)
- No new dependencies or schema changes
- All changes are in the first-turn response selection logic; no routing classification changes
