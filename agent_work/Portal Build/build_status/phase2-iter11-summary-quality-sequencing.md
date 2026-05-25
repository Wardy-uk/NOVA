# Phase 2 Iteration 11 — Summary Quality and Sequencing Hardening

**Status:** Ready for evaluation  
**Date:** 2026-05-22  
**File changed:** `src/server/services/portal-chat.ts`

## What Changed

### 1. Broader vague-gate detection
`descriptionLacksActionableDetail()` now catches purely abstract problem statements like "I'm having an issue", "something is wrong", "we've got a problem", "things aren't working" — phrasing that contains a keyword (e.g. "wrong") but no specific noun/target identifying *what* is wrong. These are gated and the user is asked what specifically is happening. Phrases that include a concrete target noun (e.g. "something is wrong with our listing") pass through as before.

### 2. Issue-focused subject generation
Subject auto-generation now skips vague openers ("I'm having an issue with...", "Hi I need help with...") and selects the most issue-specific line from the accumulated description. Long sentences are trimmed at a natural clause break rather than mid-word. This produces subjects like `[Portal] The phone number on our contact page shows 0161 555 1234 instead of...` rather than `[Portal] I'm having an issue with something on our website`.

### 3. Cleaner description in summary card
The summary card description now filters out short conversational fragments that were appended verbatim during multi-turn detail gathering — lines like "yes", "thanks", "that's correct", "ok" are stripped from the displayed description. Substantive lines are preserved.

### 4. Summary-before-submission for early ticket requests
When a customer says "raise a ticket", "create a ticket", "log a case" etc. during the detail stage before summary has been shown, the system now extracts any fields from that message and presents the summary card for review — instead of bypassing summary and going straight to force-handoff submission.

### 5. URL capture on every message
URL extraction (`extractUrlFromText`) now runs in `processStage` on every incoming message regardless of stage, so URLs bundled with ticket-request language or conversational responses are never missed. This supplements the existing per-stage extraction and closes the gap where URLs in "please raise a ticket for https://..." messages were not captured.

## What's preserved
- All Phase 1 behaviour (routing, classification, Jira submission, category picker fallback)
- Phase 2 gains: conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, summary rendering, natural summary confirmation, working summary edits, improved account extraction

## Nothing blocked or uncertain
All five changes are narrow and local. TypeScript compiles cleanly.
