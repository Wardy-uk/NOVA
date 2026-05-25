# BF-006: Development Agent Visibility Baseline

**Frozen:** 2026-05-20
**Workstream:** WS5-A (population-path recovery)
**Source Evidence:** ws5a_eval_report_01.md (EV-1), ws5a_runtime_verification_report_loop03.md (RV-1)

---

## Protected Invariant

Development-tier agents must appear on the breach board with non-zero OpenTickets_Total. The breach board population path must include tickets where `current_tier = 'Development'` in `jira_issue_cache`.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Development-tier agents visible on breach board | ≥1 agent with Development tickets counted | Live eval 2026-05-20T18:56Z |
| Example agent (Heidi Power) pre-fix | 12 open tickets | RV-1 before/after |
| Example agent (Heidi Power) post-fix | 38 open tickets | RV-1 before/after |
| Total agents with non-zero OpenTickets_Total | 14 of 16 | EV-2 evidence |

## Evidence of Recovery

| Agent | Before Fix | After Fix | Delta |
|-------|:---:|:---:|:---:|
| Sebastian Broome | 18 | 32 | +14 |
| Luke Scaife | 16 | 30 | +14 |
| Arman Shazad | 17 | 31 | +14 |
| Heidi Power | 12 | 38 | +26 |
| Stephen Mitchell | 13 | 25 | +12 |
| Abdi Mohamed | 14 | 24 | +10 |
| Nick Ward | 1 | 7 | +6 |

## Regression Check

**RC-007:** At least 1 agent on the breach board must have OpenTickets_Total > 20. This threshold ensures Development-tier tickets are still being counted (pre-fix maximum was 18; post-fix multiple agents exceed 24).

## Freeze Conditions

- Breach board endpoint: `GET /api/public/wallboard/breached`
- Deploy: Commit `6072c74` in prod HEAD `6c70d66`
- Fix location: `refreshAllAgentMetrics()` in `kpi-pipeline.ts` — Development tier added to all 3 query filters
