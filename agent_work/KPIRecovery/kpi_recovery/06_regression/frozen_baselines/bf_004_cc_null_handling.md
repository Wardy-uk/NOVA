# BF-004: CC Null Handling Baseline

**Frozen:** 2026-05-20
**Sub-Slice:** WS1-A
**Source Evidence:** ws1_runtime_verification_post_deploy.md, ws1_eval_report_01.md

---

## Protected Invariant

`ccBucket()` must return `'CC (Incidents)'` for null/empty `request_type`. CC (Incidents) volume must remain above 50 (indicating null-RT tickets are correctly routed).

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| CC (Incidents) volume (post-fix) | 91 | Post-deploy runtime verification |
| CC (Incidents) volume (pre-fix) | 30 | Runtime verification (regression evidence) |
| Null request_type CC tickets | 651 | Evaluation report |
| ccBucket() default return | `'CC (Incidents)'` | Code review (kpi-pipeline.ts) |

## CC Sub-Tier Breakdown at Freeze

| Sub-Tier | Count | Routing Rule |
|----------|-------|-------------|
| CC (Incidents) | 683 | null RT (651) + Incident/Chat/AI Request/etc. (29) + unmapped (3) |
| CC (Service Requests) | 43 | request_type = 'Service Request' |
| CC (TPJ) | 43 | request_type = 'TPJ Request' |
| **Total** | **769** | All CC tickets accounted for |

## Regression Check

**RC-003:** CC (Incidents) equivalent count >= 50.
