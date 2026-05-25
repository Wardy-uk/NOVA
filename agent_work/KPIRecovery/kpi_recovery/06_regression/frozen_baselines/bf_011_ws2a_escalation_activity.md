# BF-011: Non-Zero Escalation Activity Baseline

**Frozen:** 2026-05-21
**Workstream:** WS2-A (Escalation and rejection KPI recovery)
**Source Evidence:** ws2a_eval_report_01.md (EV-WS2A-1), ws2a_escalation_pipeline_fix_report_loop02.md (KF-011)

---

## Protected Invariant

The `escalation_log` table must contain recent entries (within last 3 days). Pre-fix, the escalation pipeline was structurally disconnected — no tier-change events were being recorded from Jira sync, resulting in all-zero escalation KPIs. Post-fix (KF-011), `jira-sync-service.ts` detects tier changes on every sync cycle and writes them to `escalation_log`.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| escalation_log entries (last 3 days) | 173 | Live NOVA DB 2026-05-21 |
| Total escalation_log entries | 1,255 | Live NOVA DB 2026-05-21 |
| Source: jira_backfill | 1,201 | Historical backfill |
| Source: nova_ai | 46 | AI agent decisions |
| Source: jira_sync | 8 | Live sync detection |
| Escalated to Tier 2 (today) | 9 | jira_kpi_daily 2026-05-21 |
| Escalated to Tier 3 (today) | 1 | jira_kpi_daily 2026-05-21 |
| Escalated to Development (today) | 3 | jira_kpi_daily 2026-05-21 |

## Regression Check

**RC-011:** `escalation_log` must have > 0 entries created within the last 3 days. This catches regression to the disconnected state where no tier-change events flow from Jira sync into the log table. The 3-day window accommodates weekends.

## Freeze Conditions

- Deployed commits: `8e35c0e` (KF-011 escalation pipeline), `459cd17` (Current Tier backfill fix)
- Fix location: `upsertIssue()` in `jira-sync-service.ts` — tier-change detection after MERGE
- Backfill location: `backfillFromChangelog()` in `escalation-log-service.ts` — bidirectional recording
- KPI calculation: `collectEscalationKpis()` in `kpi-pipeline.ts`
