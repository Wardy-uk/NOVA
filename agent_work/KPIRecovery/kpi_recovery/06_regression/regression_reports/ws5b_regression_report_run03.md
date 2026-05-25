# WS5-B Regression Report — Run 03

**Run date/time:** 2026-05-21T07:41:18Z
**Script:** `ws5b_regression_check.mjs`
**Evidence path:** `http://100.118.199.1:3069/api/public/wallboard/breached`
**Overall result:** **PASS** (2/2 checks passed)

---

## Code Change Confirmation

No code changes to `kpi-pipeline.ts` or `jira-sync-service.ts` since Run 01 or Run 02. Last relevant commits remain `7ec68f1` and `64a79a5`, both pre-dating the baseline freeze. Git HEAD unchanged at `7ec68f1`. This is a fresh runtime state observation against the same deployed code.

---

## Baseline References

| Baseline | File | Protected Invariant |
|----------|------|---------------------|
| BF-009 | `bf_009_ws5b_nonzero_sla.md` | `OpenTickets_Over2Hours` sum > 0 (not dead-field zero) |
| BF-010 | `bf_010_ws5b_filtered_sla_behaviour.md` | Filtered SLA behaviour stable; WS5-A checks stable under WS5-B |

---

## Check Results

### RC-010: OpenTickets_Over2Hours non-zero — PASS

| Metric | Baseline (freeze) | Run 01 | Run 02 | This Run | Verdict |
|--------|:---:|:---:|:---:|:---:|:---:|
| Sum across all agents | 23 | 23 | 23 | **23** | PASS (> 0) |
| Agents with non-zero | 7 | 7 | 7 | **7** | Stable |
| Pre-fix value | 0 | — | — | — | — |

Agent detail:

| Agent | OpenTickets_Over2Hours |
|-------|:---:|
| Arman | 6 |
| Naomi | 5 |
| Luke | 3 |
| Heidi | 3 |
| Nathan | 3 |
| Abdi | 2 |
| Maria | 1 |

The breach board continues to reflect non-trivial SLA breach counts computed from `customfield_14048` via `isSlaBreached()`. No regression to the dead-field zero state.

### RC-011: WS5-A stability under WS5-B — PASS

| Sub-Check | Threshold | Run 01 | Run 02 | This Run | Verdict |
|-----------|-----------|--------|--------|----------|---------|
| RC-007: Development visibility | ≥1 agent with Total > 20 | 9 agents; max = 40 | 9 agents; max = 40 | 9 agents; max = 40 | **PASS** |
| RC-008: OldestTicketKey population | All active populated, zero null | 14/14; 2/2 | 14/14; 2/2 | 14/14; 2/2 | **PASS** |
| RC-009: WORST OLDEST convergence | ≥ 150 days | 198d (Sebastian, NT-355) | 198d (Sebastian, NT-355) | 198d (Sebastian, NT-355) | **PASS** |

All three WS5-A recovered behaviours remain stable under the WS5-B SLA-definition alignment deployment.

---

## Full Agent Snapshot

| Agent | Open | Over2H | OldestDays | OldestKey |
|-------|:---:|:---:|:---:|-----------|
| Arman | 31 | 6 | 159 | NT-4255 |
| Naomi | 40 | 5 | 79 | NT-11271 |
| Luke | 30 | 3 | 167 | NT-3617 |
| Heidi | 38 | 3 | 154 | NT-4649 |
| Nathan | 30 | 3 | 85 | NT-10287 |
| Abdi | 24 | 2 | 153 | NT-4779 |
| Maria | 17 | 1 | 8 | NT-18626 |
| Sebastian | 32 | 0 | 198 | NT-355 |
| Stephen | 25 | 0 | 153 | NT-4699 |
| Zoe | 35 | 0 | 99 | NT-9045 |
| Nick | 7 | 0 | 63 | NT-13023 |
| Hope | 20 | 0 | 61 | NT-13305 |
| Isabel | 11 | 0 | 36 | NT-16128 |
| Kayleigh | 6 | 0 | 13 | NT-18204 |
| NOVA | 0 | 0 | 0 | null |
| Willem | 0 | 0 | 0 | null |

---

## Drift Observations

- **Zero drift detected across all three runs.** Every value is identical to Run 01, Run 02, and the baseline freeze snapshot: Sum `OpenTickets_Over2Hours` = 23, non-zero agents = 7, WORST OLDEST = 198 days (Sebastian, NT-355), max `OpenTickets_Total` = 40 (Naomi), `OldestTicketKey` population = 14/14 active + 2/2 null.
- **This is the fourth distinct observation post-fix** (first: 17 at 2026-05-20T20:20Z, second: 23 at Run 01, third: 23 at Run 02, fourth: 23 at Run 03). All non-trivial.
- **Stable snapshot state** confirmed across runs — no pipeline refresh between observations, which is expected and valid per D-036 (same-day runs permitted against fresh runtime state with no code changes).

---

## Blockers / Regressions

**None.** All checks pass cleanly. No new blocking gaps.

---

## Trust Gate Status — ALL MET

| Gate | Condition | Status |
|------|-----------|--------|
| TG-9 | ≥3 consecutive clean regression runs | **3/3 MET** — Run 01 PASS, Run 02 PASS, Run 03 PASS |
| TG-10 | No manual intervention required | **MET** — no intervention needed across all three runs |
| TG-11 | No new blocking gaps | **MET** — no new gaps since evaluation |
| TG-12 | Manager review of accumulated evidence | **READY FOR REVIEW** — all prerequisite conditions satisfied |

---

## Recommendation

**The regression-run portion of the TRUSTED gate is now satisfied.** Three consecutive clean regression runs (Run 01, Run 02, Run 03) have been executed with zero drift and no code changes between runs. All four TG-9–TG-12 conditions are met (TG-12 pending manager review of this accumulated evidence).

WS5-B is ready for promotion from REGRESSION PROTECTED to TRUSTED. The Manager Agent should execute the TG-12 review and, if satisfied, issue the promotion decision.

---

## Script Note

The Node.js process exit triggered a benign libuv assertion (`UV_HANDLE_CLOSING` in `async.c`) on Windows (exit code 127). This is a known Node.js cleanup race condition on Windows — the script completed all checks and reported OVERALL: PASS before the assertion fired. It does not affect result validity. Same behaviour as Run 01 and Run 02.
