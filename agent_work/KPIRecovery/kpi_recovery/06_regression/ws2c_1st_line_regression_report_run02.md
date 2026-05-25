# WS2-C 1st Line Resolution Rate % — Regression Report Run 02

**Date:** 2026-05-21
**Baseline:** BF-013 (frozen 2026-05-21)
**Script:** `ws2c_1st_line_regression_check.mjs`
**KPI DB:** bym-asqlep01.database.windows.net / TechSupportJSM
**Latest KPI date in DB:** 2026-05-21

---

## Results

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| RC-013a | 1st Line exists in Derived group | **PASS** | 1st Line Resolution Rate % = 43 in group 'Derived' |
| RC-013b | Tier-based formula in code | **PASS** | Formula uses classifyTier(), not ccRequestTypes — correct |
| RC-013c | classifyTier exists & correct | **PASS** | classifyTier() exists, TIER_MAP maps customer care → Customer Care |
| RC-013d | All 4 derived KPIs present | **PASS** | 1st Line Resolution Rate %, Bug Escalation-to-Ack (hours), CSAT % (Derived), FCR Rate % |
| RC-013e | Trusted family cross-check | **PASS** | WS1: 5/5, Escalation: 3/3, SLA: 5/3 |

**OVERALL: PASS (5/5)**

---

## Drift from Baseline

| Metric | Baseline (freeze) | Run 02 | Drift |
|--------|-------------------|--------|-------|
| 1st Line Resolution Rate % | 43 | 43 | None |
| Tickets Solved Today | 16 | 17 | +1 (normal daily variance) |
| Derived KPI count | 4/4 | 4/4 | None |

No meaningful drift detected. Value change in Tickets Solved Today is expected intra-day variance.

---

## Derived KPI Snapshot

| KPI | Value |
|-----|-------|
| 1st Line Resolution Rate % | 43 |
| Bug Escalation-to-Ack (hours) | 0 |
| CSAT % (Derived) | 0 |
| FCR Rate % | 47 |

## Trusted Family Snapshot

| Group | KPI | Value |
|-------|-----|-------|
| Escalations | Tickets escalated to Development | 4 |
| Escalations | Tickets escalated to Tier 2 | 14 |
| Escalations | Tickets escalated to Tier 3 | 2 |
| Queue | Open Tickets | 481 |
| Queue | Unassigned | 123 |
| Queue | Waiting on Requestor | 48 |
| SLA | FRT Compliance % (Open Queue) | 70 |
| SLA | FRT Compliance % (Resolved Today) | 41 |
| SLA | Resolution Compliance % (Open Queue) | 80 |
| SLA | Resolution Compliance % (Resolved Today) | 94 |
| SLA | SLA Breached | 98 |
| Volume | New Tickets Today | 70 |
| Volume | Tickets Solved Today | 17 |

---

## Verdict

**CLEAN — counts toward TRUSTED.** All 5 regression checks passed with no drift from baseline invariants. The tier-based formula remains intact in code, all derived KPIs are present, and trusted families are unaffected.
