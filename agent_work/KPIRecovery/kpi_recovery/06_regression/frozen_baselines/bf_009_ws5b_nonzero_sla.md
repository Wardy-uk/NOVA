# BF-009: Non-Zero OpenTickets_Over2Hours Baseline

**Frozen:** 2026-05-21
**Workstream:** WS5-B (SLA-definition alignment)
**Source Evidence:** ws5b_eval_report_01.md (Check 1), ws5b_runtime_verification_report_loop02.md (RV-5)

---

## Protected Invariant

`OpenTickets_Over2Hours` on the breach board must be non-trivially populated. The sum across all agents must be greater than zero. Pre-fix, this field was structurally zero for all 16 agents because the dead `customfield_10010` / `sla_breached` path always returned false. Post-fix, the field is computed via `customfield_14048` + `isSlaBreached()` — the same trusted path as the KPI Dashboard (WS1-B TRUSTED).

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Sum of OpenTickets_Over2Hours across all agents | 23 | Live breach board 2026-05-21 |
| Agents with non-zero OpenTickets_Over2Hours | 7 of 16 | Live breach board 2026-05-21 |
| Pre-fix sum (structural zero) | 0 | ws5b_runtime_verification_report_loop02.md (RV-5) |
| First post-fix observation (2026-05-20T20:20Z) | 17 (6 agents) | RV-5 |
| Second observation (2026-05-21 regression freeze) | 23 (7 agents) | Live data |

## Agent Detail at Freeze

| Agent | OpenTickets_Over2Hours | OpenTickets_Total |
|-------|:---:|:---:|
| Arman | 6 | 31 |
| Naomi | 5 | 40 |
| Luke | 3 | 30 |
| Heidi | 3 | 38 |
| Nathan | 3 | 30 |
| Abdi | 2 | 24 |
| Maria | 1 | 17 |

## Regression Check

**RC-010:** Sum of `OpenTickets_Over2Hours` across all agents must be > 0. This catches regression to the dead-field zero state. The threshold is intentionally low (> 0, not a specific count) because the exact number varies with live ticket state. The critical invariant is *non-trivial* — at least some agents must show SLA breaches.

## Freeze Conditions

- Breach board endpoint: `GET /api/public/wallboard/breached`
- Deployed commits: `64a79a5` (WS5-B primary), `7ec68f1` (MSSQL Date hotfix)
- Fix location: `refreshAllAgentMetrics()` in `kpi-pipeline.ts` — `OpenTickets_Over2Hours` computed from `parseSlaField(ticket.fields_json, 'customfield_14048')` → `isSlaBreached()`
- SLA field: `customfield_14048` (Resolution SLA)
- Operational filters retained: status exclusion (WoR/WoP), due_date exclusion (future due), tier scope (5 governed tiers) per D-076
