# WS5-A Regression Report — Run 03

**Run Date/Time:** 2026-05-20T19:15:05Z
**Script:** `ws5a_regression_check.mjs`
**Endpoint:** `http://100.118.199.1:3069/api/public/wallboard/breached`
**Overall Result:** **PASS (3/3)**

---

## Code Change Verification

No code changes to `kpi-pipeline.ts` since Run 01 or Run 02. Last commit touching the file remains `6072c74`. Same deploy, same prod HEAD `6c70d66`.

---

## Baseline References

| ID | Baseline | Frozen |
|----|----------|--------|
| BF-006 | Development agent visibility | 2026-05-20 |
| BF-007 | OldestTicketKey population | 2026-05-20 |
| BF-008 | WORST OLDEST convergence | 2026-05-20 |

---

## Check Results

### RC-007: Development Agent Visibility — PASS

| Metric | Value | Threshold |
|--------|:---:|---|
| Agents with OpenTickets_Total > 20 | 9 | ≥ 1 |
| Max OpenTickets_Total | 40 (Naomi) | — |

**Evidence:** 9 agents exceed the 20-ticket threshold. Development-tier tickets continue to be counted. Identical to Run 01 and Run 02.

### RC-008: OldestTicketKey Population — PASS

| Metric | Value | Expected |
|--------|:---:|---|
| Active agents with populated key | 14/14 | 100% |
| Zero-ticket agents with null key | 2/2 | 100% |
| Failures | 0 | 0 |

**Evidence:** All 14 agents with open tickets have valid `NT-\d+` keys. Both zero-ticket agents (NOVA AI, Willem Kruger) correctly have null keys. Identical across all 3 runs.

### RC-009: WORST OLDEST Convergence — PASS

| Metric | Value | Threshold |
|--------|:---:|---|
| WORST OLDEST | 198 days | ≥ 150 |
| Agent | Sebastian (NT-355) | — |
| Baseline at freeze | 198 days | — |
| Pre-fix value | 76 days | — |

**Evidence:** WORST OLDEST exactly matches the frozen baseline value and both prior runs. Zero drift across all 3 runs.

---

## Full Agent Snapshot

| Agent | Open | OldestDays | OldestKey |
|-------|:---:|:---:|---|
| Sebastian | 32 | 198 | NT-355 |
| Luke | 30 | 167 | NT-3617 |
| Arman | 31 | 159 | NT-4255 |
| Heidi | 38 | 154 | NT-4649 |
| Abdi | 24 | 153 | NT-4779 |
| Stephen | 25 | 153 | NT-4699 |
| Zoe | 35 | 99 | NT-9045 |
| Nathan | 29 | 85 | NT-10287 |
| Naomi | 40 | 79 | NT-11271 |
| Nick | 7 | 63 | NT-13023 |
| Hope | 20 | 61 | NT-13305 |
| Isabel | 11 | 36 | NT-16128 |
| Kayleigh | 6 | 13 | NT-18204 |
| Maria | 17 | 8 | NT-18626 |
| NOVA | 0 | 0 | null |
| Willem | 0 | 0 | null |

---

## Drift Observations

| Metric | Baseline | Run 01 | Run 02 | Run 03 | Drift |
|--------|:---:|:---:|:---:|:---:|---|
| WORST OLDEST | 198d | 198d | 198d | 198d | None |
| OldestTicketKey population | 14/14 | 14/14 | 14/14 | 14/14 | None |
| Total agents on board | 16 | 16 | 16 | 16 | None |
| Max OpenTickets_Total | — | 40 | 40 | 40 | None |

All values identical across baseline and all 3 regression runs. Zero drift detected.

---

## Blockers

**None identified.**

---

## Script Notes

- Exit code 127 from libuv assertion during Node.js process cleanup on Windows. Known issue. All checks completed before assertion.
- Same-day consecutive run permitted under D-036 (fresh runtime state, no code changes between runs).

---

## Trust Gate Assessment

| Gate | Condition | Status |
|------|-----------|--------|
| TG-5 | ≥ 3 consecutive clean regression runs | **SATISFIED** — Run 01, 02, 03 all PASS (3/3) |
| TG-6 | No manual intervention required | **SATISFIED** — all runs automated, no manual fixes needed |
| TG-7 | No new blocking gaps | **SATISFIED** — no new gaps identified across 3 runs |
| TG-8 | Manager review of accumulated evidence | **PENDING** — requires Nick's review |

---

## Recommendation

**The regression-run portion of the TRUSTED gate is now satisfied.** Three consecutive clean runs (Run 01, 02, 03) show zero drift from frozen baselines BF-006 through BF-008. No manual intervention was required. No new blocking gaps emerged.

WS5-A is ready for **manager review (TG-8)**. Upon Nick's sign-off, WS5-A can be promoted from **REGRESSION PROTECTED** to **TRUSTED**.
