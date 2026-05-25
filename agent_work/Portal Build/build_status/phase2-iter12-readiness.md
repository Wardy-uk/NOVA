# Phase 2 Iteration 12 — Build Status

**Slice:** Deep summary-quality and sequencing hardening
**Status:** Ready for evaluation
**Date:** 2026-05-23

## What Changed

### 1. Stricter vague follow-up verification
Added `followUpLacksConcreteProblem()` — a stricter check used specifically for the vague gate follow-up. Unlike `descriptionLacksActionableDetail()` which accepts any domain noun (page, listing, etc.), this requires an actual problem/action indicator (wrong, missing, not working, update, change, etc.). A message like "it's about our website" no longer passes the gate; "the phone number on our website is wrong" does.

### 2. Consistent issue-focused subjects
Changed subject generation in `buildSummaryCard` to ALWAYS lead with the subcategory name (e.g., "Content update", "Missing listing") when available. Previously it only prepended subcategory when the issue text lacked focus keywords, leading to inconsistent subjects. Now all conversational-path subjects follow the pattern `[Portal] {Subcategory} — {issue detail}`.

### 3. Cleaner description quality
Enhanced description cleanup in summary card rendering:
- Filters out lines that duplicate already-displayed summary fields (browser, URL, person name, office/branch)
- Drops very short lines (<20 chars) that lack problem-related keywords — these are typically bare field answers (account names, portal names) rather than problem descriptions
- Combined with existing deduplication and conversational-fragment filtering

### 4. Account-field protection against misassignment
Three layers of defence:
- **`isLikelyAccountName()` validator** — rejects values that contain problem-description language ("not working", "broken", "need help") or start with first-person/article words. Applied in both LLM extraction paths (intent and detail-stage field extraction).
- **Other-field collision guard** — short-answer account capture now checks if the text matches an already-extracted portal name, property address, office/branch, or person name before accepting it as account.
- **Existing vague-gate guard preserved** — the `justAskedVagueGate` guard continues to prevent capture during the active vague-gate phase.

### 5. System-offer → summary review path
Verified that the existing `offeredTicketCreation` flag correctly routes through `buildSummaryCard` (summary review) when the user accepts a system-offered ticket creation prompt (lines 767-778). No code change needed — the path was already correct. The force-handoff path (max exchanges) is a separate mechanism that bypasses summary by design.

## Files Modified
- `src/server/services/portal-chat.ts` — all changes in this file

## Nothing Blocked
All changes are local to portal-chat.ts. No schema changes, no new dependencies, no client-side changes required. TypeScript compiles cleanly.

## Preserved Behaviours
- Phase 1 behaviour: untouched (category picker, form submission, KB deflection)
- Phase 2 gains: conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, summary rendering, natural summary confirmation, working summary edits, improved bundled URL capture — all preserved
