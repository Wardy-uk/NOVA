# BF-001: Ghost Suppression Baseline

**Frozen:** 2026-05-20
**Sub-Slice:** WS1-A
**Source Evidence:** ws1_runtime_verification_post_deploy.md, ws1_eval_report_01.md

---

## Protected Invariant

No KPI rows may be emitted for tiers outside the governed set (`ALL_TIERS`).

## Governed Tier Set (ALL_TIERS)

1. CC (Incidents)
2. CC (Service Requests)
3. CC (TPJ)
4. Production
5. Tier 2
6. Tier 3
7. Development

**Count:** 7 governed tiers. This set is the canonical reference.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Governed tiers emitting KPIs | 7 | Post-deploy runtime verification |
| Total governed KPI count | 74 (post-ghost removal) | KPI comprehensive audit |
| Ghost rows emitted post-fix | 0 (14 stale MERGE artifacts from pre-deploy snapshot) | Runtime verification |
| Emission guard | `if (!ALL_TIERS.includes(tier)) continue;` in kpi-pipeline.ts | Code review |

## Known Non-Governed Tiers (Excluded by Design)

| Tier | Ticket Count (at freeze) | Disposition |
|------|-------------------------|-------------|
| Escalations | 10 | Excluded by emission guard. Deferred to WS2+ (HDR-4). |
| Unclassified (NULL tier) | 10 | Excluded by emission guard. Correctly classified from NULL current_tier. |

## Regression Check

**RC-001:** Zero KPI rows for non-governed tiers.
**RC-002:** Exactly 7 distinct governed tiers, all populated.
