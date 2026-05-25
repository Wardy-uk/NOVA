# BF-010: Filtered SLA Behaviour / Order-of-Magnitude Baseline

**Frozen:** 2026-05-21
**Workstream:** WS5-B (SLA-definition alignment)
**Source Evidence:** ws5b_eval_report_01.md (Check 2, Check 3), ws5b_runtime_verification_report_loop02.md (RV-6)

---

## Protected Invariant

The breach board's SLA-definition path must remain behaviourally stable and not regress to the dead-field zero state. The operational-filtered SLA behaviour — computed via `customfield_14048` + `isSlaBreached()` with status/due_date/tier-scope filters per D-076 — must remain within a stable, non-trivial band.

This baseline also protects WS5-A recovered behaviours (RC-007–RC-009) under WS5-B deployment, confirming that the SLA-definition alignment change did not regress the population-path fixes.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| OpenTickets_Over2Hours sum | 23 | Live breach board 2026-05-21 |
| Non-zero agent count | 7 of 16 | Live breach board 2026-05-21 |
| RC-007 (Development visibility) | 9 agents with Total > 20; max = 40 | Live breach board 2026-05-21 |
| RC-008 (OldestTicketKey) | 14/14 active agents populated | Live breach board 2026-05-21 |
| RC-009 (WORST OLDEST) | 198 days (Sebastian, NT-355) | Live breach board 2026-05-21 |

## Previous Observations

| Observation | OpenTickets_Over2Hours Sum | Non-Zero Agents |
|-------------|:---:|:---:|
| Pre-fix (dead field) | 0 | 0 |
| Post-fix observation 1 (2026-05-20T20:20Z) | 17 | 6 |
| Freeze snapshot (2026-05-21) | 23 | 7 |

The increase from 17 to 23 is expected — live ticket state changes between observations. The critical invariant is that the sum remains non-trivial (not 0 or near-0).

## Regression Checks

**RC-010:** Sum of `OpenTickets_Over2Hours` > 0. Catches regression to dead-field zero state.

**RC-011:** WS5-A regression checks (RC-007, RC-008, RC-009) all PASS under WS5-B deployment. This confirms the SLA-definition change did not break the population-path recovery. RC-011 is a composite check that re-runs the three WS5-A checks:
- RC-007: ≥1 agent with OpenTickets_Total > 20
- RC-008: All active agents have OldestTicketKey populated (NT-\d+ pattern); zero-ticket agents have null key
- RC-009: WORST OLDEST ≥ 150 days

## Freeze Conditions

- Breach board endpoint: `GET /api/public/wallboard/breached`
- Deployed commits: `64a79a5` + `7ec68f1`
- SLA field: `customfield_14048` (Resolution SLA)
- SLA cycle logic: `isSlaBreached()` (completed + ongoing cycles, negative remaining = breached)
- Operational filters: status exclusion, due_date exclusion, tier scope (D-076)
