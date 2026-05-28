# Iteration 38 — KB Retrieval Quality Hardening

**Status:** Ready for evaluation  
**Date:** 2026-05-28

## What changed

### New file: `src/server/services/kb-search-utils.ts`
Shared utilities for KB search quality:
- **Synonym expansion** — 18 synonym groups covering common proptech/support vocabulary (website↔site, login↔password, down↔outage, setup↔onboarding, etc.). Bridges the gap between customer phrasing and article terminology.
- **Stop-word filtering** — removes noise words (the, and, please, help, working, etc.) before search, so queries like "help my website is not working" focus on "website" not "help".
- **Relevance scoring** — scores each result by term overlap: title hits weighted 5x, body hits 1x, synonym-expanded hits weighted lower (2x title / 0.5x body). Bonus for exact phrase match in title (+8) and all-terms-matched (+3).
- **Threshold filtering** — single-term queries need score ≥1; multi-term queries need score ≥2. Prevents single-word noise matches from appearing.
- **`rankAndFilter()`** — generic re-ranker that scores a candidate set, filters by threshold, sorts by relevance, and caps output.

### Modified: `src/server/services/portal-kb.ts`
- `search()` now uses `cleanSearchTerms` + `expandSearchTerms` to broaden the SQL candidate pool (searches with synonyms included).
- Removed `ORDER BY (helpful_yes - helpful_no) DESC, view_count DESC` from SQL — ordering now happens in JS via relevance scoring.
- Fetches TOP 40 candidates (up from 20) to give the re-ranker a wider pool, then filters and returns top 10.
- Exact-keyword cases remain stable because direct term matches score highest.

### Modified: `src/server/services/portal-chat.ts`
- `searchKb()` now uses synonym expansion and relevance scoring instead of raw LIKE + `ORDER BY view_count DESC`.
- Fetches TOP 15 candidates, re-ranks, returns top 3.
- `searchConfluenceLive()` now fetches 8 results from Confluence (up from 3), scores them with the same ranker, and returns the top 3. Previously returned whatever Confluence returned in recency order.
- Both methods now accept and use the expanded term set, so the Confluence CQL fallback also benefits from vocabulary broadening.

## How each concern is addressed

| Concern | Before | After |
|---------|--------|-------|
| Relevance ranking | view_count / helpful_score ordering | Term-overlap scoring with title weighting, phrase bonus |
| Fallback noise | OR-match returns any single-word hit | Threshold filter requires multi-term overlap |
| Vocabulary mismatch | Exact keyword only | 18 synonym groups expand search terms |
| Exact-keyword stability | Works | Still works — direct matches score highest |

## Not blocked

All changes are self-contained in the retrieval layer. No schema changes, no auth changes, no UI changes needed. TypeScript compiles clean.

## Uncertainty

- The synonym groups are a starting point based on common support vocabulary. They may need tuning after observing real portal queries — too-aggressive synonyms could reintroduce noise. The groups are easy to extend or trim in `kb-search-utils.ts`.
- The scoring weights (5/2/1/0.5 and bonuses) are reasonable defaults but may benefit from tuning against real query logs once available.
