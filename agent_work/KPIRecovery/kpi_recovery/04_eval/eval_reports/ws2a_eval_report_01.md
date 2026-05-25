# WS2-A Evaluation Report: Escalation & Rejection KPI Recovery

**Evaluator:** Claude (independent behavioural evaluation)  
**Date:** 2026-05-21  
**Build Under Evaluation:** KF-011 (escalation pipeline fix, loop 02)  
**Verdict:** QUALIFIED PASS

---

## Evaluation Method

No source code was inspected. All evidence was gathered by querying the live Azure SQL databases (`techservicesjsm` for KPI snapshots, NOVA main DB for `escalation_log`) on 2026-05-21 at approximately 16:00 UTC.

---

## EV-WS2A-1 — Non-zero behaviour restored

**Result: PASS**

The escalation/rejection KPI family is no longer trapped in an all-zero state. Today's `jira_kpi_daily` snapshot contains:

| KPI | Value |
|-----|-------|
| Tickets escalated to Tier 2 | 9 |
| Tickets escalated to Tier 3 | 1 |
| Tickets escalated to Development | 3 |
| Tickets rejected by Tier 3 | 2 |
| Tickets rejected by Tier 2 | 0 |
| Tickets rejected by Development | 0 |
| Escalation Accuracy % | 85 |

The `escalation_log` table now contains **1,254 entries** across three sources:

| Source | Count |
|--------|-------|
| jira_backfill | 1,201 |
| nova_ai | 46 |
| jira_sync | 7 |

Daily entry counts for the past 7 days:

| Date | Entries |
|------|---------|
| 2026-05-21 (partial day) | 15 |
| 2026-05-20 | 41 |
| 2026-05-19 | 65 |
| 2026-05-18 | 58 |
| 2026-05-16 | 1 |
| 2026-05-15 | 38 |
| 2026-05-14 | 37 |

**Note:** Despite the escalation_log containing entries for May 18-20, the `jira_kpi_daily` snapshot recorded 0 for all escalation KPIs on those dates. This implies the KPI pipeline either was not running or was not reading from the populated table during that window. Today's non-zero output confirms the pipeline is now connected and functioning.

---

## EV-WS2A-2 — Rejection behaviour exists

**Result: QUALIFIED PASS**

Downward tier changes are now recorded in the `escalation_log`. Today's snapshot shows `Tickets rejected by Tier 3 = 2`. Database queries confirm concrete rejection-pattern entries:

- T3 → T2 transitions (2 entries today via `jira_sync`)
- Development → Customer Care transitions (via backfill)
- Production → Customer Care transitions (via backfill)
- T3 → Customer Care transitions (via backfill)

**Qualification:** `Tickets rejected by Tier 2` and `Tickets rejected by Development` are 0 today. This is plausible (not every tier rejects on every day), but the sample is too thin (one day of live data) to confirm these specific sub-KPIs are wired correctly. A second evaluation after 5+ business days of accumulation would strengthen confidence.

**Data quality gap:** 46 `nova_ai` source entries have `NULL` in `from_tier`. These entries route tickets to Customer Care but do not record the originating tier. This means AI-driven rejections/de-escalations are partially invisible to the rejection KPI queries, which filter on `from_tier IN ('T2', 'Tier 2')` etc. This is a non-blocking data quality issue — the core pipeline works, but AI-originated tier changes are under-counted.

---

## EV-WS2A-3 — Escalation Accuracy % is no longer defaulting falsely

**Result: PASS**

Today's Escalation Accuracy % = **85%**, which is plausibly derived from the observed data: 13 total escalations, 2 rejections → `(13 - 2) / 13 * 100 = 84.6%`, rounding to 85.

On May 18-20, the metric was 100% — but this coincided with 0 escalation counts in the KPI snapshot (not in the log table). The 100% on those days was the `totalEsc = 0` default, not a real calculation. Today is the first day where the metric is driven by live activity.

The false-100% default still exists in the code path (when no escalations are recorded), but this is now a transient edge case (weekends, holidays) rather than a permanent structural failure.

---

## EV-WS2A-4 — No regression to trusted slices

**Result: PASS**

### WS1 — Development backlog count

| Date | Number of Tickets in Development |
|------|----------------------------------|
| 2026-05-21 | 233 |
| 2026-05-20 | 230 |
| 2026-05-19 | 275 |
| 2026-05-18 | 258 |

Stable within expected range. No regression.

### WS5 — Breach board / SLA KPIs

Spot-checked 20 SLA-related KPIs across all tiers for today. All are emitting non-zero, plausible values:

- CC (TPJ) FRT breached (actionable): 4
- CC Incidents over SLA (actionable): 4
- CC Service Requests FRT breached (actionable): 6
- Development FRT breached (actionable): 30
- Development over SLA (actionable): 14
- FRT Breaches (Resolved Today): 7

No zeroing, no false-100%, no missing tiers. WS5 behaviour is consistent with prior evaluation (ws5a_eval_report_01, ws5b_eval_report_01).

---

## Qualifications Summary

| # | Issue | Severity | Blocking? |
|---|-------|----------|-----------|
| Q1 | Only 1 day of live KPI pipeline output — May 18-20 gap between log population and KPI emission | Low | No — today's output confirms wiring is correct |
| Q2 | `nova_ai` entries (46) have NULL `from_tier`, making AI-driven rejections invisible to rejection KPIs | Low | No — core Jira-sourced pipeline is unaffected |
| Q3 | `jira_sync` source has only 7 entries — live detection is very new; bulk of data is from backfill | Informational | No — volume will grow naturally with each sync cycle |
| Q4 | `Tickets rejected by Tier 2` and `Tickets rejected by Development` are 0 today — plausible but unverified | Low | No — needs 5+ business days to confirm |

None of the qualifications are blocking. All relate to sample size (too early to confirm every sub-KPI) or minor data quality issues in a secondary source (`nova_ai`).

---

## Verdict

**QUALIFIED PASS**

The WS2-A escalation and rejection KPI family has been recovered from a structurally zeroed state to live, plausibly derived values. The `escalation_log` is being populated via both backfill (1,201 entries) and live Jira sync (7 entries and growing). Escalation Accuracy % is now calculated from real activity (85%) rather than defaulting to 100%. No regression was observed in WS1 or WS5 trusted slices.

Recommend re-evaluation after 5 business days to confirm all 6 count sub-KPIs have produced non-zero values at least once, and to verify the May 18-20 KPI emission gap does not recur.

---

## Evidence Index

| Evidence | Source |
|----------|--------|
| KPI daily snapshot (escalation family) | `jira_kpi_daily WHERE kpi_name LIKE '%escalat%' OR '%reject%' OR '%accuracy%'` |
| Escalation log entries | `escalation_log ORDER BY created_at DESC` |
| Escalation log daily counts | `escalation_log GROUP BY CAST(created_at AS DATE)` |
| Rejection entries (downward tier) | `escalation_log WHERE to_tier IN downward-tier set` |
| Source breakdown | `escalation_log GROUP BY source` |
| WS1 regression check | `jira_kpi_daily WHERE kpi_name = 'Number of Tickets in Development'` |
| WS5 regression check | `jira_kpi_daily WHERE kpi_name LIKE '%breach%' OR '%SLA%'` |
| Build report context | `ws2a_escalation_rejection_validation_report_loop01.md` |
| Fix report context | `ws2a_escalation_pipeline_fix_report_loop02.md` |
