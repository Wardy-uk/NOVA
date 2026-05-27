# Iteration 29 — Confluence KB Retrieval Alignment

**Status:** Ready for evaluation
**Date:** 2026-05-27

## What Changed

### 1. Portal KB sync expanded to full space (`portal-kb.ts`)

**Problem:** Sync only fetched direct children of `kb_confluence_parent_page_id`. Articles elsewhere in the NT space (e.g. "archive leads", "unsubscribe") were invisible to portal search.

**Fix:** `syncFromConfluence()` now:
- Still fetches child pages of the parent page (backwards compat)
- Additionally runs a CQL search (`space = "NT" AND type = "page"`) to pick up all pages in the space
- Deduplicates by page ID so nothing is double-inserted
- No longer requires `kb_confluence_parent_page_id` to be set — falls back to full-space sync
- Reads space key from `kb_confluence_space` OR first key in `kb_confluence_space_keys` OR defaults to `NT`
- Consolidated credential resolution into `getConfluenceAuth()` to share across methods

### 2. Portal chat live Confluence fallback (`portal-chat.ts`)

**Problem:** `searchKb()` only searched the local `portal_kb_articles` table. If an article hadn't been synced yet, it returned nothing.

**Fix:** When local table search returns zero results, `searchKb()` now falls back to a live Confluence CQL search (`text ~ "terms" AND space = "NT"`) and returns the top 3 results. This means known-answer cases work immediately, even before the next sync cycle.

### 3. Reasoner Confluence search aligned (`reasoner.ts`)

**Problem:** `searchConfluence()` only used `kb_confluence_space_keys`, which may not include the portal's `kb_confluence_space` (NT). The two surfaces could search different spaces.

**Fix:** `searchConfluence()` now merges space keys from both `kb_confluence_space_keys` and `kb_confluence_space` into a single deduplicated set. Defaults to `NT` if neither is configured.

## Build

TypeScript compilation passes (exit code 0).

## What's Still Uncertain

- The fix assumes "archive leads" and "unsubscribe" articles exist as pages in the Confluence NT space. If they're in a different space, the `kb_confluence_space` or `kb_confluence_space_keys` setting needs updating.
- Full-space CQL sync caps at 500 pages to avoid excessive API calls. If NT has more than 500 pages, some may be missed — but this is unlikely for a KB space.

## Scope

All changes are local to KB retrieval and article-grounded search. No ticket routing, portal taxonomy, or UI changes.
