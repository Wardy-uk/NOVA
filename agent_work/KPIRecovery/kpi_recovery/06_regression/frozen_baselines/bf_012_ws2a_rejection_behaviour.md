# BF-012: Rejection Behaviour Baseline

**Frozen:** 2026-05-21
**Workstream:** WS2-A (Escalation and rejection KPI recovery)
**Source Evidence:** ws2a_eval_report_01.md (EV-WS2A-2), ws2a_escalation_pipeline_fix_report_loop02.md (KF-011)

---

## Protected Invariant

The `escalation_log` must contain downward tier-change entries (rejections). Pre-fix, `backfillFromChangelog()` applied an upward-only filter that silently discarded all rejection events. Post-fix (KF-011), the filter was removed — both escalations (upward) and rejections (downward) are now recorded.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Downward tier-change entries (all time) | 148 | Live NOVA DB 2026-05-21 |
| Rejected by Tier 3 (today's KPI) | 2 | jira_kpi_daily 2026-05-21 |
| Rejected by Tier 2 (today's KPI) | 0 | jira_kpi_daily 2026-05-21 |
| Rejected by Development (today's KPI) | 0 | jira_kpi_daily 2026-05-21 |
| Escalation Accuracy % (today) | 85% | jira_kpi_daily 2026-05-21 |

## Observed Rejection Patterns at Freeze

- T3 -> T2 transitions (via jira_sync)
- Development -> Customer Care (via backfill)
- Production -> Customer Care (via backfill)
- T3 -> Customer Care (via backfill)

## Regression Checks

**RC-012:** Downward tier-change entry count (all time) must be > 0. Catches regression to the upward-only filter state.

**RC-013:** When `totalEsc > 0`, Escalation Accuracy % must not be exactly 100%. This catches the false-100% default that occurs when the denominator is zero (no escalation data). Today: 85% with 13 escalations and 2 rejections — `(13-2)/13 * 100 = 84.6%`, rounded to 85.

## Qualifications

- `Tickets rejected by Tier 2` and `Tickets rejected by Development` are 0 today — plausible (not every tier rejects every day) but thin sample. Re-evaluate after 5 business days.
- 46 `nova_ai` entries have NULL `from_tier`, making AI-driven rejections invisible to rejection KPIs. Non-blocking.

## Freeze Conditions

- Deployed commits: `8e35c0e` (KF-011), `459cd17` (Current Tier backfill)
- Fix: removed `tierRank` upward-only filter in `backfillFromChangelog()`
- Tier vocabulary: queries match both abbreviated (`T2`, `T3`, `Dev`) and full (`Tier 2`, `Tier 3`, `Development`) forms
