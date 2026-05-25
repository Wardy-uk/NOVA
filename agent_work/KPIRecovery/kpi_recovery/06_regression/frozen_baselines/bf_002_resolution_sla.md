# BF-002: Resolution SLA Baseline

**Frozen:** 2026-05-20
**Sub-Slice:** WS1-B
**Source Evidence:** ws1_runtime_verification_post_deploy.md, ws1_eval_report_01.md

---

## Protected Invariant

Resolution SLA compliance must remain plausible (not 100%, not near 0%). Source field must remain `customfield_14048`. Denominator must exclude tickets without SLA field.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Resolution Compliance % (Open Queue) | 81% | Post-deploy runtime verification |
| SLA Breached count | ~101 | Runtime verification |
| Source field | `customfield_14048` | Code review + Jira cross-check |
| SLA field presence (NT) | 558/558 (100%) | Evaluation report |
| SLA field presence (NTPJ) | 2/374 (0.5%) | Evaluation report |
| SLA field presence (YO) | 0/247 (0%) | Evaluation report |
| Live Jira cross-check | 6/8 match (2 mismatches = stale cache on old tickets) | Evaluation report |

## Denominator Rule

Only tickets with `customfield_14048` present and non-null in `fields_json` are included in compliance calculation. NTPJ and YO tickets are correctly excluded (no SLA configuration at project level).

## Plausibility Range

**Pass:** Compliance between 50% and 95%.
**Fail:** Compliance = 100% (field lost) or < 50% (systematic error) or field absent from all tickets.

## Regression Check

**RC-004:** Resolution SLA compliance between 50% and 95%.
