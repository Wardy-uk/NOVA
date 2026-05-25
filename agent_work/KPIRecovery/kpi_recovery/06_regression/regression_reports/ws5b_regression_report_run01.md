# WS5-B Regression Report — Run 01

**Run date/time:** 2026-05-21T07:25:15Z
**Script:** `ws5b_regression_check.mjs`
**Evidence path:** `http://100.118.199.1:3069/api/public/wallboard/breached`
**Overall result:** **PASS** (2/2 checks passed)

---

## Baseline References

| Baseline | File | Protected Invariant |
|----------|------|---------------------|
| BF-009 | `bf_009_ws5b_nonzero_sla.md` | `OpenTickets_Over2Hours` sum > 0 (not dead-field zero) |
| BF-010 | `bf_010_ws5b_filtered_sla_behaviour.md` | Filtered SLA behaviour stable; WS5-A checks stable under WS5-B |

---

## Check Results

### RC-010: OpenTickets_Over2Hours non-zero — PASS

| Metric | Baseline (freeze) | This Run | Verdict |
|--------|:---:|:---:|:---:|
| Sum across all agents | 23 | **23** | PASS (> 0) |
| Agents with non-zero | 7 | **7** | Stable |
| Pre-fix value | 0 | — | — |

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

The breach board reflects non-trivial SLA breach counts computed from `customfield_14048` via `isSlaBreached()`. No regression to the dead-field zero state.

### RC-011: WS5-A stability under WS5-B — PASS

| Sub-Check | Threshold | This Run | Verdict |
|-----------|-----------|----------|---------|
| RC-007: Development visibility | ≥1 agent with Total > 20 | 9 agents; max = 40 | **PASS** |
| RC-008: OldestTicketKey population | All active agents populated, zero-ticket agents null | 14/14 active populated; 2/2 zero null | **PASS** |
| RC-009: WORST OLDEST convergence | ≥ 150 days | 198 days (Sebastian, NT-355) | **PASS** |

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

- **No drift detected.** Sum of `OpenTickets_Over2Hours` is 23 — identical to the baseline freeze value. This is the second distinct observation post-fix (first was 17 at 2026-05-20T20:20Z, now 23). Both non-trivial.
- **WS5-A checks fully stable.** RC-007/008/009 values unchanged from WS5-A regression Run 01-03 patterns.
- **Maria (Over2H=1)** is a new non-zero agent compared to the first post-fix observation (was 0). This is expected live variation, not drift.

---

## Blockers to Promotion

**None.** All checks pass cleanly. WS5-B is ready for REGRESSION PROTECTED promotion pending manager review of:

| # | Gate Condition | Status |
|---|---------------|--------|
| PG-11 | WS5-B baselines frozen (BF-009, BF-010) | **MET** |
| PG-12 | Regression checks defined (RC-010, RC-011) | **MET** |
| PG-13 | Regression check executable | **MET** — `ws5b_regression_check.mjs` |
| PG-14 | ≥1 clean regression run | **MET** — Run 01 PASS (2/2) |
| PG-15 | No new blocking gaps since evaluation | **MET** — no new gaps |

---

## Script Note

The Node.js process exit triggered a benign libuv assertion (`UV_HANDLE_CLOSING` in `async.c`) on Windows. This is a known Node.js cleanup race condition on Windows — the script completed all checks and reported OVERALL: PASS before the assertion fired. It does not affect result validity.
