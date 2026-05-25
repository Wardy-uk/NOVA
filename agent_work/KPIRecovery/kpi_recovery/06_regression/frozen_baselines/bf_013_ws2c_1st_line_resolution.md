# BF-013: 1st Line Resolution Rate % (Tier-Based) Baseline

**Frozen:** 2026-05-21
**Workstream:** WS2-C (Derived KPI formula corrections)
**Source Evidence:** ws2c_1st_line_eval_report_01.md (EV-WS2C-5 through EV-WS2C-8), ws2c_1st_line_runtime_verification_report_loop06.md

---

## Protected Invariant

The `1st Line Resolution Rate %` metric must use **tier-based classification** (`classifyTier(current_tier) === 'Customer Care'`), NOT request-type composition (`ccRequestTypes` array membership). Pre-fix, the formula counted tickets with CC request types (incident, chat, etc.) as the numerator — this measured request-type share, not resolution behaviour. Post-fix, the numerator counts tickets resolved at Customer Care tier without escalation beyond first line.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| 1st Line Resolution Rate % | 43 | jira_kpi_daily 2026-05-21 |
| Target | 60 | KPI target definition |
| RAG | 3 (amber) | Derived from value vs target |
| Tickets Solved Today (denominator proxy) | 16 | jira_kpi_daily 2026-05-21 (Volume group) |
| Implied 1st-line numerator | ~7 | 43% of 16 |
| Total KPI groups | 15 | Full pipeline inventory |
| Total KPI metrics | 77-78 | Full pipeline inventory |
| Derived group completeness | 4/4 | 1st Line, CSAT Derived, FCR, Bug Ack |

## What Changed

| Aspect | Old (Broken) | New (Correct) |
|--------|-------------|---------------|
| Numerator logic | `ccRequestTypes.includes(r.request_type?.toLowerCase())` | `classifyTier(r.current_tier) === 'Customer Care'` |
| Code location | kpi-pipeline.ts:749 | kpi-pipeline.ts:749 |
| Semantic meaning | % of resolved tickets with CC request types | % of resolved tickets at Customer Care tier |
| Helper function | N/A | `classifyTier()` at kpi-pipeline.ts:94-98 using `TIER_MAP` at line 86-92 |

## Regression Checks

**RC-013a:** `1st Line Resolution Rate %` must exist in today's KPI data with `kpi_group = 'Derived'`. Catches deletion or group reassignment.

**RC-013b:** The formula must NOT regress to request-type-based counting. Verified by checking that the code at kpi-pipeline.ts:749 contains `classifyTier` and NOT `ccRequestTypes.includes` in the 1st Line numerator assignment.

**RC-013c:** `classifyTier()` function must exist and map `'customer care'` → `'Customer Care'`. Catches removal or corruption of the tier classification function.

**RC-013d:** All 4 derived KPIs must be present in today's data (1st Line Resolution Rate %, CSAT % Derived, FCR Rate %, Bug Escalation-to-Ack). Catches derived pipeline execution failure.

**RC-013e:** No regression to trusted WS1/WS2-A/WS5 families — at least 5 WS1 metrics, 3 escalation metrics, and 3 SLA metrics must be present and non-null for today.

## Freeze Conditions

- Deployed commit: WS2-C-FIX-02 (tier-based 1st Line formula)
- Fix location: `kpi-pipeline.ts:749` — `resolvedRows.filter(r => classifyTier(r.current_tier) === 'Customer Care').length`
- Tier classifier: `classifyTier()` at `kpi-pipeline.ts:94-98`, `TIER_MAP` at `kpi-pipeline.ts:86-92`
- ccRequestTypes array retained at line 747 for FCR calculation (not orphaned)
- Known remaining defect: `jira_updated` date filter (line 743) — shared with Solved Today, out of scope for this fix
