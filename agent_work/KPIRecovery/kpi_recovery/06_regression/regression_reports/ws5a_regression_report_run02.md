# WS5-A Regression Report — Run 02

**Run Date/Time:** 2026-05-20T19:14:36Z
**Script:** `ws5a_regression_check.mjs`
**Endpoint:** `http://100.118.199.1:3069/api/public/wallboard/breached`
**Overall Result:** **PASS (3/3)**

---

## Code Change Verification

No code changes to `kpi-pipeline.ts` since Run 01. Last commit touching the file remains `6072c74` (fix(kpi): breach board population — Development inclusion, OldestTicketKey, observability). Same deploy, same prod HEAD `6c70d66`.

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

**Evidence:** 9 agents exceed the 20-ticket threshold. Top 5: Sebastian (32), Luke (30), Arman (31), Heidi (38), Abdi (24). Development-tier tickets continue to be counted.

### RC-008: OldestTicketKey Population — PASS

| Metric | Value | Expected |
|--------|:---:|---|
| Active agents with populated key | 14/14 | 100% |
| Zero-ticket agents with null key | 2/2 | 100% |
| Failures | 0 | 0 |

**Evidence:** All 14 agents with open tickets have valid `NT-\d+` keys. Both zero-ticket agents (NOVA AI, Willem Kruger) correctly have null keys. Identical to Run 01.

### RC-009: WORST OLDEST Convergence — PASS

| Metric | Value | Threshold |
|--------|:---:|---|
| WORST OLDEST | 198 days | ≥ 150 |
| Agent | Sebastian (NT-355) | — |
| Baseline at freeze | 198 days | — |
| Pre-fix value | 76 days | — |

**Evidence:** WORST OLDEST exactly matches the frozen baseline value and Run 01 value. No drift.

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

| Metric | Baseline (freeze) | Run 01 | Run 02 | Drift |
|--------|:---:|:---:|:---:|---|
| WORST OLDEST | 198d | 198d | 198d | None |
| OldestTicketKey population rate | 14/14 | 14/14 | 14/14 | None |
| Total agents on board | 16 | 16 | 16 | None |
| Max OpenTickets_Total | — | 40 (Naomi) | 40 (Naomi) | None |

All values identical across baseline, Run 01, and Run 02. Zero drift detected.

---

## Blockers

**None identified.**

---

## Script Notes

- Exit code 127 observed from libuv assertion during Node.js process cleanup on Windows (`UV_HANDLE_CLOSING`). Known Windows Node.js issue. All checks completed and reported before the assertion.
- Same-day consecutive run permitted under D-036 (fresh runtime state, no code changes between runs).

---

## Recommendation

Run 02 is clean. 2 of 3 required consecutive clean runs complete. One more clean run required to satisfy TG-5.
