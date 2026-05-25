# BF-008: WORST OLDEST Convergence Baseline

**Frozen:** 2026-05-20
**Workstream:** WS5-A (population-path recovery)
**Source Evidence:** ws5a_eval_report_01.md (EV-3), ws5a_runtime_verification_report_loop03.md (RV-4)

---

## Protected Invariant

The breach board's WORST OLDEST value (maximum OldestTicketDays across all agents) must remain materially aligned with the dashboard's oldest Development ticket age. A floor of 150 days is set based on the current baseline of 198 days, allowing for natural drift as old tickets are resolved but catching any regression to the pre-fix level of 76 days.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Breach board WORST OLDEST | 198 days (Sebastian Broome, NT-355) | EV-3 live query 2026-05-20T18:56Z |
| Dashboard "Oldest in Development" | ~198 days (193d snapshot + 5d elapsed) | EV-3 team-kpis query |
| Pre-fix WORST OLDEST | 76 days | RV-4 before/after |
| Delta eliminated | 121 days | EV-3 analysis |

## Threshold Rationale

The regression floor is set at **150 days**, not 198 days, because:

1. The oldest ticket may naturally be resolved, lowering the max
2. The invariant is that Development-tier tickets are *included* in the population path — if they are, WORST OLDEST will remain high (the Development backlog has many old tickets)
3. A value below 150 days would strongly suggest Development tickets are no longer being counted (pre-fix was 76 days)
4. This threshold catches regression to pre-fix behaviour while allowing natural operational variance

## Regression Check

**RC-009:** The breach board's maximum OldestTicketDays must be ≥ 150 days. This is a bounded floor that catches population-path regression without being brittle to individual ticket resolution.

## Freeze Conditions

- Breach board endpoint: `GET /api/public/wallboard/breached`
- Dashboard endpoint: `GET /api/public/wallboard/team-kpis`
- Deploy: Commit `6072c74` in prod HEAD `6c70d66`
- Fix location: `refreshAllAgentMetrics()` in `kpi-pipeline.ts` — Development tier included in all query filters
