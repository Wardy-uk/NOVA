# BF-003: FRT Recovery Baseline

**Frozen:** 2026-05-20
**Sub-Slice:** WS1-C
**Source Evidence:** ws1_runtime_verification_post_deploy.md, ws1_eval_report_01.md

---

## Protected Invariant

FRT compliance must remain non-trivial (not 100%). `customfield_14046` must remain in ALL_FIELDS. Per-tier FRT breach counts must be non-zero for at least some tiers.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| FRT Compliance % (Open Queue) | 68% | Post-deploy runtime verification |
| FRT Compliance % (Resolved Today) | 59% | Runtime verification |
| FRT field source | `customfield_14046` | Code review |
| Field in ALL_FIELDS | Yes (added in Build Loop 03) | jira-sync-service.ts |
| FRT field presence (NT) | 329/554 (59.4%) at eval time | Evaluation report (growing via sync) |

## Per-Tier FRT Breaches at Freeze

| Tier | Breaches (Actionable) | Breaches (Not Actionable) |
|------|----------------------|--------------------------|
| Development | 29 | 10 |
| Tier 2 | 17 | 0 |
| CC (Service Requests) | 7 | 2 |
| CC (TPJ) | 5 | 0 |
| Tier 3 | 4 | 1 |
| CC (Incidents) | 2 | 1 |
| Production | 1 | 1 |

**All 7/7 governed tiers had non-zero FRT breach counts at runtime verification.**

## Regression Checks

**RC-005:** FRT Compliance < 100% and > 0%.
**RC-006:** >= 4 of 7 governed tiers have non-zero FRT breach count.
