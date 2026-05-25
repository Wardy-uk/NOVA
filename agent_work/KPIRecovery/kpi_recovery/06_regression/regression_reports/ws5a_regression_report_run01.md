# WS5-A Regression Report — Run 01

**Run Date/Time:** 2026-05-20T19:08:14Z
**Script:** `ws5a_regression_check.mjs`
**Endpoint:** `http://100.118.199.1:3069/api/public/wallboard/breached`
**Overall Result:** **PASS (3/3)**

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

**Evidence:** 9 agents exceed the 20-ticket threshold (pre-fix maximum was 18). Development-tier tickets are clearly still being counted.

### RC-008: OldestTicketKey Population — PASS

| Metric | Value | Expected |
|--------|:---:|---|
| Active agents with populated key | 14/14 | 100% |
| Zero-ticket agents with null key | 2/2 | 100% |
| Failures | 0 | 0 |

**Evidence:** All 14 agents with open tickets have valid `NT-\d+` keys. Both zero-ticket agents (NOVA AI, Willem Kruger) correctly have null keys.

### RC-009: WORST OLDEST Convergence — PASS

| Metric | Value | Threshold |
|--------|:---:|---|
| WORST OLDEST | 198 days | ≥ 150 |
| Agent | Sebastian (NT-355) | — |
| Baseline at freeze | 198 days | — |
| Pre-fix value | 76 days | — |

**Evidence:** WORST OLDEST exactly matches the frozen baseline value. No drift detected.

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

| Metric | Baseline (freeze) | Run 01 | Drift |
|--------|:---:|:---:|---|
| WORST OLDEST | 198d | 198d | None |
| OldestTicketKey population rate | 14/14 | 14/14 | None |
| Total agents on board | 16 | 16 | None |
| Heidi Power OpenTickets_Total | 38 | 38 | None |
| Sebastian Broome OpenTickets_Total | 32 | 32 | None |
| Naomi Wentworth OpenTickets_Total | — | 40 | New highest (not in original top-7 sample) |

No material drift from evaluation or runtime baselines. All values stable within the same pipeline cycle as the evaluation.

---

## Blockers to REGRESSION PROTECTED Promotion

**None identified.**

All promotion gate conditions for REGRESSION PROTECTED are now met:

| # | Gate Condition | Status |
|---|---------------|--------|
| PG-6 | WS5-A baselines frozen (BF-006–BF-008) | ✅ DONE |
| PG-7 | Regression checks defined (RC-007–RC-009) | ✅ DONE |
| PG-8 | Regression check executable | ✅ DONE — `ws5a_regression_check.mjs` |
| PG-9 | ≥ 1 clean regression run including WS5-A checks | ✅ DONE — Run 01 PASS (3/3) |
| PG-10 | No new blocking gaps since evaluation | ✅ MET — no new gaps |

---

## Script Notes

- Exit code 9 observed from libuv assertion during Node.js process cleanup on Windows (`UV_HANDLE_CLOSING`). This is a known Windows Node.js issue unrelated to check logic. All checks completed and reported before the assertion.
- Script uses `fetch()` (Node 18+ built-in) against the public wallboard endpoint — no authentication or DB credentials required.
- Field name access uses fallback pattern (`AgentName || agentName || agent_name`) for resilience against casing changes.

---

## Recommendation

WS5-A is ready for promotion from **EVALUATED** to **REGRESSION PROTECTED**. All PG-6 through PG-10 gate conditions are satisfied. The Manager Agent may proceed with the promotion decision.
